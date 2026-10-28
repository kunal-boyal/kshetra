import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatNumber } from '@thelamp/i18n';
import { SESSION_LIMITS, SsoConnectionResult, SupportGrantList } from '@thelamp/shared';
import { DescriptionList, StatusBadge } from '@thelamp/ui-web';
import type { ReactNode } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { AuditLog } from './audit-log-page';

const HOUR = 3_600_000;

/**
 * Security and data (decision D104): how people sign in, how long records are kept and where the
 * organisation's data is, each linking to the page that changes it, then the audit log. Admins see
 * the cards; those who may view the audit log see the log.
 */
export function SecurityDataPage() {
  const { t } = useLanguage();
  const access = useAccess();
  const admin = access.can('settings.manage');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('security_data.title')} intro={t('security_data.intro')} />
      {admin ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17.5rem),1fr))] gap-4">
          <SignIn />
          <Keeping />
          <YourData />
        </div>
      ) : null}
      {access.can('audit.view') ? (
        <>
          <h2 className="heading-lg">{t('audit_log.title')}</h2>
          <AuditLog />
        </>
      ) : null}
    </div>
  );
}

/** A card of the page: its title, what it says, and the way to the page that changes it. */
function Card({
  title,
  to,
  label,
  children,
}: {
  title: string;
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="ks-card flex flex-col gap-3" aria-label={title}>
      <div className="ks-spread">
        <h2 className="heading-md">{title}</h2>
        <Link to={to} className="ks-btn ghost sm" aria-label={`${label}: ${title}`}>
          {label}
        </Link>
      </div>
      {children}
    </section>
  );
}

/** One line of a card: what it is, and how it stands. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ks-spread gap-3">
      <span>{label}</span>
      <span className="text-end font-semibold">{children}</span>
    </div>
  );
}

function SignIn() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const ssoOn = !access.modulesOff.includes('sso');
  const sso = useQuery({
    queryKey: ['sso'],
    queryFn: () => read(client, '/v1/sso', SsoConnectionResult),
    enabled: ssoOn,
  });
  const settings = config.data?.bundle.settings;
  const connection = sso.data?.connection;
  const hours = (ms: number) => formatNumber(ms / HOUR, { locale });
  return (
    <Card
      title={t('security_data.sign_in')}
      to={ssoOn ? '/settings/sso' : '/security'}
      label={t('security_data.change')}
    >
      {ssoOn ? (
        <Line label={t('sso.title')}>
          {!sso.data ? (
            '…'
          ) : connection?.enabled ? (
            <StatusBadge variant="success">
              {connection.enforced ? t('security_data.sso_required') : t('security_data.sso_on')}
            </StatusBadge>
          ) : (
            <StatusBadge variant="neutral">{t('security_data.sso_off')}</StatusBadge>
          )}
        </Line>
      ) : null}
      <Line label={t('security_data.two_step')}>{t('security_data.two_step_value')}</Line>
      <Line label={t('security_data.web_sessions')}>
        {t('security_data.web_sessions_value', {
          hours: hours(SESSION_LIMITS.web.idleMs),
          days: formatNumber(SESSION_LIMITS.web.absoluteMs / (24 * HOUR), { locale }),
        })}
      </Line>
      {settings ? (
        <Line label={t('security_data.phones')}>
          {t(settings.deviceBinding ? 'organisation.phones_one' : 'organisation.phones_any')}
        </Line>
      ) : null}
    </Card>
  );
}

function Keeping() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const config = useConfig(client, queryClient);
  const settings = config.data?.bundle.settings;
  const count = (value: number) => formatNumber(value, { locale });
  return (
    <Card title={t('security_data.keeping')} to="/settings/rules" label={t('security_data.change')}>
      {settings ? (
        <DescriptionList
          items={[
            [
              t('security_data.keep_points'),
              t('security_data.days_archived', {
                days: count(settings.rawLocationRetentionDays),
              }),
            ],
            [
              t('security_data.keep_routes'),
              t('security_data.days', { days: count(settings.trailRetentionDays) }),
            ],
            [
              t('security_data.keep_photos'),
              t('organisation.months_value', {
                months: count(settings.evidencePhotoRetentionMonths),
              }),
            ],
            [
              t('security_data.keep_audit'),
              t('security_data.years', { years: count(settings.auditRetentionYears) }),
            ],
          ]}
        />
      ) : null}
    </Card>
  );
}

function YourData() {
  const { client } = useApp();
  const { t } = useLanguage();
  const grants = useQuery({
    queryKey: ['support-grants'],
    queryFn: () => read(client, '/v1/support-grants', SupportGrantList),
  });
  const open = grants.data?.items.some((grant) => grant.status === 'active');
  return (
    <Card
      title={t('security_data.your_data')}
      to="/settings/data-export"
      label={t('security_data.export')}
    >
      <p className="ks-muted">{t('security_data.export_about')}</p>
      <Line label={t('support.title')}>
        {grants.data === undefined ? (
          '…'
        ) : open ? (
          <StatusBadge variant="waiting">{t('security_data.support_on')}</StatusBadge>
        ) : (
          <StatusBadge variant="neutral">{t('security_data.support_off')}</StatusBadge>
        )}
      </Line>
      <p className="ks-muted text-sm">{t('security_data.support_about')}</p>
      <Link to="/settings/support" className="ks-btn ghost sm self-start">
        {t('security_data.support_open')}
      </Link>
    </Card>
  );
}
