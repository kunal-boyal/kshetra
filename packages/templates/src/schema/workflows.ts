import {
  ACCOUNT_REQUEST_TYPES,
  type ErrorDetail,
  issueAt,
  Key,
  REQUEST_TYPES,
  repeats,
} from '@kshetra/shared';
import { z } from 'zod';

type Path = readonly PropertyKey[];

/**
 * Who approves a step (spec 5.9). Templates hold no users, so the `specific_user` resolver is
 * left for tenants to set.
 */
export const Approver = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('reporting_manager'),
      level: z.int().min(1).max(10).default(1).meta({
        description: '1 is the direct manager, 2 is their manager, and so on up the tree',
      }),
    }),
    z.strictObject({
      type: z.literal('nearest_designation'),
      designation: Key.meta({ description: 'The closest ancestor with this designation' }),
    }),
    z.strictObject({
      type: z.literal('role_in_scope'),
      role: Key.meta({
        description: "Anyone whose role's scope covers the requester; first to act decides",
      }),
    }),
    z.strictObject({
      type: z.literal('account_slot'),
      slot: Key.meta({ description: "The user in this slot of the request's account" }),
    }),
  ])
  .meta({ id: 'Approver' });

export const WorkflowStep = z
  .strictObject({
    approver: Approver,
    escalateIfNoApprover: Key.optional().meta({
      description: 'A role to escalate to when no approver resolves. Leave out to skip the step.',
    }),
    reminderAfterHours: z.int().min(1).max(720).optional(),
    escalation: z
      .strictObject({ afterHours: z.int().min(1).max(720), to: Key })
      .optional()
      .meta({ description: 'Escalate to a role when the step has waited this long' }),
    lineDecisions: z.boolean().default(false).meta({
      description: 'Order approvers at this step decide line by line (order.line_decide)',
    }),
  })
  .meta({ id: 'WorkflowStep' });

export const Workflow = z
  .strictObject({
    requestType: z.enum(REQUEST_TYPES),
    steps: z.array(WorkflowStep).min(1).max(10),
  })
  .meta({ id: 'Workflow' });

/** Approval chains, one per request type (spec 5.9, BR-31). */
export const Workflows = z.strictObject({
  fallbackRole: Key.meta({
    description: 'Approves requests when no step of the chain remains (BR-31)',
  }),
  definitions: z.array(Workflow).max(REQUEST_TYPES.length),
});

export type Workflows = z.output<typeof Workflows>;

export interface WorkflowContext {
  roles: ReadonlySet<string>;
  designations: ReadonlySet<string>;
  /** The slot keys of every account type. */
  slots: ReadonlySet<string>;
}

/** Checks approval chains: known roles, designations and slots, and settings that fit the type. */
export function checkWorkflows(
  workflows: Workflows,
  context: WorkflowContext,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));
  const role = (key: string, rest: readonly PropertyKey[]) => {
    if (!context.roles.has(key)) at(rest, `There is no role \`${key}\``);
  };

  role(workflows.fallbackRole, ['fallbackRole']);
  const types = workflows.definitions.map((definition) => definition.requestType);
  for (const index of repeats(types)) {
    at(['definitions', index, 'requestType'], `\`${types[index]}\` already has a workflow`);
  }
  workflows.definitions.forEach((definition, d) => {
    const accountRequest = (ACCOUNT_REQUEST_TYPES as readonly string[]).includes(
      definition.requestType,
    );
    definition.steps.forEach((step, s) => {
      const here = ['definitions', d, 'steps', s];
      const { approver } = step;
      switch (approver.type) {
        case 'nearest_designation':
          if (!context.designations.has(approver.designation)) {
            at(
              [...here, 'approver', 'designation'],
              `There is no designation \`${approver.designation}\``,
            );
          }
          break;
        case 'role_in_scope':
          role(approver.role, [...here, 'approver', 'role']);
          break;
        case 'account_slot':
          if (!accountRequest) {
            at(
              [...here, 'approver'],
              `A \`${definition.requestType}\` request has no account to take a slot from`,
            );
          } else if (!context.slots.has(approver.slot)) {
            at([...here, 'approver', 'slot'], `No account type has slot \`${approver.slot}\``);
          }
          break;
        default:
          break;
      }
      if (step.escalateIfNoApprover !== undefined) {
        role(step.escalateIfNoApprover, [...here, 'escalateIfNoApprover']);
      }
      if (step.escalation) {
        role(step.escalation.to, [...here, 'escalation', 'to']);
        if (
          step.reminderAfterHours !== undefined &&
          step.reminderAfterHours >= step.escalation.afterHours
        ) {
          at([...here, 'reminderAfterHours'], 'Remind before escalating');
        }
      }
      if (step.lineDecisions && definition.requestType !== 'order') {
        at([...here, 'lineDecisions'], 'Only order approvers decide line by line');
      }
    });
  });
  return issues;
}
