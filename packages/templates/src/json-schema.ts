import { z } from 'zod';
import { TemplateSchema } from './schema/template';

/**
 * The JSON Schema in `schema.json`, generated from the zod schema so the two never drift. It
 * checks a template's shape in editors and other tools; `validateTemplate` also checks that
 * references resolve and settings agree.
 */
export function templateJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(TemplateSchema, { io: 'input', target: 'draft-2020-12' });
}
