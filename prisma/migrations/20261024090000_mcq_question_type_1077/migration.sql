-- #1077: spørsmålstyper. Additivt (#811): et spørsmål uten type er dagens «ett riktig svar».
--   questionType   'single' (dagens) · 'multiple' (velg alle som stemmer); flere typer kommer.
--   answerKeyJson  typeavhengig fasit; null for 'single' (der er correctAnswer fasiten).
--   answerJson     deltakerens svar for de nye typene; selectedAnswer beholdes som lesbar tekst.
ALTER TABLE "MCQQuestion" ADD COLUMN "questionType" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "MCQQuestion" ADD COLUMN "answerKeyJson" TEXT;
ALTER TABLE "MCQResponse" ADD COLUMN "answerJson" TEXT;
