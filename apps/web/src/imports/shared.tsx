import type { MessageKey } from '@kshetra/i18n';
import type { ImportFieldInfo, ImportStatus, ImportTarget, Locale } from '@kshetra/shared';
import { type BadgeVariant, StatusBadge } from '@kshetra/ui-web';
import { useLanguage } from '../i18n';

const STATUS_VARIANTS: Record<ImportStatus, BadgeVariant> = {
  reading: 'pending',
  mapping: 'waiting',
  validating: 'pending',
  ready: 'info',
  invalid: 'danger',
  committing: 'pending',
  committed: 'success',
  failed: 'danger',
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={STATUS_VARIANTS[status]}>{t(`import.status_${status}`)}</StatusBadge>
  );
}

/** The standard fields each import knows, as the apps name them; custom fields bring a label. */
const FIELD_KEYS = {
  users: [
    'code',
    'name',
    'mobile',
    'email',
    'designation',
    'role',
    'reports_to',
    'territory_codes',
    'joining_date',
  ],
  territories: ['code', 'name', 'parent_code', 'level', 'active'],
} as const satisfies Record<ImportTarget, readonly string[]>;

/** A field's name in the reader's language: its own label, or the app's word for it. */
export function fieldName(
  target: ImportTarget,
  field: Pick<ImportFieldInfo, 'key' | 'label'> | undefined,
  key: string,
  t: ReturnType<typeof useLanguage>['t'],
  locale: Locale,
): string {
  if (field?.label) return field.label[locale];
  const known = (FIELD_KEYS[target] as readonly string[]).includes(key);
  // Every known key has a message: `import.field_<target>_<key>`.
  return known ? t(`import.field_${target}_${key}` as MessageKey) : key;
}
