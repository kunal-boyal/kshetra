import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { roles, users } from '../../db/schema/iam';
import { Database } from '../../platform/database';
import { PeopleEmails, TenantContacts } from '../../platform/planes';

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

/** People by work email, for single sign-on (decision D91); emails compare without case. */
@Injectable()
export class IamPeopleEmails extends PeopleEmails {
  constructor(private readonly database: Database) {
    super();
  }

  find(tenantId: string, email: string): Promise<string | null> {
    return this.database.forTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.status, 'active'),
            eq(sql`lower(${users.email})`, email.toLowerCase()),
          ),
        )
        .limit(2);
      // Two people with one email can't be told apart, so neither signs in by it.
      return rows.length === 1 ? rows[0]!.id : null;
    });
  }

  emailOf(tenantId: string, userId: string): Promise<string | null> {
    return this.database.forTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
      return row?.email ?? null;
    });
  }
}
