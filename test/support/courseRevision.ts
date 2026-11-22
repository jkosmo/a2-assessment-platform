import { prisma } from "../../src/db/prisma.js";

/**
 * #934 skive 4a: telleren kursskjemaet sender med når det lagrer et eksisterende kurs (`expectedRevision`).
 * `PUT /courses/:id` og `PUT …/content` krever den, og `PUT …/items`/`…/modules` krever den for et kurs som har
 * vært ute. Tester som lagrer slik skjemaet gjør, leser den her — det skjemaet ville fått i kursdetaljen.
 */
export async function courseRevision(courseId: string): Promise<number> {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } });
  return course.contentRevision;
}

/** `body` med telleren kurset har nå, som en fane som nettopp lastet kurset. */
export async function withRevision<T extends Record<string, unknown>>(courseId: string, body: T): Promise<T & { expectedRevision: number }> {
  return { ...body, expectedRevision: await courseRevision(courseId) };
}
