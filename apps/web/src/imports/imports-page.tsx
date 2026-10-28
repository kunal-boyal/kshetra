import type { ImportSummary, ImportTarget } from '@thelamp/shared';
import { Button, type Column, cn, DataTable, EmptyState, Icon, SelectField } from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, FileUp, Upload } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import { upload, useImportChanged, useImportTargets, useImports } from './data';
import { ImportStatusBadge } from './shared';

/**
 * Imports (M19): a spreadsheet in, its columns matched to fields, every row checked, and then
 * all of it written or none. The history keeps each file's outcome.
 */
export function ImportsPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const changed = useImportChanged();
  const choices = useImportTargets();
  const targets = choices.allowed.map((choice) => choice.value);
  const [target, setTarget] = useState<ImportTarget | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>();
  const imports = useImports();
  const rows = imports.data?.pages.flatMap((page) => page.items) ?? [];
  const chosen = target || targets[0];

  async function start(event: FormEvent) {
    event.preventDefault();
    setMissing(!file);
    setError(undefined);
    if (!chosen || !file) return;
    setBusy(true);
    try {
      const started = await upload(client, chosen, file);
      await changed(started);
      await navigate({ to: '/imports/$importId', params: { importId: started.id } });
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  // A refused file says why under the field; anything else, under the form.
  const fileError = missing ? t('imports.choose_file') : fieldErrors(error).fileName;
  const formError = error !== undefined && !fileError ? errorMessage(error, t) : undefined;

  const columns: Column<ImportSummary>[] = [
    {
      key: 'file',
      header: t('imports.col_file'),
      render: (job) => (
        <Link
          to="/imports/$importId"
          params={{ importId: job.id }}
          className="font-semibold text-[var(--accent)]"
        >
          {job.fileName}
        </Link>
      ),
    },
    {
      key: 'target',
      header: t('imports.col_target'),
      render: (job) => choices.name(job.target),
    },
    {
      key: 'status',
      header: t('imports.col_status'),
      render: (job) => <ImportStatusBadge status={job.status} />,
    },
    {
      key: 'rows',
      header: t('imports.col_rows'),
      align: 'end',
      render: (job) => (job.totalRows === null ? '—' : String(job.totalRows)),
    },
    {
      key: 'result',
      header: t('imports.col_result'),
      render: (job) =>
        job.status === 'committed'
          ? t('imports.result', { created: job.created ?? 0, updated: job.updated ?? 0 })
          : '—',
    },
    {
      key: 'started',
      header: t('imports.col_started'),
      render: (job) => dates.dateTime(job.createdAt),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('imports.title')} intro={t('imports.intro')} />

      {targets.length > 0 ? (
        <Section title={t('imports.new')}>
          <form className="grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-start" onSubmit={start}>
            <SelectField
              label={t('imports.target')}
              value={chosen}
              options={choices.allowed}
              onChange={(event) => setTarget(event.target.value as ImportTarget)}
            />
            <FilePicker
              file={file}
              {...(fileError ? { error: fileError } : {})}
              onChange={setFile}
            />
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              icon={<Icon icon={Upload} />}
              className="md:mt-6"
            >
              {t('imports.upload')}
            </Button>
          </form>
          {formError ? (
            <p className="ks-help error" role="alert">
              {formError}
            </p>
          ) : null}
        </Section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t('imports.history')}>
        <h2 className="heading-md">{t('imports.history')}</h2>
        {imports.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(imports.error, t)}
          </p>
        ) : imports.isPending ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <DataTable
            caption={t('imports.caption')}
            columns={columns}
            rows={rows}
            rowKey={(job) => job.id}
            empty={
              <EmptyState icon={<Icon icon={FileSpreadsheet} />} title={t('imports.empty_title')}>
                {t('imports.empty_body')}
              </EmptyState>
            }
            {...(imports.hasNextPage
              ? {
                  more: {
                    busy: imports.isFetchingNextPage,
                    onClick: () => void imports.fetchNextPage(),
                  },
                }
              : {})}
          />
        )}
      </section>
    </div>
  );
}

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A file chooser in the portal's words: the browser's own control speaks the browser's language,
 * so the input hides inside a button-styled label, with the chosen file's name beside it.
 */
function FilePicker({
  file,
  error,
  onChange,
}: {
  file: File | null;
  error?: string;
  onChange: (file: File | null) => void;
}) {
  const { t } = useLanguage();
  const noteId = `${useId()}-note`;
  return (
    <div className="ks-field">
      <span className="ks-label">{t('imports.file')}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="ks-btn secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)] has-[:focus-visible]:outline-solid">
          <Icon icon={FileUp} size="sm" />
          {t('imports.choose')}
          <input
            type="file"
            className="sr-only"
            accept={ACCEPT}
            aria-describedby={noteId}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          />
        </label>
        <span className={cn(!file && 'ks-muted')}>{file?.name ?? t('imports.no_file')}</span>
      </div>
      <p id={noteId} className={cn('ks-help', error && 'error')} role={error ? 'alert' : undefined}>
        {error ?? t('imports.file_help')}
      </p>
    </div>
  );
}
