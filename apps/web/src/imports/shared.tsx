import type { MessageKey } from '@thelamp/i18n';
import type { ImportFieldInfo, ImportStatus, ImportTarget, Locale } from '@thelamp/shared';
import { type BadgeVariant, StatusBadge } from '@thelamp/ui-web';
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
  accounts: [
    'code',
    'name',
    'territory_code',
    'parent_code',
    'latitude',
    'longitude',
    'geofence_radius_m',
    'address',
    'city',
    'state',
    'pin',
    'active',
  ],
  items: [
    'item_code',
    'item_name',
    'product_name',
    'category',
    'pack_label',
    'base_unit',
    'case_factor',
    'measure_type',
    'measure_per_base_unit',
    'measure_per_case',
    'hsn',
    'tax_rate',
    'mrp',
    'price',
    'discount_pct',
    'expected_net_price',
    'expected_final_price',
    'price_list',
    'active',
  ],
  // Their metric columns carry their own labels.
  targets: ['code', 'period', 'lock'],
  account_plans: ['account_code', 'period'],
  // Their ageing columns carry their own labels.
  finance_snapshots: [
    'account_code',
    'as_of',
    'outstanding',
    'credit_limit',
    'inventory_value',
    'source',
  ],
  ledger_entries: ['reference', 'account_code', 'date', 'description', 'debit', 'credit'],
  holidays: ['calendar', 'date', 'name', 'optional'],
  external_metrics: ['metric', 'date', 'period', 'employee_code', 'account_code', 'value'],
  payroll_gross: ['code', 'gross', 'from'],
} as const satisfies Record<string, readonly string[]>;

/** A field's name in the reader's language: its own label, or the app's word for it. */
export function fieldName(
  target: ImportTarget,
  field: Pick<ImportFieldInfo, 'key' | 'label'> | undefined,
  key: string,
  t: ReturnType<typeof useLanguage>['t'],
  locale: Locale,
): string {
  if (field?.label) return field.label[locale];
  // A family of targets, such as every `accounts:<type>`, shares its fields' names.
  const family = target.split(':')[0] as keyof typeof FIELD_KEYS;
  const known = (FIELD_KEYS[family] as readonly string[] | undefined)?.includes(key) ?? false;
  // Every known key has a message: `import.field_<family>_<key>`.
  return known ? t(`import.field_${family}_${key}` as MessageKey) : key;
}
