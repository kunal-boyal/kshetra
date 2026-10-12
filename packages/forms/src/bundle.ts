import { CoreConfigBundle } from '@kshetra/shared';
import { z } from 'zod';
import { AccountTypeView } from './account-types';

/**
 * `GET /v1/config` (spec 11.2): the core bundle and the configuration that carries form-engine
 * fields, which `@kshetra/shared` can't describe (decisions D41, D43). Forms and metrics join it
 * as their steps arrive.
 */
export const ConfigBundle = CoreConfigBundle.extend({
  accountTypes: z.array(AccountTypeView),
});

export type ConfigBundle = z.output<typeof ConfigBundle>;
