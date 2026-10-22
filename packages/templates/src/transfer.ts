import { z } from 'zod';

/**
 * `POST /v1/configuration/import` and its preview (M2, decision D66): a configuration file, which
 * is an industry template. It is checked as a template is, so problems come back at their paths in
 * the file rather than under `template`.
 */
export const ImportConfigurationBody = z.strictObject({
  template: z.record(z.string(), z.unknown()).meta({
    description:
      'A configuration file, as `GET /v1/configuration/export` gives it (an industry template)',
  }),
});

export type ImportConfigurationBody = z.output<typeof ImportConfigurationBody>;
