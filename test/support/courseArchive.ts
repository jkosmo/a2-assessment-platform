import request from "supertest";
import { expect } from "vitest";
import { app } from "../../src/app.js";

/**
 * #1150 skive 2a-2: arkiver et kurs slik dialogen gjør. Forhåndsvisningen hentes, og det den viser, sendes med som `expected`.
 * Fra 2a-2 arkiveres et kurs uten `expected` bare når ingen er midt i og ingenting følger med; tester som bare vil ha et
 * arkivert kurs (og ikke måler bekreftelsen), går hit. Svarer med svaret fra arkiveringen og forhåndsvisningen.
 */
export async function archiveCourseConfirmed(courseId: string, headers: Record<string, string>) {
  const preview = await request(app).get(`/api/admin/content/courses/${courseId}/archive-preview`).set(headers);
  expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
  const follows = preview.body.follows as Array<{ type: "MODULE" | "SECTION"; id: string }>;
  const response = await request(app)
    .post(`/api/admin/content/courses/${courseId}/archive`)
    .set(headers)
    .send({
      expected: {
        follows: {
          moduleIds: follows.filter((item) => item.type === "MODULE").map((item) => item.id),
          sectionIds: follows.filter((item) => item.type === "SECTION").map((item) => item.id),
        },
        inProgressCount: preview.body.inProgressCount as number,
      },
    });
  return { response, preview: preview.body };
}
