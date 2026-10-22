import { z } from 'zod';
import { Key, LocalizedNoun } from './config';

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

/** A level of the tenant's geography, 1 the highest (spec 5.4). */
export const TerritoryLevel = z.object({ level: z.int(), key: z.string(), name: LocalizedNoun });

export const TerritoryListResult = z.object({
  items: z.array(TerritoryResult),
  levels: z.array(TerritoryLevel),
});

const TerritoryCode = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/,
    'Use up to 40 letters, digits, dots, dashes, slashes or underscores',
  );
const TerritoryName = z.string().trim().min(1).max(100);

/** `POST /v1/territories`: a node one level below its parent, or at the top. */
export const CreateTerritoryBody = z.strictObject({
  code: TerritoryCode,
  name: TerritoryName,
  parentId: z.uuid().nullable().default(null),
});

/**
 * `PATCH /v1/territories/{id}`: another name or code, another parent at the same level as the
 * last, or switched off or on. Send only what changes.
 */
export const UpdateTerritoryBody = z
  .strictObject({
    code: TerritoryCode.optional(),
    name: TerritoryName.optional(),
    parentId: z.uuid().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export type TerritoryResult = z.infer<typeof TerritoryResult>;
/**
 * `PUT /v1/territories/levels`: the levels, highest first (M2, spec 5.4). Levels keep their
 * place and key once added; new ones go at the bottom, and none is taken away.
 */
export const UpdateTerritoryLevelsBody = z.strictObject({
  levels: z
    .array(z.strictObject({ key: Key, name: LocalizedNoun }))
    .min(1)
    .max(6),
});

export const TerritoryLevelsResult = z.object({ levels: z.array(TerritoryLevel) });

export type TerritoryLevel = z.infer<typeof TerritoryLevel>;
export type UpdateTerritoryLevelsBody = z.output<typeof UpdateTerritoryLevelsBody>;
export type CreateTerritoryBody = z.output<typeof CreateTerritoryBody>;
export type UpdateTerritoryBody = z.infer<typeof UpdateTerritoryBody>;
export type TerritoryListQuery = z.output<typeof TerritoryListQuery>;
export type TerritoryListResult = z.infer<typeof TerritoryListResult>;
