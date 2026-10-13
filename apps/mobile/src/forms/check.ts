import { checkFormValues, type FormDefinition, type Values } from '@kshetra/forms';
import type { MessageKey } from '@kshetra/i18n';
import type { EntryData } from './fields';
import { issueText } from './issues';

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** What the person has filled in so far. */
export interface EntryParts {
  values: Values;
  accountId: string | null;
  photos: readonly string[];
  signature: readonly string[] | null;
}

/**
 * Checks an entry before it is submitted (spec 5.6), the way the server will: its values with
 * `checkFormValues`, looking up what the phone holds, then the form's own needs: the account it
 * links to, its photos and its signature. Returns the values as they will be sent, and each
 * problem by path, in the reader's words.
 */
export function checkEntry(
  form: FormDefinition,
  parts: EntryParts,
  data: Pick<EntryData, 'accounts' | 'contacts' | 'items' | 'today'>,
  t: Translate,
): { values: Values; issues: Map<string, string> } {
  const accountTypes = new Map(data.accounts.map((account) => [account.id, account.type]));
  const items = new Map(data.items.map((item) => [item.id, item]));
  const products = new Set(data.items.filter((item) => item.active).map((item) => item.product.id));
  const checked = checkFormValues(form, parts.values, {
    today: data.today,
    accountType: (id) => accountTypes.get(id) ?? null,
    contactAtAccount: (id) =>
      data.contacts.some((contact) => contact.id === id && contact.accountId === parts.accountId),
    activeItem: (id) => items.get(id)?.active ?? false,
    catalogueEntry: (source, id) =>
      source === 'catalogue_items' ? (items.get(id)?.active ?? false) : products.has(id),
  });
  const issues = new Map(checked.issues.map((issue) => [issue.path, issueText(issue.issue, t)]));
  const link = form.accountLink;
  if (link.mode !== 'none') {
    const type = parts.accountId ? accountTypes.get(parts.accountId) : undefined;
    if (!parts.accountId) {
      if (link.mode === 'required') issues.set('accountId', t('entry.issue_account'));
    } else if (!type || !link.accountTypes.includes(type)) {
      issues.set('accountId', t('entry.issue_choose'));
    }
  }
  if (form.photos) {
    const count = parts.photos.length;
    if (count < form.photos.min) {
      issues.set('photos', t('entry.issue_photos_min', { count: form.photos.min }));
    } else if (count > form.photos.max) {
      issues.set('photos', t('entry.issue_photos_max', { count: form.photos.max }));
    }
  }
  if (form.signature === 'required' && (parts.signature?.length ?? 0) === 0) {
    issues.set('signature', t('entry.issue_signature'));
  }
  return { values: checked.values, issues };
}
