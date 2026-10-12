// #1095: hva en importfil med identiteter (`origin`) gjør med kurset den hører til. Ren funksjon,
// så planen kan leses og testes uten database: hvert element i fila blir enten en NY VERSJON på et
// element kurset alt har, eller OPPRETTES; elementer kurset har som fila ikke nevner, TAS UT av
// kurset (ikke slettet). Et `origin` som peker på noe kurset ikke har, er en feil — fila hører
// ikke til dette kurset, eller elementet er tatt ut etter eksporten.

export type UpdatePlanItem =
  | { type: "SECTION"; origin?: { sectionId?: string } }
  | { type: "MODULE"; origin?: { moduleId?: string } };

export type UpdatePlanEntry =
  | { index: number; type: "SECTION" | "MODULE"; action: "update"; targetId: string }
  | { index: number; type: "SECTION" | "MODULE"; action: "create" };

export interface CourseUpdatePlan {
  entries: UpdatePlanEntry[];
  removed: { sectionIds: string[]; moduleIds: string[] };
  /** `origin`-id-er fila bruker som kurset ikke har, eller som fila bruker to ganger. */
  problems: string[];
}

export function planCourseUpdate(
  items: readonly UpdatePlanItem[],
  existing: { sectionIds: Iterable<string>; moduleIds: Iterable<string> },
): CourseUpdatePlan {
  const sections = new Set(existing.sectionIds);
  const modules = new Set(existing.moduleIds);
  const seen = new Set<string>();
  const entries: UpdatePlanEntry[] = [];
  const problems: string[] = [];

  items.forEach((item, index) => {
    const targetId = item.type === "SECTION" ? item.origin?.sectionId : item.origin?.moduleId;
    if (!targetId) {
      entries.push({ index, type: item.type, action: "create" });
      return;
    }
    const known = item.type === "SECTION" ? sections.has(targetId) : modules.has(targetId);
    const key = `${item.type}:${targetId}`;
    if (!known) {
      problems.push(`item ${index + 1} (${item.type.toLowerCase()}) points at ${targetId}, which this course does not have`);
      return;
    }
    if (seen.has(key)) {
      problems.push(`item ${index + 1} (${item.type.toLowerCase()}) points at ${targetId} a second time`);
      return;
    }
    seen.add(key);
    entries.push({ index, type: item.type, action: "update", targetId });
  });

  return {
    entries,
    removed: {
      sectionIds: [...sections].filter((id) => !seen.has(`SECTION:${id}`)),
      moduleIds: [...modules].filter((id) => !seen.has(`MODULE:${id}`)),
    },
    problems,
  };
}
