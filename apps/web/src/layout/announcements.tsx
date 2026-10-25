import { useQuery } from '@tanstack/react-query';
import { TenantAnnouncementList } from '@thelamp/shared';
import { useState } from 'react';
import { useApp } from '../context';
import { useLanguage } from '../i18n';
import { read } from '../people/data';
import { dismissAnnouncement, dismissedAnnouncements } from '../preferences';

/** How often the portal looks for new announcements. */
const EVERY_MS = 10 * 60_000;

/**
 * What the vendor is announcing (module M22, decision D93), above every screen: a warning in
 * amber, information in blue, each until it ends or this viewer dismisses it in this browser.
 */
export function Announcements() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const [dismissed, setDismissed] = useState(dismissedAnnouncements);
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: () => read(client, '/v1/announcements?surface=web', TenantAnnouncementList),
    refetchInterval: EVERY_MS,
  });
  const showing = (announcements.data?.items ?? []).filter((item) => !dismissed.includes(item.id));
  if (showing.length === 0) return null;
  return (
    <section aria-label={t('announce.title')} className="flex flex-col">
      {showing.map((item) => (
        <div key={item.id} className={`ks-banner ${item.tone === 'warning' ? 'pending' : 'info'}`}>
          <p className="m-0 flex min-w-0 flex-col">
            <strong>{item.title[locale]}</strong>
            <span>{item.body[locale]}</span>
          </p>
          <button
            type="button"
            className="ks-banner-act"
            aria-label={t('announce.dismiss_named', { title: item.title[locale] })}
            onClick={() => {
              dismissAnnouncement(item.id);
              setDismissed(dismissedAnnouncements());
            }}
          >
            {t('announce.dismiss')}
          </button>
        </div>
      ))}
    </section>
  );
}
