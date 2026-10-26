import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatDate } from '@thelamp/i18n';
import {
  DATA_REQUEST_KINDS,
  DataRequestList,
  type DataRequestResult,
  DataRequestResult as ResultSchema,
  type DataRequestKindKey,
  newId,
  todayIn,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  Confirm,
  DataTable,
  SelectField,
  StatusBadge,
  TextAreaField,
} from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { browser } from '../browser';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { type PickedPerson, PersonPicker } from '../people/person-picker';
import { fieldErrors, PageHeader, Section } from '../people/shared';

const KEY = ['data-requests'];
/** How often a request is read again while its archive is being prepared. */
const WAITING_POLL_MS = 5000;

const STATUS_BADGE: Record<DataRequestResult['status'], BadgeVariant> = {
  received: 'waiting',
  completed: 'success',
  refused: 'neutral',
};

/**
 * Personal data requests (module M21, decision D95), for the organisation's admins: the open ones
 * by when they are due, those answered, and logging one someone made another way.
 */
export function DataRequestsPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const open = useQuery({
    queryKey: [...KEY, 'open'],
    queryFn: () => read(client, '/v1/data-requests?status=open', DataRequestList),
  });
  const closed = useQuery({
    queryKey: [...KEY, 'closed'],
    queryFn: () => read(client, '/v1/data-requests?status=closed', DataRequestList),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('data_requests.title')} intro={t('data_requests.intro')} />
      <Section title={t('data_requests.open_title')}>
        {open.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(open.error, t)}
          </p>
        ) : !open.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : open.data.items.length === 0 ? (
          <p className="ks-muted">{t('data_requests.none_open')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.data.items.map((item) => (
              <li key={item.id}>
                <OpenSummary item={item} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <LogRequest />
      <Section title={t('data_requests.closed_title')}>
        {closed.data ? <Answered items={closed.data.items} /> : null}
      </Section>
    </div>
  );
}

function OpenSummary({ item }: { item: DataRequestResult }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const overdue = item.dueOn < todayIn(access.timezone);
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Link
        to="/settings/data-requests/$requestId"
        params={{ requestId: item.id }}
        className="font-semibold text-[var(--accent)] underline"
      >
        {item.person.name} · {t(`data_requests.kind_${item.kind}`)}
      </Link>
      <span className={overdue ? 'ks-help error' : 'ks-muted'}>
        {t(overdue ? 'data_requests.overdue' : 'data_requests.due', {
          date: formatDate(item.dueOn, { locale }),
        })}
      </span>
    </span>
  );
}

function Answered({ items }: { items: DataRequestResult[] }) {
  const { t, locale } = useLanguage();
  const columns: Column<DataRequestResult>[] = [
    {
      key: 'person',
      header: t('data_requests.col_person'),
      render: (row) => `${row.person.name} (${row.person.code})`,
    },
    {
      key: 'kind',
      header: t('data_requests.col_kind'),
      render: (row) => t(`data_requests.kind_${row.kind}`),
    },
    {
      key: 'status',
      header: t('data_requests.col_status'),
      render: (row) => (
        <StatusBadge variant={STATUS_BADGE[row.status]}>
          {t(`data_requests.status_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'closed',
      header: t('data_requests.col_closed'),
      render: (row) =>
        row.closedAt
          ? `${formatDate(row.closedAt.slice(0, 10), { locale })} · ${row.closedBy ?? ''}`
          : '—',
    },
    {
      key: 'response',
      header: t('data_requests.col_response'),
      render: (row) => row.response ?? '—',
    },
  ];
  return (
    <DataTable
      caption={t('data_requests.closed_title')}
      columns={columns}
      rows={items}
      rowKey={(row) => row.id}
      empty={<p className="ks-muted">{t('data_requests.none_closed')}</p>}
    />
  );
}

function LogRequest() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  // The request's own ID, kept until it is logged, so a retried request logs it once.
  const [id, setId] = useState(newId);
  const [person, setPerson] = useState<PickedPerson | null>(null);
  const [kind, setKind] = useState<DataRequestKindKey>('access');
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function log(event: FormEvent) {
    event.preventDefault();
    if (!person) return;
    setBusy(true);
    setErrors({});
    setFailure(undefined);
    try {
      await write(client, 'POST', '/v1/data-requests', ResultSchema, {
        id,
        userId: person.id,
        kind,
        details: details.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: KEY });
      setId(newId());
      setPerson(null);
      setDetails('');
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('data_requests.log_title')}>
      <p className="ks-muted">{t('data_requests.log_intro')}</p>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={log} noValidate>
        <PersonPicker
          label={t('data_requests.person')}
          value={person}
          onChange={setPerson}
          anyone
          {...(errors.userId ? { error: errors.userId } : {})}
        />
        <SelectField
          label={t('data_requests.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as DataRequestKindKey)}
          options={DATA_REQUEST_KINDS.map((value) => ({
            value,
            label: t(`data_requests.kind_${value}`),
          }))}
          {...(errors.kind ? { error: errors.kind } : {})}
        />
        <TextAreaField
          label={t('data_requests.details_label')}
          value={details}
          maxLength={1000}
          onChange={(event) => setDetails(event.target.value)}
        />
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          busy={busy}
          disabled={!person}
        >
          {t('data_requests.log')}
        </Button>
      </form>
    </Section>
  );
}

/** One request: what was asked, and what answering it takes. */
export function DataRequestPage({ requestId }: { requestId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const request = useQuery({
    queryKey: [...KEY, requestId],
    queryFn: () => read(client, `/v1/data-requests/${requestId}`, ResultSchema),
    refetchInterval: (query) =>
      query.state.data?.archive?.status === 'queued' ||
      query.state.data?.archive?.status === 'running'
        ? WAITING_POLL_MS
        : false,
  });
  const back = { to: '/settings/data-requests', label: t('data_requests.title') };
  if (request.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(request.error, t)}
      </p>
    );
  }
  if (!request.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const item = request.data;
  const day = (time: string) => formatDate(time.slice(0, 10), { locale });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${item.person.name} · ${t(`data_requests.kind_${item.kind}`)}`}
        back={back}
      />
      <Section title={t('data_requests.kind')}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge variant={STATUS_BADGE[item.status]}>
            {t(`data_requests.status_${item.status}`)}
          </StatusBadge>
          <span className="ks-muted">
            {t('data_requests.due', { date: formatDate(item.dueOn, { locale }) })}
          </span>
        </div>
        <p className="ks-muted">
          {item.raisedBy.self
            ? t('data_requests.raised_self', { date: day(item.createdAt) })
            : t('data_requests.raised_by', { name: item.raisedBy.name, date: day(item.createdAt) })}
        </p>
        {item.details ? <p>{t('data_requests.details', { details: item.details })}</p> : null}
        {item.response ? <p>{item.response}</p> : null}
      </Section>
      {item.status === 'received' ? <Answer item={item} /> : null}
    </div>
  );
}

function Answer({ item }: { item: DataRequestResult }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [response, setResponse] = useState('');
  const [erasing, setErasing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();

  async function act(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setErrors({});
    setFailure(undefined);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(undefined);
    }
  }
  const close = (outcome: 'completed' | 'refused') =>
    act(outcome, () =>
      write(client, 'POST', `/v1/data-requests/${item.id}/close`, ResultSchema, {
        outcome,
        response: response.trim(),
      }),
    );
  const archive = item.archive;
  const preparing = archive?.status === 'queued' || archive?.status === 'running';

  return (
    <Section title={t('data_requests.response')}>
      {item.kind === 'access' ? (
        <div className="flex flex-col gap-2">
          {archive ? <p>{t(`data_requests.archive_${archive.status}`)}</p> : null}
          {archive?.status === 'ready' ? (
            <>
              <Button
                variant="secondary"
                className="self-start"
                busy={busy === 'download'}
                onClick={() =>
                  act('download', async () => {
                    const found = await read(client, `/v1/data-requests/${item.id}`, ResultSchema);
                    if (found.download) browser.go(found.download.url);
                  })
                }
              >
                {t('data_requests.download')}
              </Button>
              <p className="ks-help">{t('data_requests.archive_hint')}</p>
            </>
          ) : (
            <Button
              variant="secondary"
              className="self-start"
              disabled={preparing}
              busy={busy === 'prepare'}
              onClick={() =>
                act('prepare', () =>
                  write(client, 'POST', `/v1/data-requests/${item.id}/archive`, ResultSchema),
                )
              }
            >
              {t('data_requests.prepare')}
            </Button>
          )}
        </div>
      ) : item.kind === 'correction' ? (
        <p className="ks-muted">
          {t('data_requests.correction_hint')}{' '}
          <Link
            to="/people/$userId"
            params={{ userId: item.person.id }}
            className="font-semibold text-[var(--accent)] underline"
          >
            {t('data_requests.open_profile')}
          </Link>
        </p>
      ) : (
        <p className="ks-muted">{t('data_requests.erasure_hint')}</p>
      )}
      <TextAreaField
        label={t('data_requests.response')}
        help={t('data_requests.response_help')}
        value={response}
        maxLength={1000}
        onChange={(event) => setResponse(event.target.value)}
        {...(errors.response ? { error: errors.response } : {})}
      />
      {errors.outcome ? (
        <p className="ks-help error" role="alert">
          {errors.outcome}
        </p>
      ) : failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {erasing ? (
        <Confirm
          question={t('data_requests.erase_question', { name: item.person.name })}
          action={
            <Button variant="danger" busy={busy === 'completed'} onClick={() => close('completed')}>
              {t('data_requests.erase')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setErasing(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {item.kind === 'erasure' ? (
            <Button variant="danger" onClick={() => setErasing(true)}>
              {t('data_requests.erase')}
            </Button>
          ) : (
            <Button
              variant="primary"
              busy={busy === 'completed'}
              onClick={() => close('completed')}
            >
              {t('data_requests.complete')}
            </Button>
          )}
          <Button variant="secondary" busy={busy === 'refused'} onClick={() => close('refused')}>
            {t('data_requests.refuse')}
          </Button>
        </div>
      )}
    </Section>
  );
}
