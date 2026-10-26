import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatDateTime } from '@thelamp/i18n';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_KINDS,
  type AuditAction,
  type AuditActorKind,
  type AuditEntry,
  AuditListResult,
  todayIn,
} from '@thelamp/shared';
import { Button, type Column, DataTable, SelectField, TextField } from '@thelamp/ui-web';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { type PickedPerson, PersonPicker } from '../people/person-picker';
import { PageHeader, Section } from '../people/shared';
import { useStartExport } from '../reports/data';

const PAGE = 50;
/** The actions, sorted, so one can be found in the list. */
const ACTIONS = [...AUDIT_ACTIONS].sort();

/**
 * The audit log (module M21, decision D95), for those who may view it: every change made in the
 * organisation, by month, narrowed to one action, one kind of actor or one person, with what each
 * changed before and after, and the same filters exported as a file.
 */
export function AuditLogPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const startExport = useStartExport();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const [action, setAction] = useState<AuditAction | ''>('');
  const [actorKind, setActorKind] = useState<AuditActorKind | ''>('');
  const [person, setPerson] = useState<PickedPerson | null>(null);
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  const query = new URLSearchParams({ period, limit: String(PAGE) });
  if (action) query.set('action', action);
  if (actorKind) query.set('actorKind', actorKind);
  if (person) query.set('actorId', person.id);
  const log = useInfiniteQuery({
    queryKey: ['audit-log', query.toString()],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/audit?${query}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        AuditListResult,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((page) => page.items) ?? [];

  async function exportAs(format: 'csv' | 'xlsx') {
    setFailure(undefined);
    try {
      await startExport({
        report: 'audit_log',
        format,
        locale,
        filters: {
          period,
          ...(action ? { auditAction: action } : {}),
          ...(actorKind ? { auditActorKind: actorKind } : {}),
          ...(person ? { userId: person.id } : {}),
        },
      });
      setExporting(true);
    } catch (error) {
      setFailure(error);
    }
  }

  const who = (row: AuditEntry) => row.actor.name ?? t(`audit.actor_${row.actor.kind}`);
  const columns: Column<AuditEntry>[] = [
    {
      key: 'when',
      header: t('audit_log.col_when'),
      render: (row) => formatDateTime(row.createdAt, { locale, timeZone: access.timezone }),
    },
    { key: 'who', header: t('audit_log.col_who'), render: who },
    {
      key: 'action',
      header: t('audit_log.col_action'),
      render: (row) => <code>{row.action}</code>,
    },
    {
      key: 'target',
      header: t('audit_log.col_target'),
      render: (row) => (
        <span className="break-all">
          {row.target.type}
          {row.target.id ? (
            <>
              {' '}
              <code className="ks-muted">{row.target.id}</code>
            </>
          ) : null}
        </span>
      ),
    },
    { key: 'from', header: t('audit_log.col_from'), render: (row) => row.ip ?? '—' },
    {
      key: 'changes',
      header: t('audit_log.col_changes'),
      render: (row) =>
        row.before === null && row.after === null ? (
          '—'
        ) : (
          <details>
            <summary className="cursor-pointer">{t('audit_log.show_changes')}</summary>
            <div className="flex flex-col gap-2">
              {row.before !== null ? (
                <div>
                  <span className="ks-label">{t('audit_log.before')}</span>
                  <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(row.before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {row.after !== null ? (
                <div>
                  <span className="ks-label">{t('audit_log.after')}</span>
                  <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(row.after, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </details>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('audit_log.title')} intro={t('audit_log.intro')} />
      <Section title={t('audit_log.filters')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TextField
            label={t('audit_log.month')}
            type="month"
            value={period}
            onChange={(event) => {
              if (event.target.value) setPeriod(event.target.value);
            }}
          />
          <SelectField
            label={t('audit_log.action')}
            none={t('audit_log.any_action')}
            value={action}
            options={ACTIONS.map((key) => ({ value: key, label: key }))}
            onChange={(event) => setAction(event.target.value as AuditAction | '')}
          />
          <SelectField
            label={t('audit_log.actor_kind')}
            none={t('audit_log.anyone')}
            value={actorKind}
            options={AUDIT_ACTOR_KINDS.map((kind) => ({
              value: kind,
              label: t(`audit.actor_${kind}`),
            }))}
            onChange={(event) => setActorKind(event.target.value as AuditActorKind | '')}
          />
          <PersonPicker
            label={t('audit_log.person')}
            value={person}
            onChange={setPerson}
            none={t('audit_log.everyone')}
            anyone
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void exportAs('csv')}>
            {t('audit_log.export_csv')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void exportAs('xlsx')}>
            {t('audit_log.export_xlsx')}
          </Button>
        </div>
        {exporting ? (
          <p role="status">
            {t('audit_log.exporting')}{' '}
            <Link to="/reports" className="font-semibold text-[var(--accent)] underline">
              {t('audit_log.open_reports')}
            </Link>
          </p>
        ) : null}
        {failure ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
      </Section>
      <Section title={t('audit_log.entries')}>
        {log.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(log.error, t)}
          </p>
        ) : !log.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <DataTable
            caption={t('audit_log.entries')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            empty={<p className="ks-muted">{t('audit_log.none')}</p>}
            {...(log.hasNextPage
              ? {
                  more: {
                    label: t('common.load_more'),
                    busy: log.isFetchingNextPage,
                    onClick: () => void log.fetchNextPage(),
                  },
                }
              : {})}
          />
        )}
      </Section>
    </div>
  );
}
