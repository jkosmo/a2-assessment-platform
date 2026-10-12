// #1093: rekkefølgen i «Mine kurs». Til nå lå kursene i publiseringsrekkefølge, eldst først, og den
// eneste måten å flytte et kurs på var å avpublisere og publisere på nytt. Produkteier (2026-10-11):
// alfabetisk er det deltakeren forstår uten forklaring — og det skal gå an å løfte enkelte kurs.
//
// Regelen, ett sted: kurs med en satt rekkefølge først, stigende; resten alfabetisk på tittelen i
// deltakerens språk, tallbevisst («Modul 2» før «Modul 10»). Klienten deler lista i pågående og
// fullførte uten å sortere om, så det er denne rekkefølgen som vises innad i hver gruppe.

export interface OrderableCourse {
  title: string;
  sortOrder: number | null | undefined;
}

const collators = new Map<string, Intl.Collator>();

/** Én sorterer per språk: tallbevisst, og uten å skille på store og små bokstaver. */
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    try {
      collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    } catch {
      collator = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });
    }
    collators.set(locale, collator);
  }
  return collator;
}

/**
 * Sorterer kursene slik deltakeren skal se dem. Stabil: to kurs som er like, beholder rekkefølgen de
 * kom i. Et `sortOrder` som ikke er et tall, regnes som ikke satt.
 */
export function sortCoursesForParticipant<T extends OrderableCourse>(courses: readonly T[], locale: string): T[] {
  const collator = collatorFor(locale);
  const placed = (course: OrderableCourse) => (Number.isFinite(course.sortOrder) ? (course.sortOrder as number) : null);
  return [...courses].sort((a, b) => {
    const pa = placed(a);
    const pb = placed(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return collator.compare(a.title ?? "", b.title ?? "");
  });
}
