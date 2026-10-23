import { APPROVAL_STATUSES, REQUEST_TYPES, STEP_STATUSES } from '@thelamp/shared';
import { foreignKey, index, integer, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * Approvals (spec 5.9, 10.3), owned by the workflow module. Phase 1 makes one step per request,
 * decided by the requester's manager (decision D38); phase 2 adds `workflow_definitions` and its
 * chains, and fills `definition_id`.
 */

export const requestType = cell.enum('request_type', REQUEST_TYPES);
export const approvalStatus = cell.enum('approval_status', APPROVAL_STATUSES);
export const stepStatus = cell.enum('step_status', STEP_STATUSES);

export const workflowInstances = cell
  .table(
    'workflow_instances',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      definitionId: uuid('definition_id'),
      requestType: requestType('request_type').notNull(),
      requestId: uuid('request_id').notNull(),
      requesterId: uuid('requester_id').notNull(),
      currentStep: integer('current_step').notNull().default(0),
      status: approvalStatus('status').notNull().default('pending'),
      /** Moves with every decision, so two approvers acting at once can't both succeed (BR-31). */
      version: integer('version').notNull().default(1),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      closedAt: timestamp('closed_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('workflow_instances_request').on(table.tenantId, table.requestType, table.requestId),
      index('workflow_instances_requester').on(table.tenantId, table.requesterId),
      foreignKey({
        name: 'workflow_instances_requester_fk',
        columns: [table.tenantId, table.requesterId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const workflowSteps = cell
  .table(
    'workflow_steps',
    {
      tenantId: uuid('tenant_id').notNull(),
      instanceId: uuid('instance_id').notNull(),
      stepIndex: integer('step_index').notNull(),
      approverIds: uuid('approver_ids').array().notNull(),
      status: stepStatus('status').notNull(),
      actedBy: uuid('acted_by'),
      actedAt: timestamp('acted_at', { withTimezone: true }),
      note: text('note'),
      dueAt: timestamp('due_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.instanceId, table.stepIndex] }),
      // The inbox: the pending steps that name the caller.
      index('workflow_steps_approvers').using('gin', table.approverIds),
      foreignKey({
        name: 'workflow_steps_instance_fk',
        columns: [table.tenantId, table.instanceId],
        foreignColumns: [workflowInstances.tenantId, workflowInstances.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
