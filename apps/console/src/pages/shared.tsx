import type { ConsoleTenant, ModuleKey } from '@thelamp/shared';
import { type BadgeVariant, StatusBadge } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';

const STATUS_BADGE: Record<ConsoleTenant['status'], BadgeVariant> = {
  trial: 'info',
  active: 'success',
  grace: 'pending',
  read_only: 'waiting',
  suspended: 'danger',
  terminated: 'neutral',
};

/** A tenant's status as a word with a dot: the word is the meaning, the colour for scanning. */
export function TenantStatusBadge({ status }: { status: ConsoleTenant['status'] }) {
  const { t } = useLanguage();
  return <StatusBadge variant={STATUS_BADGE[status]}>{t(`console.status_${status}`)}</StatusBadge>;
}

/** Whether the signed-in staff member holds a platform permission. */
export function holds(
  staff: { permissions: readonly string[] } | null,
  permission: string,
): boolean {
  return staff?.permissions.includes(permission) ?? false;
}

/** Vendor staff see moments in their own browser's time zone. */
export const VIEWER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A plan's state: on sale, or switched off for new tenants. */
export function PlanStatusBadge({ active }: { active: boolean }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={active ? 'success' : 'neutral'}>
      {t(active ? 'console.plan_on_sale' : 'console.plan_off_sale')}
    </StatusBadge>
  );
}

/** A module's name in the product's own words; the console has no tenant terms. */
export function moduleName(key: ModuleKey, t: ReturnType<typeof useLanguage>['t']): string {
  return t(`admin.module_${key}`);
}
