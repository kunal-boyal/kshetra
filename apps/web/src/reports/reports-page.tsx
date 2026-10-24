import { formatNumber } from '@thelamp/i18n';
import {
  type ExportFormat,
  type ExportResult,
  type ExportStatus,
  REPORT_KEYS,
  REPORT_MODULE,
  REPORT_PERMISSION,
  type ReportCell,
  type ReportColumn,
  type ReportFilters,
  type ReportKey,
  todayIn,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useTerritories, useUsers } from '../people/data';
import { PageHeader, Section, useDates } from '../people/shared';
import { download, useExports, useReport, useStartExport } from './data';

type Row = Record<string, ReportCell>;

const EXPORT_BADGE: Record<ExportStatus, BadgeVariant> = {
  queued: 'pending',
  running: 'pending',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/** A cell as the reader reads it: numbers, dates and moments in their language. */
function useCell() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  return (column: ReportColumn, value: ReportCell): string => {
    if (value === null || value === '') return '—';
    switch (column.kind) {
      case 'datetime':
        return dates.dateTime(String(value));
      case 'date':
        return dates.date(String(value));
      case 'number':
      case 'decimal':
        return formatNumber(Number(value), { locale });
      case 'percent':
        return `${formatNumber(Number(value), { locale })}%`;
      case 'boolean':
        return value === true ? t('common.yes') : t('common.no');
      default:
        return String(value);
    }
  };
}

/** The person's recent files, with a fresh link to each ready one. */
function Downloads() {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const exports = useExports(true);
  const [error, setError] = useState<unknown>();
  const items = exports.data ?? [];
  return (
    <Section title={t('report.exports')}>
      {exports.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(exports.error, t)}
        </p>
      ) : items.length === 0 ? (
        <p className="ks-muted">{t('report.exports_none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item: ExportResult) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {t(`report.name_${item.report}`)} · {item.filters.period} ·{' '}
                {item.format.toUpperCase()}
              </span>
              <StatusBadge variant={EXPORT_BADGE[item.status]}>
                {t(`report.export_status_${item.status}`)}
              </StatusBadge>
              {item.status === 'ready' && item.expiresAt ? (
                <span className="ks-muted text-sm">
                  {t('report.export_kept', { date: dates.dateTime(item.expiresAt) })}
                </span>
              ) : null}
              {item.status === 'ready' && item.fileName ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Icon icon={Download} />}
                  onClick={() => {
                    setError(undefined);
                    download(client, item.id).catch(setError);
                  }}
                >
                  {t('report.export_download', { file: item.fileName })}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error !== undefined ? (
        <p className="ks-help error" role="alert">
          {errorMessage(error, t)}
        </p>
      ) : null}
    </Section>
  );
}

/**
 * Reports (M18): a report for a month, narrowed to a team, a territory or one person within the
 * reader's scope, read a page at a time and downloaded as a file made in the background.
 */
export function ReportsPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const bundle = config.data?.bundle;
  const [report, setReport] = useState<ReportKey>('activity_log');
  const [filters, setFilters] = useState<ReportFilters>(() => ({
    period: todayIn(access.timezone).slice(0, 7),
  }));
  const [started, setStarted] = useState(false);
  const [exportError, setExportError] = useState<unknown>();
  const people = useUsers({ status: 'active' }, 200);
  const territories = useTerritories();
  const page = useReport(report, filters, locale);
  const startExport = useStartExport();
  const pages = page.data?.pages ?? [];
  const columns = pages[0]?.columns ?? [];
  const rows = pages.flatMap((entry) => entry.rows);
  const cell = useCell();
  const canExport = access.can('export.create');
  // A report of a switched-off module isn't offered (spec 5.13), nor one whose records the
  // person may not see elsewhere, such as the audit log.
  const off = bundle?.settings.modulesOff ?? [];
  const offered = REPORT_KEYS.filter((key) => {
    const module = REPORT_MODULE[key];
    const permission = REPORT_PERMISSION[key];
    return (!module || !off.includes(module)) && (!permission || access.can(permission));
  });
  const personOptions = (people.data?.pages.flatMap((entry) => entry.items) ?? []).map(
    (person) => ({ value: person.id, label: `${person.name} (${person.code})` }),
  );
  const set = (change: Partial<ReportFilters>) =>
    setFilters((current) => {
      const next: ReportFilters = { ...current, ...change };
      for (const [key, value] of Object.entries(change)) {
        if (value === '' || value === undefined) delete next[key as keyof ReportFilters];
      }
      return next;
    });

  async function exportAs(format: ExportFormat) {
    setExportError(undefined);
    try {
      await startExport({ report, filters, format, locale });
      setStarted(true);
    } catch (caught) {
      setExportError(caught);
    }
  }

  const tableColumns: Column<Row>[] = columns.map((column) => ({
    key: column.key,
    header: column.label,
    ...(['number', 'decimal', 'percent'].includes(column.kind) ? { align: 'end' as const } : {}),
    render: (row) => cell(column, row[column.key] ?? null),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('report.title')} intro={t('report.intro')} />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={t('report.choose')}
          value={report}
          options={offered.map((key) => ({ value: key, label: t(`report.name_${key}`) }))}
          onChange={(event) => {
            setReport(event.target.value as ReportKey);
            set({ form: undefined, accountType: undefined });
          }}
        />
        <TextField
          label={t('plan.month')}
          type="month"
          value={filters.period}
          onChange={(event) => {
            if (event.target.value) set({ period: event.target.value });
          }}
        />
        {access.can('user.view') ? (
          <>
            <SelectField
              label={t('report.filter_manager')}
              none={t('report.all')}
              value={filters.managerId ?? ''}
              options={personOptions}
              onChange={(event) => set({ managerId: event.target.value })}
            />
            <SelectField
              label={t('report.filter_user')}
              none={t('report.all')}
              value={filters.userId ?? ''}
              options={personOptions}
              onChange={(event) => set({ userId: event.target.value })}
            />
          </>
        ) : null}
        <SelectField
          label={t('report.filter_territory')}
          none={t('report.all')}
          value={filters.territoryId ?? ''}
          options={(territories.data ?? []).map((territory) => ({
            value: territory.id,
            label: `${territory.name} (${territory.code})`,
          }))}
          onChange={(event) => set({ territoryId: event.target.value })}
        />
        {report === 'activity_log' ? (
          <>
            <SelectField
              label={t('report.filter_account_type')}
              none={t('report.all')}
              value={filters.accountType ?? ''}
              options={(bundle?.accountTypes ?? []).map((type) => ({
                value: type.key,
                label: type.name[locale].one,
              }))}
              onChange={(event) => set({ accountType: event.target.value })}
            />
            <SelectField
              label={t('report.filter_form')}
              none={t('report.all')}
              help={t('report.form_hint')}
              value={filters.form ?? ''}
              options={(bundle?.forms ?? []).map((form) => ({
                value: form.key,
                label: form.name[locale].one,
              }))}
              onChange={(event) => set({ form: event.target.value })}
            />
          </>
        ) : null}
      </div>
      {canExport ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Icon icon={FileSpreadsheet} />}
            onClick={() => void exportAs('xlsx')}
          >
            {t('report.export_xlsx')}
          </Button>
          <Button
            variant="secondary"
            icon={<Icon icon={FileText} />}
            onClick={() => void exportAs('csv')}
          >
            {t('report.export_csv')}
          </Button>
        </div>
      ) : null}
      {started ? <Notice>{t('report.export_started')}</Notice> : null}
      {exportError !== undefined ? (
        <p className="ks-help error" role="alert">
          {errorMessage(exportError, t)}
        </p>
      ) : null}
      {page.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(page.error, t)}
        </p>
      ) : page.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('report.caption', {
            report: t(`report.name_${report}`),
            month: filters.period,
          })}
          columns={tableColumns}
          rows={rows}
          rowKey={(row) => JSON.stringify(row)}
          empty={
            <EmptyState icon={<Icon icon={Sheet} />} title={t('report.empty_title')}>
              {t('report.empty_body')}
            </EmptyState>
          }
          {...(page.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  onClick: () => void page.fetchNextPage(),
                  busy: page.isFetchingNextPage,
                },
              }
            : {})}
        />
      )}
      {canExport ? <Downloads /> : null}
    </div>
  );
}
