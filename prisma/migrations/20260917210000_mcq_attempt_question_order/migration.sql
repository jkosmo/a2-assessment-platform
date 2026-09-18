-- #1062: forsøket husker hvilke spørsmål det fikk, og i hvilken rekkefølge.
ALTER TABLE "MCQAttempt" ADD COLUMN "questionOrderJson" TEXT;
