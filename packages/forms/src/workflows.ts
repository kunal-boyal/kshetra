import {
  ACCOUNT_REQUEST_TYPES,
  type ErrorDetail,
  issueAt,
  Key,
  REQUEST_TYPES,
  type RequestType,
} from '@thelamp/shared';
import { z } from 'zod';
import { checkCondition, Condition } from './conditions';
import type { AnyField } from './fields';

/**
 * Approval chains (spec 5.9, BR-31, decision D74). A step's condition is the form engine's, so the
 * chains' schemas live here beside it, as user fields do (decision D41): `@thelamp/shared` can't
 * depend on this package. Templates and the API both read them from here.
 */

type Path = readonly PropertyKey[];

/** Who approves a step (spec 5.9). Templates hold no users, so only tenants name a person. */
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
    z.strictObject({
      type: z.literal('specific_user'),
      // A pattern rather than z.uuid(), whose `format` the template schema's editors don't know.
      userId: z
        .string()
        .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
        .meta({ description: 'One named person. Tenants only: templates hold no users' }),
    }),
  ])
  .meta({ id: 'Approver' });

export const WorkflowStep = z
  .strictObject({
    approver: Approver,
    condition: Condition.optional().meta({
      description:
        "Use the step only when this holds for the request's facts, such as leave_days > 3. " +
        'Leave out to use it always.',
    }),
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

export type Approver = z.output<typeof Approver>;
export type WorkflowStep = z.output<typeof WorkflowStep>;
export type Workflow = z.output<typeof Workflow>;

const label = (en: string, hi: string) => ({ en, hi });

/**
 * The facts a step's condition may test, per request type (spec 5.9). The module that owns a type
 * supplies them when a request starts, as values keyed like these fields.
 */
export const REQUEST_FACTS: Record<RequestType, readonly AnyField[]> = {
  leave: [
    {
      type: 'number',
      key: 'leave_days',
      label: label('Leave days', 'छुट्टी के दिन'),
      required: false,
      decimals: 1,
    },
    { type: 'yes_no', key: 'paid', label: label('Paid leave', 'सवेतन छुट्टी'), required: false },
  ],
  regularisation: [
    {
      type: 'number',
      key: 'days_ago',
      label: label('Days ago', 'कितने दिन पहले'),
      required: false,
      decimals: 0,
    },
  ],
  expense: [
    { type: 'currency', key: 'amount', label: label('Amount', 'राशि'), required: false },
    {
      type: 'yes_no',
      key: 'over_policy',
      label: label('Over the policy', 'नीति से अधिक'),
      required: false,
    },
  ],
  order: [
    {
      type: 'currency',
      key: 'total',
      label: label('Order total', 'ऑर्डर की कुल राशि'),
      required: false,
    },
    {
      type: 'yes_no',
      key: 'over_credit',
      label: label('Over the credit limit', 'उधार सीमा से अधिक'),
      required: false,
    },
  ],
  new_account: [],
  account_location_change: [],
  journey_plan: [],
  target_lock: [],
};

export interface ChainContext {
  roles: ReadonlySet<string>;
  designations: ReadonlySet<string>;
  /** The slot keys of every account type. */
  slots: ReadonlySet<string>;
  /** The active people a step may name; undefined for templates, which hold no users. */
  users?: ReadonlySet<string>;
}

/**
 * Checks one request type's chain: known roles, designations, slots and people, conditions on the
 * type's facts, and settings that fit the type.
 */
export function checkChain(
  requestType: RequestType,
  steps: readonly WorkflowStep[],
  context: ChainContext,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));
  const role = (key: string, rest: readonly PropertyKey[]) => {
    if (!context.roles.has(key)) at(rest, `There is no role \`${key}\``);
  };
  const accountRequest = (ACCOUNT_REQUEST_TYPES as readonly string[]).includes(requestType);
  const facts = new Map(REQUEST_FACTS[requestType].map((field) => [field.key, field]));
  steps.forEach((step, s) => {
    const here = [s];
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
            `A \`${requestType}\` request has no account to take a slot from`,
          );
        } else if (!context.slots.has(approver.slot)) {
          at([...here, 'approver', 'slot'], `No account type has slot \`${approver.slot}\``);
        }
        break;
      case 'specific_user':
        if (!context.users) {
          at(
            [...here, 'approver'],
            'A template holds no people: name one in the tenant’s settings',
          );
        } else if (!context.users.has(approver.userId)) {
          at([...here, 'approver', 'userId'], 'Choose an active person');
        }
        break;
      default:
        break;
    }
    if (step.condition) {
      issues.push(
        ...checkCondition(step.condition, facts, [...path, ...here, 'condition'], (key) =>
          facts.size === 0
            ? `A \`${requestType}\` request has no facts to test`
            : `A \`${requestType}\` request has no fact \`${key}\``,
        ),
      );
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
    if (step.lineDecisions && requestType !== 'order') {
      at([...here, 'lineDecisions'], 'Only order approvers decide line by line');
    }
  });
  return issues;
}

// The API's chain screens (spec 11.2, decision D74).

const Chain = z.object({
  requestType: z.enum(REQUEST_TYPES),
  /** 0 until the tenant has a chain for this type: then requests go to the requester's manager. */
  version: z.int().min(0),
  steps: z.array(WorkflowStep),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});

/** `GET /v1/workflows`: every request type's chain, and the fallback approver role. */
export const WorkflowsResult = z
  .object({ fallbackRole: Key, chains: z.array(Chain) })
  .meta({ id: 'Workflows' });

/** `PUT /v1/workflows/{requestType}`: a new version of a chain, made on the version shown. */
export const PutChainBody = z.strictObject({
  steps: z.array(WorkflowStep).min(1).max(10),
  version: z.int().min(0),
});

/** `PUT /v1/workflows/fallback`: who approves when no step of a chain remains (BR-31). */
export const PutFallbackBody = z.strictObject({ role: Key });

export type ChainView = z.output<typeof Chain>;
export type WorkflowsResult = z.output<typeof WorkflowsResult>;
export type PutChainBody = z.output<typeof PutChainBody>;
export type PutFallbackBody = z.output<typeof PutFallbackBody>;
