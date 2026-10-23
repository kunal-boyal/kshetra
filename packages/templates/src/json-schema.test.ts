import { expect, it } from 'vitest';
import { templateJsonSchema } from './json-schema';

// schema.json is generated: after changing the zod schema, run `pnpm --filter @thelamp/templates
// schema` to rewrite it. CI fails while the committed file is out of date.
it('keeps schema.json in step with the zod schema', async () => {
  await expect(`${JSON.stringify(templateJsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
    '../schema.json',
  );
});
