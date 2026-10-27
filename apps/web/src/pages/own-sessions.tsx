import { describeAgent, type OwnSession, OwnSessionsResult } from '@thelamp/shared';
import { Button, type Column, Confirm, DataTable, StatusBadge } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { NOTHING, read, useAccess, write } from '../people/data';
import { Section, useDates } from '../people/shared';

/**
 * Where the person is signed in to this organisation (ASVS V7.5.2, decision D101): each browser
 * and phone, when it signed in and was last active, from which address; any but this one may be
 * ended, and every other at once.
 */
export function OwnSessions() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const sessions = useQuery({
    queryKey: ['own-sessions'],
    queryFn: () => read(client, '/auth/v1/sessions', OwnSessionsResult),
  });
  const [ending, setEnding] = useState<OwnSession | 'others'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  async function end(path: string, message: string) {
    setBusy(true);
    setError(undefined);
    try {
      await write(client, 'POST', path, NOTHING);
      setDone(message);
      setEnding(undefined);
      await queryClient.invalidateQueries({ queryKey: ['own-sessions'] });
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  const device = (session: OwnSession) => {
    if (session.kind === 'phone') return t('security.kind_phone');
    const { browser, system } = describeAgent(session.agent);
    return browser && system
      ? t('security.agent', { browser, system })
      : (browser ?? t('security.agent_unknown'));
  };

  const columns: Column<OwnSession>[] = [
    {
      key: 'device',
      header: t('security.col_device'),
      render: (session) => (
        <span className="flex flex-wrap items-center gap-2">
          {device(session)}
          {session.kind === 'sso' ? (
            <StatusBadge variant="neutral">{t('security.kind_sso')}</StatusBadge>
          ) : null}
          {session.current ? (
            <StatusBadge variant="success">{t('security.this_one')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'address',
      header: t('security.col_address'),
      render: (session) => <code>{session.ip ?? '—'}</code>,
    },
    {
      key: 'started',
      header: t('security.col_started'),
      render: (session) => dates.dateTime(session.startedAt),
    },
    {
      key: 'last',
      header: t('security.col_last'),
      render: (session) => dates.dateTime(session.lastUsedAt),
    },
    {
      key: 'end',
      header: t('security.end'),
      render: (session) =>
        session.current ? null : (
          <Button variant="ghost" size="sm" onClick={() => setEnding(session)}>
            {t('security.end')}
          </Button>
        ),
    },
  ];

  const rows = sessions.data?.items ?? [];
  return (
    <Section title={t('security.sessions')}>
      <div className="flex flex-col gap-4">
        <p className="ks-muted max-w-prose">{t('security.sessions_intro')}</p>
        {done ? <p role="status">{done}</p> : null}
        {ending ? (
          <Confirm
            question={t(
              ending === 'others' ? 'security.end_others_confirm' : 'security.end_confirm',
            )}
            action={
              <Button
                variant="danger"
                busy={busy}
                onClick={() =>
                  void (ending === 'others'
                    ? end('/auth/v1/sessions/end-others', t('security.others_ended'))
                    : end(`/auth/v1/sessions/${ending.id}/end`, t('security.ended')))
                }
              >
                {t(ending === 'others' ? 'security.end_others' : 'security.end')}
              </Button>
            }
            cancel={<Button onClick={() => setEnding(undefined)}>{t('common.cancel')}</Button>}
          />
        ) : null}
        {error ? (
          <p className="ks-help error" role="alert">
            {error}
          </p>
        ) : null}
        {sessions.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(sessions.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t('security.sessions')}
            columns={columns}
            rows={rows}
            rowKey={(session) => session.id}
          />
        )}
        {rows.some((session) => !session.current) ? (
          <Button variant="secondary" className="self-start" onClick={() => setEnding('others')}>
            {t('security.end_others')}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
