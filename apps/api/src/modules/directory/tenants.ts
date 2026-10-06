import { Injectable } from '@nestjs/common';
import type { TenantStatus } from '@kshetra/shared';
import { eq } from 'drizzle-orm';
import { tenants } from '../../db/schema/directory';
import { TenantDirectory } from '../../platform/planes';
import { DirectoryDatabase } from './directory.database';

/** Tenant statuses from the tenant registry. */
@Injectable()
export class DirectoryTenants extends TenantDirectory {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  async status(tenantId: string): Promise<TenantStatus | undefined> {
    const [tenant] = await this.database.db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.status;
  }
}
