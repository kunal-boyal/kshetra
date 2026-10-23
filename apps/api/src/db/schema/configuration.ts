import type { People, Workflows } from '@thelamp/templates';
import { jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';

/**
 * The parts of a tenant's configuration that no module uses yet (M2, decision D66): people
 * policies wait for the HR modules in phase 2. Owned by the configuration module, which keeps them
 * from the template or the last import, so an export carries them on and the phase 2 modules start
 * from them. The attendance rule, which phase 1 uses, lives with the field module. Approval chains
 * moved to the workflow module (decision D74); `workflows` is no longer written, and is dropped in
 * a later release.
 */
export const heldConfiguration = cell
  .table(
    'held_configuration',
    {
      tenantId: uuid('tenant_id').primaryKey(),
      workflows: jsonb('workflows').$type<Workflows>(),
      people: jsonb('people').$type<People>().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    () => [isolation()],
  )
  .enableRLS();
