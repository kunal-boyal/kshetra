import { z } from 'zod';

/** Geography (spec 5.4, module M4). Managing territories arrives with step 4 of phase 1. */

/** A node of the tenant's territory tree. */
export const TerritoryResult = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    level: z.int(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
  })
  .meta({ id: 'Territory' });

/** `GET /v1/territories`: the whole tree, for pickers and filters. */
export const TerritoryListQuery = z.strictObject({
  active: z.stringbool().optional().meta({ description: 'Only active nodes, or only inactive' }),
});

export const TerritoryListResult = z.object({ items: z.array(TerritoryResult) });

export type TerritoryResult = z.infer<typeof TerritoryResult>;
export type TerritoryListQuery = z.output<typeof TerritoryListQuery>;
export type TerritoryListResult = z.infer<typeof TerritoryListResult>;
