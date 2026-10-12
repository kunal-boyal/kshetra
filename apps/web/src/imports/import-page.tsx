import {
  type ImportPreviewRow,
  type ImportProblem,
  ImportResult,
  type ImportResult as ImportView,
} from '@kshetra/shared';
import {
  Button,
  type Column,
  Confirm,
  DataTable,
  Icon,
  Notice,
  SelectField,
  TextField,
} from '@kshetra/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck, Columns3, Info, LoaderCircle, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section } from '../people/shared';
import { isBusy, useImport, useImportChanged, useImportTargets } from './data';
import { fieldName, ImportStatusBadge } from './shared';

/** One import, from its columns to its outcome (M19). */
export function ImportPage({ importId }: { importId: string }) {
  const { t } = useLanguage();
  const job = useImport(importId);
  const targets = useImportTargets();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const status = job.data?.status;

  // What the import loaded reads again once it is in.
  useEffect(() => {
    if (status !== 'committed') return;
    for (const key of ['users', 'org-chart', 'territories', 'imports']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [status, queryClient]);

  if (job.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(job.error, t)}
      </p>
    );
  }
  if (!job.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const view = job.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={view.fileName}
        back={{ to: '/imports', label: t('nav.imports') }}
        intro={targets.name(view.target)}
      >
        <ImportStatusBadge status={view.status} />
      </PageHeader>

      {isBusy(view.status) ? (
        <div role="status">
          <Notice icon={<Icon icon={LoaderCircle} />}>{t(`import.busy_${view.status}`)}</Notice>
        </div>
      ) : null}

      {view.status === 'mapping' || (editing && ['ready', 'invalid'].includes(view.status)) ? (
        <MappingForm
          view={view}
          onDone={() => setEditing(false)}
          {...(view.status === 'mapping' ? {} : { onCancel: () => setEditing(false) })}
        />
      ) : view.status === 'ready' || view.status === 'invalid' ? (
        <Checked view={view} onChangeColumns={() => setEditing(true)} />
      ) : null}

      {view.status === 'committed' ? <Committed view={view} /> : null}

      {view.status === 'failed' ? (
        <section className="flex flex-col gap-3" aria-label={t('import.status_failed')}>
          <p className="ks-help error" role="alert">
            {t('import.failed', { reason: view.errors[0]?.issue ?? '' })}
          </p>
          <Link to="/imports" className="ks-btn secondary self-start">
            <Icon icon={Upload} size="sm" />
            {t('import.upload_again')}
          </Link>
        </section>
      ) : null}
    </div>
  );
}

/** Which field each column fills, on the chosen sheet; a mapping may be saved by name. */
function MappingForm({
  view,
  onDone,
  onCancel,
}: {
  view: ImportView;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const changed = useImportChanged();
  const [mapping, setMapping] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(view.headers.map((header) => [header, view.mapping[header] ?? null])),
  );
  const [saveAs, setSaveAs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const name = (key: string) =>
    fieldName(
      view.target,
      view.fields.find((field) => field.key === key),
      key,
      t,
      locale,
    );
  const used = Object.values(mapping).filter((key): key is string => key !== null);
  const twice = new Set(used.filter((key, index) => used.indexOf(key) !== index));
  const missing = view.fields.filter((field) => field.required && !used.includes(field.key));
  const problems = fieldErrors(error);
  const columnError = (header: string) => {
    const key = mapping[header];
    return key && twice.has(key) ? t('import.chosen_twice') : problems[`mapping.${header}`];
  };
  const shownElsewhere = Object.keys(problems).some(
    (path) => path === 'saveAs' || path.startsWith('mapping.'),
  );

  async function send(body: object) {
    setBusy(true);
    setError(undefined);
    try {
      const next = await write(client, 'PUT', `/v1/imports/${view.id}/mapping`, ImportResult, body);
      if (next) await changed(next);
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await send({ mapping, ...(saveAs.trim() ? { saveAs: saveAs.trim() } : {}) })) onDone();
  }

  return (
    <Section title={t('import.columns')}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {view.sheets.length > 1 ? (
          <SelectField
            label={t('import.sheet')}
            help={t('import.sheet_help')}
            value={view.sheet ?? ''}
            options={view.sheets.map((sheet) => ({ value: sheet, label: sheet }))}
            disabled={busy}
            onChange={(event) => void send({ sheet: event.target.value })}
          />
        ) : null}
        {view.headerRow !== null ? (
          <p className="ks-muted">{t('import.columns_intro', { row: view.headerRow })}</p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {view.headers.map((header) => (
            <SelectField
              key={header}
              label={header}
              value={mapping[header] ?? ''}
              none={t('import.leave_out')}
              options={view.fields.map((field) => ({
                value: field.key,
                label: field.required ? `${name(field.key)} *` : name(field.key),
              }))}
              {...(columnError(header) ? { error: columnError(header) } : {})}
              onChange={(event) =>
                setMapping((current) => ({ ...current, [header]: event.target.value || null }))
              }
            />
          ))}
        </div>
        {missing.length > 0 ? (
          <Notice icon={<Icon icon={Info} />}>
            {t('import.required_missing', {
              fields: missing.map((field) => name(field.key)).join(', '),
            })}
          </Notice>
        ) : null}
        <TextField
          label={t('import.save_as')}
          help={t('import.save_as_help')}
          value={saveAs}
          maxLength={60}
          {...(problems.saveAs ? { error: problems.saveAs } : {})}
          onChange={(event) => setSaveAs(event.target.value)}
        />
        {error !== undefined && !shownElsewhere ? (
          <p className="ks-help error" role="alert">
            {errorMessage(error, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={missing.length > 0 || twice.size > 0}
          >
            {t('import.check')}
          </Button>
          {onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

/** The outcome of the check: the problems by row, a preview, and the import itself. */
function Checked({ view, onChangeColumns }: { view: ImportView; onChangeColumns: () => void }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const changed = useImportChanged();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const total = view.totalRows ?? 0;
  const name = (key: string) =>
    fieldName(
      view.target,
      view.fields.find((field) => field.key === key),
      key,
      t,
      locale,
    );
  // The preview shows the fields the columns fill, in the import's own order.
  const shown = view.fields
    .map((field) => field.key)
    .filter((key) => Object.values(view.mapping).includes(key));

  async function commit() {
    setBusy(true);
    setError(undefined);
    try {
      const next = await write(client, 'POST', `/v1/imports/${view.id}/commit`, ImportResult);
      if (next) await changed(next);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  const problemColumns: Column<ImportProblem & { index: number }>[] = [
    {
      key: 'row',
      header: t('import.col_row'),
      align: 'end',
      render: (problem) => (problem.row === null ? t('import.whole_file') : String(problem.row)),
    },
    {
      key: 'field',
      header: t('import.col_column'),
      render: (problem) => (problem.field ? name(problem.field) : '—'),
    },
    { key: 'issue', header: t('import.col_problem'), render: (problem) => problem.issue },
  ];

  const previewColumns: Column<ImportPreviewRow>[] = [
    { key: 'row', header: t('import.col_row'), align: 'end', render: (row) => String(row.row) },
    ...shown.map((key): Column<ImportPreviewRow> => ({
      key,
      header: name(key),
      render: (row) => row.values[key] || '—',
    })),
    {
      key: 'problems',
      header: t('import.col_problem'),
      render: (row) =>
        row.problems.length > 0 ? (
          <span className="ks-help error">{row.problems.join(' ')}</span>
        ) : (
          <span className="ks-muted">{t('import.ok')}</span>
        ),
    },
  ];

  return (
    <>
      <Section title={t('import.summary')}>
        <Facts
          items={[
            [t('import.rows'), String(total)],
            [t('import.rows_with_problems'), String(view.errorRows ?? 0)],
          ]}
        />
        {view.status === 'invalid' ? (
          <Notice icon={<Icon icon={Info} />}>{t('import.invalid_notice')}</Notice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {view.status === 'ready' && total > 0 ? (
            <Button
              variant="primary"
              icon={<Icon icon={CircleCheck} />}
              onClick={() => setAsking(true)}
            >
              {t('import.commit', { count: total })}
            </Button>
          ) : null}
          <Button variant="secondary" icon={<Icon icon={Columns3} />} onClick={onChangeColumns}>
            {t('import.change_columns')}
          </Button>
        </div>
        {asking ? (
          <Confirm
            question={t('import.commit_confirm', { count: total })}
            action={
              <Button variant="primary" busy={busy} onClick={() => void commit()}>
                {t('import.commit', { count: total })}
              </Button>
            }
            cancel={
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </Button>
            }
          >
            <p>{t('import.commit_detail')}</p>
          </Confirm>
        ) : null}
        {error !== undefined ? (
          <p className="ks-help error" role="alert">
            {errorMessage(error, t)}
          </p>
        ) : null}
      </Section>

      {view.errors.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label={t('import.problems')}>
          <h2 className="heading-md">{t('import.problems')}</h2>
          <DataTable
            caption={t('import.problems_caption')}
            columns={problemColumns}
            rows={view.errors.map((problem, index) => ({ ...problem, index }))}
            rowKey={(problem) => String(problem.index)}
            empty={null}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t('import.preview')}>
        <h2 className="heading-md">{t('import.preview')}</h2>
        {total > view.preview.length ? (
          <p className="ks-muted">
            {t('import.preview_note', { shown: view.preview.length, total })}
          </p>
        ) : null}
        <DataTable
          caption={t('import.preview_caption')}
          columns={previewColumns}
          rows={view.preview}
          rowKey={(row) => String(row.row)}
          empty={<p className="ks-muted">{t('import.no_rows')}</p>}
        />
      </section>
    </>
  );
}

function Committed({ view }: { view: ImportView }) {
  const { t } = useLanguage();
  return (
    <Section title={t('import.status_committed')}>
      <p role="status">
        {t('import.done', { created: view.created ?? 0, updated: view.updated ?? 0 })}
      </p>
      <Link
        to={view.target === 'users' ? '/people' : '/territories'}
        className="ks-btn secondary self-start"
      >
        {t(view.target === 'users' ? 'import.open_people' : 'import.open_territories')}
      </Link>
    </Section>
  );
}
