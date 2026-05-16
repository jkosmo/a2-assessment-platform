-- Add assessmentBlueprint column to store LLM-generated blueprint JSON
ALTER TABLE "ModuleVersion" ADD COLUMN "assessmentBlueprint" TEXT;
