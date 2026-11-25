import { AppError } from "../../errors/AppError.js";
import { validateTranslationCompleteness, type ValidationIssue } from "../adminContent/contentValidationService.js";

/**
 * #1178 skive 2 (prinsipp 4, doc/DECISIONS.md «felles prinsipper»): publiseringen sjekker at kursets navn og beskrivelse finnes
 * på alle tre språk. Plan: doc/design/PLAN_1178_KURS_PUBLISERINGSPORT.md.
 *
 * Samme regel som modulens og seksjonens port (`missingLocalesFor`): navnet må finnes på nb, nn og en-GB. Beskrivelsen er
 * valgfri; er den tom, er den komplett, og har den tekst, må den ha det på alle tre. En ren streng (fra før språkkartene) leses
 * som bokmål.
 *
 * Én funksjon for alle veiene som gjør navnet og beskrivelsen synlige for deltakerne: «Publiser» (`publishCourse`), kaskaden
 * (`publishCourseCascade`, før noe skrives), «Publiser utkastet» (etter at utkastet er skrevet til kurset, i samme transaksjon),
 * og importen, som holder kurset tilbake i stedet for å avvise.
 */
export function courseTextGateIssues(course: { title: string | null | undefined; description: string | null | undefined }): ValidationIssue[] {
  return validateTranslationCompleteness([
    { field: "title", raw: course.title },
    ...(hasAnyText(course.description) ? [{ field: "description", raw: course.description }] : []),
  ]);
}

/**
 * Tom beskrivelse (Codex-gjennomlesingen av planen, punkt 4): `null`, en blank streng og et språkkart der alle verdiene er
 * blanke, er tomme og dermed komplette. Modul- og seksjonsporten sjekker bare om strengen er tom, så et kart med bare blanke
 * verdier ville der krevd tre språk av noe som ikke står der.
 */
function hasAnyText(raw: string | null | undefined): boolean {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return false;
  // `localizedTextCodec.parse` gir et kart uten tekst tilbake som den rå strengen («{}»), og den ville da blitt lest som
  // bokmålstekst. Kartet leses derfor her.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.values(parsed).some((value) => typeof value === "string" && value.trim().length > 0);
      }
    } catch {
      // Ikke et kart: en vanlig tekst som begynner med «{».
    }
  }
  return true;
}

/** Avvisningen når porten har funn: `422 course_translation_incomplete`, med feltene og språkene klienten fyller inn. */
export function courseTranslationIncompleteError(issues: ValidationIssue[]): AppError {
  return new AppError(
    "course_translation_incomplete",
    422,
    "The course name or description is missing in one or more languages. Fill in what is missing, and publish again; nothing was published.",
    { issues: issues.map(({ code, field, missingLocales }) => ({ code, field, missingLocales })) },
  );
}

/** Kaster `course_translation_incomplete` når navnet eller beskrivelsen mangler et språk. */
export function assertCourseTextComplete(course: { title: string | null | undefined; description: string | null | undefined }): void {
  const issues = courseTextGateIssues(course);
  if (issues.length > 0) throw courseTranslationIncompleteError(issues);
}
