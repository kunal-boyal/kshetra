import { z } from 'zod';
import { CustomField } from './fields';

/**
 * The tenant's custom user fields (spec 5.3), defined like an account type's custom fields. A
 * field taken out of use is retired rather than forgotten: its key stays taken, with its type,
 * so values already stored never change meaning, and it can come back as it was. The schemas
 * live here, beside `CustomField`, because `@kshetra/shared` can't depend on this package.
 */
export const UserFieldsResult = z
  .object({
    fields: z.array(CustomField),
    retired: z.array(CustomField),
  })
  .meta({ id: 'UserFields' });

/** `PUT /v1/user-fields`: the fields in use, in order, replacing the ones before. */
export const UpdateUserFieldsBody = z.strictObject({
  fields: z.array(CustomField).max(30),
});

export type UserFieldsResult = z.output<typeof UserFieldsResult>;
export type UpdateUserFieldsBody = z.output<typeof UpdateUserFieldsBody>;
