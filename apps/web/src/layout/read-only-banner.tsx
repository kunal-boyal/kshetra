import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@thelamp/i18n';
import { PortalBillingResult } from '@thelamp/shared';
import { Link } from '@tanstack/react-router';
import { useApp } from '../context';
import { useMe } from '../data';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';

/**
 * Says so on every screen while the organisation can't save changes (decision D140): moving to
 * another cell, or read only after an unpaid invoice or a lapsed licence (BR-48, BR-49). Billing
 * admins are also told during dunning's grace, from when it will read only, and are taken to
 * Settings › Billing; everyone else is asked to see an admin.
 */
export function ReadOnlyBanner() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const me = useMe(client).data;
  const admin = access.can('billing.manage');
  // The same query as Settings › Billing, so a payment recorded there clears the banner.
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => read(client, '/v1/billing', PortalBillingResult),
    enabled: admin && me !== undefined && !me.readOnly && !me.moving,
  });
  if (!me) return null;
  const toBilling = admin ? (
    <Link to="/settings/billing" className="ks-banner-act">
      {t('banner.open_billing')}
    </Link>
  ) : null;
  if (me.moving) {
    return (
      <p className="ks-banner info" role="status">
        <span>{t('banner.moving')}</span>
      </p>
    );
  }
  if (me.readOnly) {
    return (
      <p className="ks-banner danger" role="status">
        <span>{t(admin ? 'banner.read_only_admin' : 'banner.read_only')}</span>
        {toBilling}
      </p>
    );
  }
  const dunning = admin ? billing.data?.dunning : null;
  if (dunning?.stage !== 'grace') return null;
  return (
    <p className="ks-banner pending" role="status">
      <span>{t('banner.grace', { date: formatDate(dunning.readOnlyOn, { locale }) })}</span>
      {toBilling}
    </p>
  );
}
