import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// #1114: det fantes en `conflictStrategy` her, med `merge_by_email` som standard — synkroniseringen
// koblet en eksisterende bruker til en ny Entra-ID fordi e-posten var lik. Produkteier 2026-10-25:
// «e-postadresser skal ikke kobles. Det er grunnleggende». Regelen er derfor ikke et valg lenger, og
// står i orgSyncService.ts. (En gammel `conflictStrategy` i fila leses ikke: zod dropper ukjente felt.)
const orgSyncSchema = z.object({
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
