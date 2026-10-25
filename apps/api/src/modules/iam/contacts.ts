import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { roles, users } from '../../db/schema/iam';
import { Database } from '../../platform/database';
import { TenantContacts } from '../../platform/planes';

/** A tenant's active admins with an email, for billing's notices (decision D90). */
@Injectable()
export class IamContacts extends TenantContacts {
  constructor(private readonly database: Database) {
    super();
  }

  admins(tenantId: string): Promise<{ name: string; email: string }[]> {
    return this.database.forTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.status, 'active'),
            eq(roles.key, 'tenant_admin'),
            isNotNull(users.email),
          ),
        );
      return rows.map((row) => ({ name: row.name, email: row.email! }));
    });
  }
}
