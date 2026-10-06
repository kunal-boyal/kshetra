import { EmptyState, Icon } from '@kshetra/ui-web';
import { LayoutDashboard } from 'lucide-react';
import { useApp } from '../context';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';

/** Home (spec 8.2). Its tiles and charts arrive with the field modules in phase 1. */
export function HomePage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const me = useMe(client);
  const config = useConfig(client, queryClient);

  if (me.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (me.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(me.error, t)}
      </p>
    );
  }
  const designation = config.data?.bundle.designations.find(
    (entry) => entry.key === me.data.designation,
  );
  return (
    <div className="ks-stagger flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="display">{t('home.greeting', { name: me.data.name })}</h1>
        {designation && client.session ? (
          <p className="ks-muted">
            {t('home.where', {
              designation: designation.name[locale].one,
              tenant: client.session.tenant.name,
            })}
          </p>
        ) : null}
      </header>
      <EmptyState icon={<Icon icon={LayoutDashboard} />} title={t('home.empty_title')}>
        {t('home.empty_body')}
      </EmptyState>
    </div>
  );
}
