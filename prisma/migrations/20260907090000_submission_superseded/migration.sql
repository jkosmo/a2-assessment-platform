-- #951: en innlevering som ble forlatt fordi deltakeren leverte på nytt, er ikke et utfall.
--
-- Før denne statusen satte `supersedeEligibleReviewsForRetake` slike innleveringer til COMPLETED
-- uten å skrive et nytt vedtak. Rapportene leste da det gamle AUTOMATISKE vedtaket som endelig:
-- sa det «bestått», ble forsøket talt i bestått-raten, mens CertificationStatus aldri ble skrevet.
-- To kilder sa hver sin ting om samme deltaker.

ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
