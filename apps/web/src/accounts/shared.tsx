import type { AccountTypeView } from '@thelamp/forms';
import type { AccountStatus, Locale, LocationStatus } from '@thelamp/shared';
import { type BadgeVariant, StatusBadge } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';

const STATUS_VARIANTS: Record<AccountStatus, BadgeVariant> = {
  pending: 'waiting',
  active: 'success',
  inactive: 'neutral',
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={STATUS_VARIANTS[status]}>{t(`account.status_${status}`)}</StatusBadge>
  );
}

export function LocationBadge({ status }: { status: LocationStatus }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={status === 'verified' ? 'success' : 'pending'}>
      {t(`account.location_${status}`)}
    </StatusBadge>
  );
}

/** A slot's name in the reader's language. */
export function slotName(type: AccountTypeView | undefined, key: string, locale: Locale): string {
  return type?.slots.find((slot) => slot.key === key)?.name[locale] ?? key;
}

/** A segment's name in the reader's language, from the rule that tags it. */
export function segmentName(
  type: AccountTypeView | undefined,
  key: string,
  locale: Locale,
): string {
  return type?.segmentRules.find((rule) => rule.segment === key)?.name[locale] ?? key;
}
