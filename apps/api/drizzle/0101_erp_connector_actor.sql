-- An ERP connection writes as itself (decision D129): the audit log names it as a connector.
ALTER TYPE "cell"."audit_actor_kind" ADD VALUE 'connector';--> statement-breakpoint
-- Connecting the ERP (decision D129). The tenant admin holds every permission and no one may edit
-- its role, so existing tenants' admins take the new one here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['erp.manage']
 WHERE "key" = 'tenant_admin'
   AND NOT ('erp.manage' = ANY ("permissions"));
