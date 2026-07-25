-- #798: the recert + course reminder scans now range-filter on the due/expiry date (<= horizon) instead
-- of loading whole tables. Index those range columns so the filter is an index scan.
CREATE INDEX "CertificationStatus_expiryDate_idx" ON "CertificationStatus"("expiryDate");
CREATE INDEX "CourseEnrollment_dueAt_idx" ON "CourseEnrollment"("dueAt");
CREATE INDEX "CourseGroupAssignment_dueAt_idx" ON "CourseGroupAssignment"("dueAt");
