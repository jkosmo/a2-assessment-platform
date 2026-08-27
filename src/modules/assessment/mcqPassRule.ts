import { AssessmentMode } from "../../db/prismaRuntime.js";
import type { AssessmentMode as AssessmentModeType } from "@prisma/client";
import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #949: ETT sted som svarer på «hva er MCQ-grensen for denne modulen».
//
// ⚠️ Hvorfor denne fila finnes.
//
// `mcqService` regnet ut visningsfeltet `passFailMcq` med en HARDKODET 50 %-grense og lagret den,
// mens vedtaket ble fattet av `decisionService` etter modulens policy. En kandidat med 60 % på en
// MCQ_ONLY-modul fikk derfor vedtaket «ikke bestått, under 70 %» side om side med raden
// «MCQ bestått: Ja» i ankebehandlerens skjermbilde. Ingenting sa hvilken som var regelen.
//
// Det samme feltet mater kalibreringsdataene som modul-eiere justerer terskler etter.
//
// ⚠️ HVOR 50-TALLET KOM FRA, og hvorfor det er verdt å huske: linja ble stående igjen av
// `refactor: forenkle vurderingsmodell til én terskel (#257)`. Commiten som forenklet til ÉN
// terskel er den som etterlot den andre. En opprydding som fjerner en modell må lete etter
// AVLEDEDE VERDIER som fortsatt regnes etter den gamle.
//
// ⚠️ DENNE FILA FINNER IKKE OPP NOEN REGEL. Den gjengir nøyaktig det `decisionService` allerede
// gjør, og de to er nå samme kode. Poenget er ikke å endre hva som er bestått — ingen vedtak
// endres — men at visningsfeltet slutter å motsi vedtaket.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Standardgrensen for en modul som BARE er flervalg. Produkteier 2026-08-24: *«MCQ spørsmålene er
 * jevnt over for enkle, så 70% er et minimum med mindre noe annet er eksplisitt satt.»*
 */
export const DEFAULT_MCQ_ONLY_MIN_PERCENT = 70;

/**
 * Grensen MCQ-en må over for denne modulen, eller `null` når det ikke finnes noen MCQ-port.
 *
 * ⚠️ De to modustypene har ULIKE standardverdier, og det er med vilje:
 *
 *   MCQ_ONLY            → `mcqMinPercent ?? 70`. Flervalget ER prøven, så grensen avgjør alt.
 *   FREETEXT_PLUS_MCQ   → `mcqMinPercent ?? null`. Flervalget BIDRAR til totalskåren; det finnes
 *                         ingen egen port med mindre forfatteren setter en.
 *   FREETEXT_ONLY       → `null`. Ingen flervalgsdel i det hele tatt.
 *
 * ⚠️ At blandede moduler ikke har en port som standard er lett å lese som en glipp. Det er det
 * ikke — `decisionService` skriver det eksplisitt (`mcqMinPercent === null || ...`). Å innføre en
 * 70 %-port der ville strøket kandidater som består i dag.
 */
/**
 * Den effektive totalterskelen: modulens egen, ellers plattformens standard.
 *
 * ⚠️ QA-porten 2026-08-27: visningen (#940) leste `passRules.totalMin ?? null` mens vedtaket leste
 * `?? rules.thresholds.totalMin`. En blandet modul UTEN eksplisitt grense ble dermed avgjort mot 70
 * mens skjermen ikke viste noe krav i det hele tatt. Det er #949-feilen i utelatelsesform: to
 * oppslag for samme tall, der det ene glemmer reservverdien.
 *
 * Begge sider skal kalle denne. Da kan de ikke komme i utakt.
 */
export function resolveTotalMin(assessmentPolicy: ModuleAssessmentPolicy | null | undefined): number {
  return assessmentPolicy?.passRules?.totalMin ?? getAssessmentRules().thresholds.totalMin;
}

export function resolveMcqMinPercent(
  assessmentMode: AssessmentModeType | string | null | undefined,
  assessmentPolicy: ModuleAssessmentPolicy | null | undefined,
): number | null {
  const explicit = assessmentPolicy?.passRules?.mcqMinPercent;
  if (assessmentMode === AssessmentMode.MCQ_ONLY) {
    return explicit ?? DEFAULT_MCQ_ONLY_MIN_PERCENT;
  }
  if (assessmentMode === AssessmentMode.FREETEXT_ONLY) return null;
  return explicit ?? null;
}

/**
 * «Bestod flervalgsdelen?» — tre tilstander, ikke to.
 *
 * `null` betyr **ikke aktuelt**: modulen har ingen MCQ-port, så det finnes ingenting å bestå.
 *
 * ⚠️ Den tredje tilstanden er ikke et sjeldent unntak. Den er STANDARDTILFELLET for enhver
 * blandet modul uten eksplisitt grense. Et felt som svarte «ja/nei» der, svarte på et spørsmål
 * ingen hadde stilt — samme feilklasse som resten av #978.
 */
export function deriveMcqPassFail(
  percentScore: number | null | undefined,
  minPercent: number | null,
): boolean | null {
  if (minPercent === null) return null;
  if (typeof percentScore !== "number" || Number.isNaN(percentScore)) return null;
  return percentScore >= minPercent;
}
