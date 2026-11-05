-- #934 skive 5a-2: lesespørringer før tilbakefyllingen (doc/DESIGN_934.md, «5a-2 — bygget»). Bare SELECT, ingenting skrives.

-- 1. SUPERSEDED-rader som peker på samme versjon som vedtaket de tok bort (Codex runde 2 nr. 7).
SELECT count(*) AS same_version_superseded FROM "CertificationStatus" cs
JOIN "AssessmentDecision" d ON d.id = cs."latestDecisionId"
WHERE cs.status = 'SUPERSEDED' AND d."moduleVersionId" = cs."supersededByVersionId";

-- 2. De samme radene per modul og versjon, så det kan sjekkes for hånd.
SELECT cs."moduleId", cs."supersededByVersionId", count(*) AS rows FROM "CertificationStatus" cs
JOIN "AssessmentDecision" d ON d.id = cs."latestDecisionId"
WHERE cs.status = 'SUPERSEDED' AND d."moduleVersionId" = cs."supersededByVersionId"
GROUP BY cs."moduleId", cs."supersededByVersionId";

-- 3. Revisjoner uten spor: SUPERSEDED-rader uten en `module_passes_superseded` for samme modul og versjon. Skal gi null rader.
SELECT cs."moduleId", cs."supersededByVersionId", count(*) AS rows FROM "CertificationStatus" cs
WHERE cs.status = 'SUPERSEDED' AND NOT EXISTS (
  SELECT 1 FROM "AuditEvent" a
  WHERE a.action = 'module_passes_superseded' AND a."entityType" = 'module' AND a."entityId" = cs."moduleId"
    AND a."metadataJson" LIKE '%' || cs."supersededByVersionId" || '%'
)
GROUP BY cs."moduleId", cs."supersededByVersionId";
