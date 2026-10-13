import { CatalogueUnitView, CoreConfigBundle, MEASURE_TYPES } from '@kshetra/shared';
import { z } from 'zod';
import { AccountTypeView } from './account-types';
import { FormView } from './form';

/**
 * `GET /v1/config` (spec 11.2): the core bundle and the configuration that carries form-engine
 * fields, which `@kshetra/shared` can't describe (decisions D41, D43, D45, D46). Metrics join it in
 * step 12.
 */
export const ConfigBundle = CoreConfigBundle.extend({
  accountTypes: z.array(AccountTypeView),
  /** The forms in use that the caller may fill, at their current versions (spec 5.6). */
  forms: z.array(FormView),
  /** The catalogue's units and measure types, which name items' quantities (spec 5.11). */
  catalogue: z.object({
    units: z.array(CatalogueUnitView),
    measureTypes: z.array(z.enum(MEASURE_TYPES)),
  }),
});

export type ConfigBundle = z.output<typeof ConfigBundle>;
