-- Rename guidanceText → assessorExpectedContent on ModuleVersion.
-- guidanceText was used as hidden assessor scoring support; the new name reflects its actual role.
ALTER TABLE "ModuleVersion" RENAME COLUMN "guidanceText" TO "assessorExpectedContent";
