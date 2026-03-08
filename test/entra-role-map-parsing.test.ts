import { describe, expect, it } from "vitest";
import { parseEntraGroupRoleMapJson } from "../src/auth/entraRoleMap.js";

describe("parseEntraGroupRoleMapJson", () => {
  it("parses UTF-8 BOM-prefixed JSON and normalizes role names", () => {
    const input =
      '\uFEFF{"group-a":"participant","group-b":"  reviewer  ","group-c":"NOT_A_ROLE","group-d":123}';

    const map = parseEntraGroupRoleMapJson(input);

    expect(map["group-a"]).toBe("PARTICIPANT");
    expect(map["group-b"]).toBe("REVIEWER");
    expect(map["group-c"]).toBeUndefined();
    expect(map["group-d"]).toBeUndefined();
  });

  it("returns empty map for blank content", () => {
    expect(parseEntraGroupRoleMapJson("   ")).toEqual({});
  });

  it("throws for invalid JSON", () => {
    expect(() => parseEntraGroupRoleMapJson("{bad-json")).toThrow(
      "ENTRA group role map is not valid JSON.",
    );
  });
});
