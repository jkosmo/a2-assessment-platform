-- #997: «bestått gjelder til modulen revideres». Forfatteren kan merke en modulversjon som en
-- revisjon som erstatter tidligere bestått; da settes de beståtte sertifiseringene til SUPERSEDED.
--
-- ⚠️ SUPERSEDED legges IKKE til i CERTIFICATION_PASSED_STATUSES (certificationRepository.ts) —
-- det er nettopp derfor verdien slutter å telle i kursbevisporten uten at noen leser må endres.
--
-- Ingen dataflytting: eksisterende rader beholder statusen sin til noen faktisk publiserer med
-- valget på.
ALTER TYPE "CertificationLifecycleStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TABLE "CertificationStatus" ADD COLUMN IF NOT EXISTS "supersededByVersionId" TEXT;
ALTER TABLE "CertificationStatus" ADD CONSTRAINT "CertificationStatus_supersededByVersionId_fkey"
  FOREIGN KEY ("supersededByVersionId") REFERENCES "ModuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
