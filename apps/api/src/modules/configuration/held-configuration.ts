import { Injectable } from '@nestjs/common';
import type { People, Workflows } from '@kshetra/templates';
import { eq } from 'drizzle-orm';
import { heldConfiguration } from '../../db/schema/configuration';
import type { TenantTx } from '../../platform/database';

export interface HeldSections {
  workflows: Workflows;
  people: People;
}

/**
 * Approval chains and people policies, kept until their modules arrive in phase 2 (decision
 * D66): from the template at provisioning, and from each configuration import after.
 */
@Injectable()
export class HeldConfiguration {
  async get(tx: TenantTx, tenantId: string): Promise<HeldSections | undefined> {
    const [row] = await tx
      .select({ workflows: heldConfiguration.workflows, people: heldConfiguration.people })
      .from(heldConfiguration)
      .where(eq(heldConfiguration.tenantId, tenantId));
    return row;
  }

  async save(
    tx: TenantTx,
    tenantId: string,
    sections: HeldSections,
    by: string | null,
  ): Promise<void> {
    const values = { ...sections, updatedAt: new Date(), updatedBy: by };
    await tx
      .insert(heldConfiguration)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: heldConfiguration.tenantId, set: values });
  }
}
