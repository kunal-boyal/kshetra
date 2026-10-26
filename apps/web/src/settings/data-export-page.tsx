import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber } from '@thelamp/i18n';
import {
  ArchiveSigningKey,
  DataExportList,
  type DataExportResult,
  DataExportResult as ResultSchema,
  newId,
} from '@thelamp/shared';
import { type BadgeVariant, Button, type Column, DataTable, StatusBadge } from '@thelamp/ui-web';
import { useState } from 'react';
import { browser } from '../browser';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { Facts, PageHeader, Section } from '../people/shared';
import { Copyable } from './secret';

const KEY = ['data-exports'];
/** How often the list is read again while an export is being prepared. */
const WAITING_POLL_MS = 5000;

const STATUS_BADGE: Record<DataExportResult['status'], BadgeVariant> = {
  queued: 'waiting',
  running: 'pending',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/**
 * The organisation's data export (module M21, decision D95), for its admins: asking for the signed
 * archive of everything it holds, following it while it is prepared, downloading it while it is
 * kept, and the key that checks its signature.
 */
export function DataExportPage() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const exports = useQuery({
    queryKey: KEY,
    queryFn: () => read(client, '/v1/data-exports', DataExportList),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'queued' || item.status === 'running')
        ? WAITING_POLL_MS
        : false,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const items = exports.data?.items ?? [];
  const preparing = items.some((item) => item.status === 'queued' || item.status === 'running');

  async function ask() {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', '/v1/data-exports', ResultSchema, { id: newId() });
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('data_export.title')} intro={t('data_export.intro')}>
        <Button variant="primary" busy={busy} disabled={preparing} onClick={ask}>
          {t('data_export.ask')}
        </Button>
      </PageHeader>
      {preparing ? (
        <p role="status" className="ks-muted">
          {t('data_export.asked')}
        </p>
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <Section title={t('data_export.list_title')}>
        {exports.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(exports.error, t)}
          </p>
        ) : !exports.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <Exports items={items} />
        )}
      </Section>
      <SigningKey />
    </div>
  );
}

function Exports({ items }: { items: DataExportResult[] }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const at = (time: string) => formatDateTime(time, { locale, timeZone: access.timezone });
  const size = (bytes: number) => {
    const gb = bytes >= 1024 ** 3;
    return formatNumber(
      bytes / 1024 ** (gb ? 3 : 2),
      { locale },
      { style: 'unit', unit: gb ? 'gigabyte' : 'megabyte', maximumFractionDigits: 1 },
    );
  };
  const columns: Column<DataExportResult>[] = [
    { key: 'asked', header: t('data_export.col_asked'), render: (row) => at(row.createdAt) },
    { key: 'by', header: t('data_export.col_by'), render: (row) => row.requestedBy.name },
    {
      key: 'status',
      header: t('data_export.col_status'),
      render: (row) => (
        <span className="flex flex-col gap-1">
          <StatusBadge variant={STATUS_BADGE[row.status]}>
            {t(`data_export.status_${row.status}`)}
          </StatusBadge>
          {row.status === 'ready' && row.expiresAt ? (
            <span className="ks-help">{t('data_export.until', { time: at(row.expiresAt) })}</span>
          ) : null}
          {row.error ? <span className="ks-help error">{row.error}</span> : null}
        </span>
      ),
    },
    {
      key: 'contents',
      header: t('data_export.col_contents'),
      render: (row) =>
        row.tables === null
          ? '—'
          : t('data_export.contents', {
              tables: formatNumber(row.tables, { locale }),
              rows: formatNumber(row.rows ?? 0, { locale }),
              files: formatNumber(row.files ?? 0, { locale }),
            }),
    },
    {
      key: 'size',
      header: t('data_export.col_size'),
      align: 'end',
      render: (row) => (row.bytes === null ? '—' : size(row.bytes)),
    },
    {
      key: 'download',
      header: t('data_export.col_actions'),
      render: (row) => (row.status === 'ready' ? <Download item={row} /> : null),
    },
  ];
  return (
    <DataTable
      caption={t('data_export.list_title')}
      columns={columns}
      rows={items}
      rowKey={(row) => row.id}
      empty={<p className="ks-muted">{t('data_export.none')}</p>}
    />
  );
}

/** Asks for a day's link when pressed, so every download is in the audit log, then follows it. */
function Download({ item }: { item: DataExportResult }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        busy={busy}
        aria-label={t('data_export.download_label', {
          time: formatDateTime(item.createdAt, { locale, timeZone: access.timezone }),
        })}
        onClick={async () => {
          setBusy(true);
          setFailure(undefined);
          try {
            const found = await read(client, `/v1/data-exports/${item.id}`, ResultSchema);
            if (found.download) browser.go(found.download.url);
          } catch (error) {
            setFailure(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('data_export.download')}
      </Button>
      {item.sha256 ? (
        <span className="ks-help break-all">
          {t('data_export.sha256')}: <code>{item.sha256}</code>
        </span>
      ) : null}
      {failure ? (
        <span className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </span>
      ) : null}
    </span>
  );
}

function SigningKey() {
  const { client } = useApp();
  const { t } = useLanguage();
  const key = useQuery({
    queryKey: [...KEY, 'signing-key'],
    queryFn: () => read(client, '/v1/data-exports/signing-key', ArchiveSigningKey),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Section title={t('data_export.check_title')}>
      <p className="ks-muted">{t('data_export.check_intro')}</p>
      {key.data ? (
        <Facts
          items={[
            [t('data_export.key_id'), <code key="id">{key.data.keyId}</code>],
            [
              t('data_export.public_key'),
              <Copyable key="key" label={t('data_export.public_key')} value={key.data.publicKey} />,
            ],
          ]}
        />
      ) : key.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(key.error, t)}
        </p>
      ) : null}
    </Section>
  );
}
