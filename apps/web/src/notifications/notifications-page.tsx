import { notificationMessage } from '@thelamp/i18n';
import {
  MarkNotificationsReadResult,
  type NotificationCategoryKey,
  type NotificationResult,
  NotificationPrefsResult,
} from '@thelamp/shared';
import { Button, EmptyState, Icon, Pager } from '@thelamp/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell, CheckCheck, Save } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, write } from '../people/data';
import { PageHeader, Section, useDates } from '../people/shared';
import { useInbox, useNotificationPrefs } from './data';
import { WhatsAppSection } from './whatsapp-section';
import { useQueryPaging } from '../paging';

/** One entry, in the reader's language: unread ones stand out; one with a link opens it. */
function Entry({ item, onOpen }: { item: NotificationResult; onOpen: () => void }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const message = notificationMessage(item.event, item.values, locale);
  const body = (
    <>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={item.readAt ? '' : 'font-semibold'}>
          {t(message.title, message.params)}
        </span>
        <span className="ks-muted text-sm">{dates.dateTime(item.createdAt)}</span>
      </span>
      <span className="ks-muted">{t(message.body, message.params)}</span>
      {item.readAt ? null : <span className="sr-only">{t('notifications.unread')}</span>}
    </>
  );
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <button type="button" className="flex w-full flex-col gap-1 py-3 text-left" onClick={onOpen}>
        {body}
      </button>
    </li>
  );
}

/**
 * Notifications (M16): the person's inbox, newest first, and what they hear about. Opening an
 * entry marks it read and goes where it leads; approvals and tracking can't be muted.
 */
export function NotificationsPage() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const inbox = useInbox();
  const prefs = useNotificationPrefs();
  const [edited, setMuted] = useState<Set<NotificationCategoryKey> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const paging = useQueryPaging(items.length, inbox);
  const unread = inbox.data?.pages[0]?.unread ?? 0;

  // What the person ticks, or else what they saved.
  const muted =
    edited ??
    (prefs.data
      ? new Set(prefs.data.categories.filter((entry) => entry.muted).map((e) => e.category))
      : null);

  async function markRead(body: { ids: string[] } | { all: true }) {
    await write(client, 'POST', '/v1/notifications/read', MarkNotificationsReadResult, body);
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function open(item: NotificationResult) {
    setFailure(undefined);
    try {
      if (!item.readAt) await markRead({ ids: [item.id] });
      if (item.link) await navigate({ to: item.link });
    } catch (caught) {
      setFailure(caught);
    }
  }

  async function save() {
    if (!muted) return;
    setSaving(true);
    setSaved(false);
    setFailure(undefined);
    try {
      const result = await write(client, 'PUT', '/v1/notification-prefs', NotificationPrefsResult, {
        muted: [...muted],
      });
      queryClient.setQueryData(['notification-prefs'], result);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('notifications.title')}>
        <Button
          icon={<Icon icon={CheckCheck} />}
          disabled={unread === 0}
          onClick={() => void markRead({ all: true }).catch(setFailure)}
        >
          {t('notifications.read_all')}
        </Button>
      </PageHeader>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <Section title={t('notifications.inbox', { count: unread })}>
        {inbox.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(inbox.error, t)}
          </p>
        ) : !inbox.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={<Icon icon={Bell} />} title={t('notifications.empty_title')}>
            {t('notifications.empty_body')}
          </EmptyState>
        ) : (
          <>
            <ul>
              {items
                .filter((_, index) => paging.onPage(index))
                .map((item) => (
                  <Entry key={item.id} item={item} onOpen={() => void open(item)} />
                ))}
            </ul>
            <Pager paging={paging} />
          </>
        )}
      </Section>
      <Section title={t('notifications.prefs_title')}>
        <p className="ks-muted">{t('notifications.prefs_intro')}</p>
        {prefs.data && muted ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('notifications.prefs_title')}</legend>
            {prefs.data.categories.map((entry) => (
              <label key={entry.category} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!muted.has(entry.category)}
                  disabled={!entry.mutable}
                  onChange={(event) => {
                    setSaved(false);
                    setMuted(() => {
                      const next = new Set(muted);
                      if (event.target.checked) next.delete(entry.category);
                      else next.add(entry.category);
                      return next;
                    });
                  }}
                />
                <span>
                  {t(`notify.category_${entry.category}`)}
                  {entry.mutable ? null : (
                    <span className="ks-muted"> · {t('notifications.always')}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="ks-muted">{t('common.loading')}</p>
        )}
        {saved ? <p role="status">{t('notifications.prefs_saved')}</p> : null}
        <Button
          variant="primary"
          className="self-start"
          icon={<Icon icon={Save} />}
          busy={saving}
          disabled={!muted}
          onClick={() => void save()}
        >
          {t('notifications.prefs_save')}
        </Button>
      </Section>
      <WhatsAppSection />
    </div>
  );
}
