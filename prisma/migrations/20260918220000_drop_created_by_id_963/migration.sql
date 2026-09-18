-- #963 (contract-trinn): forrige generasjon eierskap. `createdById` ble sluttet skrevet i 2.66.0
-- (ContentOwner er eneste kilde, #787) og har vært død i src siden, med vakt. Droppes nå — flere
-- releaser etter skrivestoppen, så ingen kjørende container velger kolonnen lenger.
ALTER TABLE "Module" DROP CONSTRAINT IF EXISTS "Module_createdById_fkey";
ALTER TABLE "Module" DROP COLUMN IF EXISTS "createdById";
ALTER TABLE "Class" DROP CONSTRAINT IF EXISTS "Class_createdById_fkey";
ALTER TABLE "Class" DROP COLUMN IF EXISTS "createdById";
