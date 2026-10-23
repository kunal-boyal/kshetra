import type { WorkflowStep } from '@thelamp/forms';
import { APPROVAL_STATUSES, REQUEST_TYPES, SKIP_REASONS, STEP_STATUSES } from '@thelamp/shared';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * Approvals (spec 5.9, 10.3), owned by the workflow module. Each tenant keeps one chain per
 * request type, versioned, and every request records the version that routed it (decision D74).
 * A request type without a chain goes to the requester's manager, as in phase 1 (decision D38).
 */

export const requestType = cell.enum('request_type', REQUEST_TYPES);
export const approvalStatus = cell.enum('approval_status', APPROVAL_STATUSES);
export const stepStatus = cell.enum('step_status', STEP_STATUSES);
export const skipReason = cell.enum('skip_reason', SKIP_REASONS);

/** Every version of every chain: the newest of a request type is the one in force. */
export const workflowDefinitions = cell
  .table(
    'workflow_definitions',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      requestType: requestType('request_type').notNull(),
      version: integer('version').notNull(),
      steps: jsonb('steps').$type<WorkflowStep[]>().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      /** Null when provisioning or an import made it. */
      createdBy: uuid('created_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('workflow_definitions_version').on(
        table.tenantId,
        table.requestType,
        table.version,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/** The role whose holders decide when no step of a chain remains (BR-31). */
export const workflowSettings = cell
  .table(
    'workflow_settings',
    {
      tenantId: uuid('tenant_id').primaryKey(),
      fallbackRole: text('fallback_role').notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    () => [isolation()],
  )
  .enableRLS();

export const workflowInstances = cell
  .table(
    'workflow_instances',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      /** The chain version that routed it; null for a request without a chain. */
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
      foreignKey({
        name: 'workflow_instances_definition_fk',
        columns: [table.tenantId, table.definitionId],
        foreignColumns: [workflowDefinitions.tenantId, workflowDefinitions.id],
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
      skipReason: skipReason('skip_reason'),
      /** Nobody resolved, or nobody decided in time, so the step went to its escalation role. */
      escalated: boolean('escalated').notNull().default(false),
      /** The tenant's fallback approvers, added because no step of the chain remained. */
      fallback: boolean('fallback').notNull().default(false),
      actedBy: uuid('acted_by'),
      actedAt: timestamp('acted_at', { withTimezone: true }),
      note: text('note'),
      /** When the step began waiting for a decision. */
      startedAt: timestamp('started_at', { withTimezone: true }),
      /** When to remind its approvers, and when they were. */
      remindAt: timestamp('remind_at', { withTimezone: true }),
      remindedAt: timestamp('reminded_at', { withTimezone: true }),
      /** When to escalate, to which role's holders, and when it was. */
      escalateAt: timestamp('escalate_at', { withTimezone: true }),
      escalateTo: text('escalate_to'),
      escalatedAt: timestamp('escalated_at', { withTimezone: true }),
      /** Order approvers at this step decide line by line (BR-19). */
      lineDecisions: boolean('line_decisions').notNull().default(false),
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
