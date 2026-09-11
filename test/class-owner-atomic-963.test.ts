import { afterAll, describe, expect, it, vi } from "vitest";

// `addContentOwner` feiler på kommando. En aktør som ikke finnes ville truffet revisjonsloggens
// fremmednøkkel FØR eierraden — og den var alltid inne i transaksjonen, så det hadde ikke målt noe.
let feilNesteEierrad = false;
vi.mock("../src/modules/content/contentOwnershipService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/content/contentOwnershipService.js")>();
  return {
    ...original,
    addContentOwner: async (...args: Parameters<typeof original.addContentOwner>) => {
      if (feilNesteEierrad) {
        feilNesteEierrad = false;
        throw new Error("simulert: eierraden kunne ikke skrives");
      }
      return original.addContentOwner(...args);
    },
  };
});

import { prisma } from "../src/db/prisma.js";
import { createClass } from "../src/modules/course/classService.js";

// ─────────────────────────────────────────────────────────────────────────────
// #963: eierraden til en klasse ble skrevet ETTER at transaksjonen var committet.
//
// Modul, kurs og seksjon skrev sin ContentOwner-rad inne i transaksjonen. Klassen var den fjerde,
// utenfor. Feilet `addContentOwner` — eller ble prosessen drept mellom de to skrivingene — sto
// klassen igjen uten eier: `decideOwnershipAccess` → «unowned» → 403 mot skaperen selv, permanent.
//
// ⚠️ Kolonnen som inneholdt svaret (`createdById`) lå i samme tabell og ble aldri lest. Den skrives
// ikke lenger; ContentOwner er den ene generasjonen.
//
// Testen lar `addContentOwner` feile (se mocken øverst). Da skal HELE opprettelsen rulles tilbake —
// ingen klasse, ingen eier. Før lå klassen igjen.
// ─────────────────────────────────────────────────────────────────────────────

describe("#963 — klasse og eierrad er én transaksjon", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ feiler eierraden, finnes ikke klassen heller", async () => {
    const actor = await prisma.user.create({
      data: { externalId: `963a-${Date.now()}`, name: "Aktør 963", email: `963a-${Date.now()}@x.test` },
      select: { id: true },
    });
    const navn = `Atomisk ${Date.now()}-${Math.round(performance.now())}`;
    feilNesteEierrad = true;
    await expect(createClass({ name: navn }, actor.id)).rejects.toThrow("simulert");
    // Kontroll: klassen ble ikke liggende igjen.
    expect(await prisma.class.count({ where: { name: navn } })).toBe(0);
  });

  it("kontrollcase: med en ekte aktør finnes både klassen og eierraden", async () => {
    const actor = await prisma.user.create({
      data: { externalId: `963-${Date.now()}`, name: "Eier 963", email: `963-${Date.now()}@x.test` },
      select: { id: true },
    });
    const klass = await createClass({ name: `Eid ${Date.now()}` }, actor.id);
    expect(await prisma.contentOwner.count({ where: { contentType: "CLASS", contentId: klass.id, userId: actor.id } })).toBe(1);
  });
});
