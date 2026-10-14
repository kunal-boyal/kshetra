import type { FormEntries } from '@kshetra/api-client/sync';
import type { FormView } from '@kshetra/forms';
import { newId } from '@kshetra/shared';
import { router } from 'expo-router';

/** Forms filled on their own, not inside a visit; visit forms open from the visit (M6). */
export function standalone(forms: readonly FormView[]): FormView[] {
  return forms.filter((form) => !form.visitSession);
}

/** Starts a draft of a form's current version, linked to an account if given, and opens it. */
export async function startEntry(
  sync: { entries: FormEntries },
  owner: string,
  form: FormView,
  accountId: string | null = null,
): Promise<void> {
  const id = newId();
  await sync.entries.start({ id, owner, form, accountId });
  router.push({ pathname: '/forms/[id]', params: { id } });
}
