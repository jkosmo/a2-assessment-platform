import { describe, expect, it } from "vitest";
import {
  buildAdminContentAdvancedUrl,
  buildAdminContentConversationUrl,
  resolveConversationModuleId,
} from "../../public/static/admin-content-handoff-routes.js";

describe("admin content handoff routes", () => {
  it("builds advanced-editor URLs for specific modules", () => {
    expect(buildAdminContentAdvancedUrl("module/with spaces")).toBe(
      "/admin-content/module/module%2Fwith%20spaces/advanced",
    );
  });

  it("builds conversation URLs with and without resumeEditing", () => {
    expect(buildAdminContentConversationUrl("mod-1")).toBe(
      "/admin-content/module/mod-1/conversation?resumeEditing=1",
    );
    expect(buildAdminContentConversationUrl("mod-1", { resumeEditing: false })).toBe(
      "/admin-content/module/mod-1/conversation",
    );
    expect(buildAdminContentConversationUrl("", { resumeEditing: true })).toBe("/admin-content");
  });

  it("prefers the actively selected module over the query string when resolving conversation target", () => {
    expect(
      resolveConversationModuleId({
        selectedModuleId: "mod-live",
        search: "?moduleId=mod-stale",
      }),
    ).toBe("mod-live");

    expect(
      resolveConversationModuleId({
        selectedModuleId: "",
        search: "?moduleId=mod-from-query",
      }),
    ).toBe("mod-from-query");
  });
});
