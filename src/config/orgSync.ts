import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const orgSyncSchema = z.object({
  conflictStrategy: z.enum(["merge_by_email", "skip_conflict"]).default("merge_by_email"),
  allowDepartmentOverwrite: z.boolean().default(true),
  allowManagerOverwrite: z.boolean().default(true),
  defaultActiveStatus: z.boolean().default(true),
});

export type OrgSyncConfig = z.infer<typeof orgSyncSchema>;

let cached: OrgSyncConfig | null = null;

export function getOrgSyncConfig(): OrgSyncConfig {
  if (cached) {
    return cached;
  }

  const configPath = path.resolve(process.cwd(), "config/org-sync.json");
  const raw = fs.readFileSync(configPath, "utf8");
  cached = orgSyncSchema.parse(JSON.parse(raw));
  return cached;
}
