-- AA-3 fix (#651): freeze the issuer's effective roles on the token so token-auth
-- doesn't depend on re-deriving Entra JWT-claim roles (which aren't persisted).
ALTER TABLE "AgentAuthoringToken" ADD COLUMN "rolesJson" TEXT NOT NULL DEFAULT '[]';
