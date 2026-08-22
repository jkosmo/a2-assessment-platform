// #987: ÉN oversetter fra authoring-plan til a2-content-export/v1-konvolutt.
//
// ⚠️ Hvorfor denne fila finnes i det hele tatt.
//
// Skillet har alltid hatt to veier innhold kan gå:
//
//   API-veien       plan -> validate -> opprett utkast via endepunkter
//   Filveien        plan -> fil -> forfatteren importerer i admin-UI
//
// `synthesizeModuleEnvelope` levde tidligere inne i `import-package.mjs`, altså kun på API-veien.
// Filveien hadde ingen emitter i det hele tatt — den var en HÅNDSKREVET instruks i SKILL.md som
// bare beskrev kurs.
//
// Da frittstående seksjonseksport kom (#916), måtte begge veiene oppdatert hver for seg. Bare
// API-veien ble det, og der løses seksjoner med `POST /sections` — ikke med en konvolutt. Derfor
// fantes ordet `scope: "section"` ingen steder i skillet, og en forfatter som ba om «eksporter
// denne seksjonen» fikk planen sin utlevert i stedet for en importfil.
//
// Kuren er ikke å legge til en seksjonsvariant på filveien. Det ville gitt to emittere som må
// vedlikeholdes i takt — samme sykdom, ett hakk mindre. Kuren er at BEGGE veiene bruker disse.
//
// Produkteier 2026-08-22: API-veien beholdes som en mulighet, men filveien er den som skal virke,
// og den må dekke isolerte moduler og seksjoner. Se doc/DECISIONS.md.

export const EXPORT_FORMAT = "a2-content-export/v1";

// Injiserbar klokke: en test som ikke kan feste tidspunktet må enten sammenligne løst eller la
// være å sjekke feltet. Begge deler gjør testen svakere enn den trenger å være.
function nowIso() {
  return new Date().toISOString();
}

// ⚠️ TOM audit, med vilje og i alle emitterne.
//
// `audit.publishedAt` fra kilden er det importen bruker til å avgjøre om innholdet skal
// auto-publiseres. En plan er ikke publisert noe sted — den er et utkast som ikke finnes ennå — så
// å bære over en publiseringshistorikk ville påstått noe usant OG kunne gjort innhold synlig for
// deltakere uten at noen trykket publiser.
//
// Importen lander alltid upublisert uansett (#896 §9), men det er en egenskap ved importen. Denne
// tomme auditen er vår egen halvdel av den garantien, og den skal ikke fjernes fordi «importen
// ordner det».
const EMPTY_AUDIT = Object.freeze({});

/**
 * Én seksjon som en frittstående `scope: "section"`-konvolutt (#916).
 * @param {{title: object, bodyMarkdown: object, assets?: unknown[]}} payload  objects[].payload
 */
export function synthesizeSectionEnvelope(payload, now = nowIso) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("synthesizeSectionEnvelope: payload mangler");
  }
  if (payload.title === undefined || payload.bodyMarkdown === undefined) {
    throw new TypeError("synthesizeSectionEnvelope: payload må ha title og bodyMarkdown");
  }
  return {
    exportFormat: EXPORT_FORMAT,
    exportedAt: now(),
    scope: "section",
    section: {
      title: payload.title,
      bodyMarkdown: payload.bodyMarkdown,
      // Assets bæres uendret over: formen er identisk mellom planen og eksportskjemaet, helt ned
      // til `sourceId` og `localizedVariants`. Det er nettopp den likheten som gjorde det lett å
      // forveksle formatene i utgangspunktet.
      ...(payload.assets ? { assets: payload.assets } : {}),
      audit: { ...EMPTY_AUDIT },
    },
  };
}

/**
 * Én modul som en `scope: "module"`-konvolutt.
 * Flyttet hit fra import-package.mjs — samme oppførsel, nå delt med filveien.
 * @param {{module: object, activeVersion: object}} payload  objects[].payload
 */
export function synthesizeModuleEnvelope(payload, now = nowIso) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("synthesizeModuleEnvelope: payload mangler");
  }
  if (payload.module === undefined || payload.activeVersion === undefined) {
    throw new TypeError("synthesizeModuleEnvelope: payload må ha module og activeVersion");
  }
  return {
    exportFormat: EXPORT_FORMAT,
    exportedAt: now(),
    scope: "module",
    module: {
      module: payload.module,
      activeVersion: { ...payload.activeVersion, audit: { ...EMPTY_AUDIT } },
    },
  };
}

/**
 * Velger emitter ut fra objektets `type`. Ukjent type gir en feil som NAVNGIR typen — en agent som
 * treffer denne skal vite hva som manglet, ikke bare at noe gikk galt.
 */
export function synthesizeEnvelope(object, now = nowIso) {
  switch (object?.type) {
    case "section":
      return synthesizeSectionEnvelope(object.payload, now);
    case "module":
      return synthesizeModuleEnvelope(object.payload, now);
    case "course":
      // Kurs har kryssreferanser (`clientRef`) til seksjoner og moduler i samme plan, så en
      // kurskonvolutt kan ikke bygges fra ett objekt alene. Filveien for HELE kurs er dokumentert
      // i SKILL.md og virker; den er ikke rørt av #987.
      throw new TypeError(
        "synthesizeEnvelope: kurs bygges ikke per objekt — se SKILL.md, reservevei for kurs",
      );
    default:
      throw new TypeError(`synthesizeEnvelope: ukjent objekttype "${object?.type ?? "(mangler)"}"`);
  }
}

/**
 * Alle isolerte seksjoner og moduler i en plan, som konvolutter klare til import.
 * Kurs-objekter hoppes over — de har sin egen vei.
 */
export function synthesizeStandaloneEnvelopes(pkg, now = nowIso) {
  const objects = Array.isArray(pkg?.objects) ? pkg.objects : [];
  return objects
    .filter((o) => o.type === "section" || o.type === "module")
    .map((o) => ({
      clientRef: o.clientRef ?? null,
      type: o.type,
      envelope: synthesizeEnvelope(o, now),
    }));
}
