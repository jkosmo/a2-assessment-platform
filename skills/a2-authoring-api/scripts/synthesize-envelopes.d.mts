// Typer for synthesize-envelopes.mjs. Speiler mønsteret fra import-package.d.mts: scriptene er
// .mjs fordi de også kjøres direkte av en agent uten byggesteg, men de importeres av TypeScript-
// tester og trenger derfor en deklarasjon.

export declare const EXPORT_FORMAT: "a2-content-export/v1";

/** Lokalisert tekst: ren streng (= ett språk, ikke oversatt) eller per-språk-kart. */
export type LocalizedText = string | Record<string, string>;

export interface SectionAsset {
  sourceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  sourceLocale?: string | null;
  localizedVariants?: Array<{ locale: string; contentBase64: string }>;
}

export interface SectionPayload {
  title: LocalizedText;
  bodyMarkdown: LocalizedText;
  assets?: SectionAsset[];
}

export interface ModulePayload {
  module: Record<string, unknown>;
  activeVersion: Record<string, unknown>;
}

/** Seksjonen slik den ligger i konvolutten: payloaden pluss en tømt audit. */
export interface SectionInEnvelope {
  title: LocalizedText;
  bodyMarkdown: LocalizedText;
  assets?: SectionAsset[];
  audit: Record<string, never>;
}

export interface ModuleInEnvelope {
  module: Record<string, unknown>;
  activeVersion: Record<string, unknown> & { audit: Record<string, never> };
}

// ⚠️ Feltene er valgfrie fordi scope avgjør hvilket som finnes — men de er TYPET, ikke
// `Record<string, unknown>`. En løs type her ville tvunget hver kaller til å caste, og et cast er
// et sted en feil kan gjemme seg. Testen som sjekker at `localizedVariants` overlever, trenger å
// kunne se det feltet.
export interface ExportEnvelope {
  exportFormat: string;
  exportedAt: string;
  scope: "section" | "module" | "course";
  section?: SectionInEnvelope;
  module?: ModuleInEnvelope;
  course?: Record<string, unknown>;
}

/** Returtypen til seksjonsemitteren: her ER `section` alltid til stede. En kaller skal ikke måtte
 *  påstå det med `!` — en påstand er et sted en feil kan gjemme seg. */
export interface SectionEnvelope extends ExportEnvelope {
  scope: "section";
  section: SectionInEnvelope;
}

export interface ModuleEnvelope extends ExportEnvelope {
  scope: "module";
  module: ModuleInEnvelope;
}

export interface AuthoringObject {
  clientRef?: string | null;
  type: string;
  payload: unknown;
}

export declare function synthesizeSectionEnvelope(
  payload: SectionPayload,
  now?: () => string,
): SectionEnvelope;

export declare function synthesizeModuleEnvelope(
  payload: ModulePayload,
  now?: () => string,
): ModuleEnvelope;

export declare function synthesizeEnvelope(
  object: AuthoringObject,
  now?: () => string,
): ExportEnvelope;

export declare function synthesizeStandaloneEnvelopes(
  pkg: { objects?: AuthoringObject[] },
  now?: () => string,
): Array<{ clientRef: string | null; type: string; envelope: ExportEnvelope }>;
