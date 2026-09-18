// #1033: pakken bærer sin opprinnelse, og importen fører den inn i revisjonssporet.
//
// Tre ting festes her: (1) skillets tre emittere skriver `provenance` med skill + versjon, og
// den passerer det EKTE importskjemaet; (2) skillets versjon følger package.json — ellers svarer
// revisjonsraden feil på «hvilken versjon laget dette»; (3) serverens hjelper gir bare stempel for
// `agent_authoring`, og et ekte agent-token vinner over filas påstand.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportEnvelopeSchema, exportProvenanceSchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { agentAuthoringAuditMetadata, envelopeProvenanceAuditMetadata } from "../../src/observability/auditEvents.js";
import { SKILL_NAME, SKILL_VERSION, skillProvenance } from "../../skills/a2-authoring-api/scripts/skill-provenance.mjs";
import {
  synthesizeModuleEnvelope,
  synthesizeSectionEnvelope,
} from "../../skills/a2-authoring-api/scripts/synthesize-envelopes.mjs";
import {
  buildFallbackEnvelope,
  validateExportEnvelopeStructure,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/export-validate.mjs";

const NOW = () => "2026-09-18T20:00:00.000Z";
const L = (t: string) => ({ "en-GB": t, nb: t, nn: t });

describe("#1033 skill provenance", () => {
  it("SKILL_VERSION follows package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SKILL_VERSION).toBe(pkg.version);
  });

  it("section and module emitters write provenance that the real import schema accepts", () => {
    const section = synthesizeSectionEnvelope({ title: { nb: "T" }, bodyMarkdown: { nb: "# B" } }, NOW);
    const module = synthesizeModuleEnvelope(
      {
        module: { title: L("M"), certificationLevel: null },
        activeVersion: {
          assessmentMode: "MCQ_ONLY",
          mcqSet: { title: { nb: "S" }, questions: [{ stem: { nb: "Q?" }, options: [{ nb: "a" }, { nb: "b" }], correctAnswer: { nb: "a" } }] },
        },
      },
      NOW,
    );
    for (const env of [section, module]) {
      expect(env.provenance).toEqual({ producer: "agent_authoring", tool: SKILL_NAME, toolVersion: SKILL_VERSION });
      const parsed = exportEnvelopeSchema.safeParse(env);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      if (parsed.success) expect(parsed.data.provenance?.producer).toBe("agent_authoring");
      expect(validateExportEnvelopeStructure(env).valid).toBe(true);
    }
  });

  it("the course fallback envelope carries provenance and an optional agentRunId", () => {
    const pkg = {
      packageFormat: "a2-authoring-package/v1",
      objects: [
        { clientRef: "s", type: "section", payload: { title: { nb: "T" }, bodyMarkdown: { nb: "# B" } } },
        { clientRef: "c", type: "course", payload: { course: { title: L("K"), certificationLevel: null }, items: [{ type: "SECTION", ref: "s" }] } },
      ],
    };
    const env = buildFallbackEnvelope(pkg, { exportedAt: NOW(), agentRunId: "run-42" });
    expect(env.provenance).toEqual({ producer: "agent_authoring", tool: SKILL_NAME, toolVersion: SKILL_VERSION, agentRunId: "run-42" });
    expect(validateExportEnvelopeStructure(env).valid).toBe(true);
    expect(exportEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it("the bundled validator rejects a malformed provenance the same way the schema does", () => {
    const base = synthesizeSectionEnvelope({ title: { nb: "T" }, bodyMarkdown: { nb: "# B" } }, NOW);
    const bad = { ...base, provenance: { producer: "robot", tool: "" } };
    const local = validateExportEnvelopeStructure(bad);
    expect(local.valid).toBe(false);
    expect(local.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["provenance.producer", "provenance.tool"]));
    expect(exportEnvelopeSchema.safeParse(bad).success).toBe(false);
    expect(exportProvenanceSchema.safeParse({ producer: "human" }).success).toBe(true);
  });

  it("envelopeProvenanceAuditMetadata stamps only agent_authoring, and a real agent token wins", () => {
    expect(envelopeProvenanceAuditMetadata(undefined)).toEqual({});
    expect(envelopeProvenanceAuditMetadata({ producer: "human" })).toEqual({});
    expect(envelopeProvenanceAuditMetadata(skillProvenance({ agentRunId: "run-1" }))).toEqual({
      source: "agent_authoring",
      provenanceClaimed: true,
      provenanceTool: SKILL_NAME,
      provenanceToolVersion: SKILL_VERSION,
      agentRunId: "run-1",
    });
    const merged: Record<string, unknown> = {
      ...envelopeProvenanceAuditMetadata(skillProvenance({ agentRunId: "claimed" })),
      ...agentAuthoringAuditMetadata({ agentRunId: "seen-by-server" }),
    };
    expect(merged.agentRunId).toBe("seen-by-server");
    expect(merged.provenanceClaimed).toBe(true);
  });
});
