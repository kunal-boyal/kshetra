import { checkChain, type ChainContext, Workflow } from '@thelamp/forms';
import { type ErrorDetail, issueAt, Key, REQUEST_TYPES, repeats } from '@thelamp/shared';
import { z } from 'zod';

export { Approver, Workflow, WorkflowStep } from '@thelamp/forms';

type Path = readonly PropertyKey[];

/** Approval chains, one per request type (spec 5.9, BR-31). The steps' schemas are the form engine's (D74). */
export const Workflows = z.strictObject({
  fallbackRole: Key.meta({
    description: 'Approves requests when no step of the chain remains (BR-31)',
  }),
  definitions: z.array(Workflow).max(REQUEST_TYPES.length),
});

export type Workflows = z.output<typeof Workflows>;

/** What a template's chains may refer to. Templates hold no people, so no step names one. */
export type WorkflowContext = Omit<ChainContext, 'users'>;

/** Checks approval chains: known roles, designations and slots, and settings that fit the type. */
export function checkWorkflows(
  workflows: Workflows,
  context: WorkflowContext,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (!context.roles.has(workflows.fallbackRole)) {
    issues.push(
      issueAt([...path, 'fallbackRole'], `There is no role \`${workflows.fallbackRole}\``),
    );
  }
  const types = workflows.definitions.map((definition) => definition.requestType);
  for (const index of repeats(types)) {
    issues.push(
      issueAt(
        [...path, 'definitions', index, 'requestType'],
        `\`${types[index]}\` already has a workflow`,
      ),
    );
  }
  workflows.definitions.forEach((definition, d) => {
    issues.push(
      ...checkChain(definition.requestType, definition.steps, context, [
        ...path,
        'definitions',
        d,
        'steps',
      ]),
    );
  });
  return issues;
}
