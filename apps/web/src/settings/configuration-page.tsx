import {
  type ConfigurationChange,
  ConfigurationPlan,
  CONFIGURATION_SECTIONS,
  type TenantPermission,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  Icon,
  Notice,
  StatusBadge,
} from '@thelamp/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { PageHeader, Section } from '../people/shared';

/** An import changes every part of the configuration, so it takes every permission over it. */
const IMPORT_PERMISSIONS: readonly TenantPermission[] = [
  'settings.manage',
  'terminology.manage',
  'role.manage',
  'designation.manage',
  'territory.manage',
  'form.manage',
  'metric.manage',
  'catalogue.manage',
];

/** A configuration file is checked by the API; here it only has to be a JSON object. */
const ConfigurationFile = z.record(z.string(), z.unknown());

/** Hands the browser a file to save. */
function save(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const TONE = { add: 'success', update: 'info', kept: 'waiting', same: 'neutral' } as const;

/**
 * Configuration export and import (M2, decision D66): the tenant's configuration as a JSON file in
 * the industry template format, so a consultant can prepare it in staging and copy it here. An
 * import shows what it would add and update first; it never removes anything.
 */
export function ConfigurationPage() {
  const { t } = useLanguage();
  const access = useAccess();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('config_file.title')} intro={t('config_file.intro')} />
      <ExportSection />
      {IMPORT_PERMISSIONS.every((permission) => access.can(permission)) ? <ImportSection /> : null}
    </div>
  );
}

function ExportSection() {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function exportFile() {
    setBusy(true);
    setFailure(undefined);
    try {
      const file = await read(client, '/v1/configuration/export', ConfigurationFile);
      save(`configuration-${todayIn(access.timezone)}.json`, file);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('config_file.export')}>
      <p className="ks-muted text-sm">{t('config_file.export_help')}</p>
      {failure !== undefined ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div>
        <Button busy={busy} icon={<Icon icon={Download} />} onClick={() => void exportFile()}>
          {t('config_file.download')}
        </Button>
      </div>
    </Section>
  );
}

type Step =
  | { kind: 'idle' }
  | { kind: 'checked'; name: string; file: unknown; plan: ConfigurationPlan }
  | { kind: 'confirming'; name: string; file: unknown; plan: ConfigurationPlan }
  | { kind: 'done'; plan: ConfigurationPlan };

function ImportSection() {
  const { client } = useApp();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [showSame, setShowSame] = useState(false);

  async function check(chosen: File) {
    setBusy(true);
    setFailure(undefined);
    setStep({ kind: 'idle' });
    try {
      let file: unknown;
      try {
        file = JSON.parse(await chosen.text());
      } catch {
        setFailure(t('config_file.not_json'));
        return;
      }
      const plan = await write(
        client,
        'POST',
        '/v1/configuration/import/preview',
        ConfigurationPlan,
        { template: file },
      );
      setStep({ kind: 'checked', name: chosen.name, file, plan: plan! });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  async function apply(file: unknown) {
    setBusy(true);
    setFailure(undefined);
    try {
      const plan = await write(client, 'POST', '/v1/configuration/import', ConfigurationPlan, {
        template: file,
      });
      // Everything the configuration shapes reads again.
      await queryClient.invalidateQueries();
      setStep({ kind: 'done', plan: plan! });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const plan = step.kind === 'idle' ? undefined : step.plan;
  const changes = (plan?.changes ?? []).filter((change) => showSame || change.change !== 'same');
  const counts = Object.fromEntries(
    (['add', 'update', 'kept', 'same'] as const).map((kind) => [
      kind,
      String((plan?.changes ?? []).filter((change) => change.change === kind).length),
    ]),
  );
  const columns: Column<ConfigurationChange>[] = [
    {
      key: 'section',
      header: t('config_file.section'),
      render: (change) => t(`config_file.section_${change.section}`),
    },
    { key: 'key', header: t('roles.key'), render: (change) => <code>{change.key}</code> },
    {
      key: 'change',
      header: t('config_file.change'),
      render: (change) => (
        <StatusBadge variant={TONE[change.change]}>
          {t(`config_file.change_${change.change}`)}
        </StatusBadge>
      ),
    },
  ];
  const order = (change: ConfigurationChange) => CONFIGURATION_SECTIONS.indexOf(change.section);

  return (
    <Section title={t('config_file.import')}>
      <p className="ks-muted text-sm">{t('config_file.import_help')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="ks-btn secondary cursor-pointer">
          <Icon icon={FileUp} />
          {t('config_file.choose')}
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void check(chosen);
          }}
        />
        {busy && step.kind === 'idle' ? (
          <span className="ks-muted" aria-live="polite">
            {t('config_file.checking')}
          </span>
        ) : null}
      </div>
      {failure !== undefined ? (
        <p className="ks-help error" role="alert">
          {typeof failure === 'string' ? failure : errorMessage(failure, t)}
        </p>
      ) : null}
      {step.kind === 'done' ? (
        <Notice>{t('config_file.done', { added: counts.add!, updated: counts.update! })}</Notice>
      ) : null}
      {plan && step.kind !== 'done' ? (
        <div className="flex flex-col gap-4">
          <p aria-live="polite">
            {t('config_file.summary', {
              name: step.kind === 'idle' ? '' : step.name,
              added: counts.add!,
              updated: counts.update!,
              kept: counts.kept!,
              same: counts.same!,
            })}
          </p>
          {plan.issues.length > 0 ? (
            <div className="ks-help error" role="alert">
              <p>{t('config_file.problems')}</p>
              <ul>
                {plan.issues.map((issue, index) => (
                  <li key={index}>
                    <code>{issue.path || t('config_file.whole_file')}</code>: {issue.issue}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {counts.kept !== '0' ? (
            <p className="ks-muted text-sm">{t('config_file.kept_help')}</p>
          ) : null}
          {plan.changes.length > 0 ? (
            <>
              <Checkbox
                label={t('config_file.show_same')}
                checked={showSame}
                onChange={(event) => setShowSame(event.target.checked)}
              />
              <DataTable
                caption={t('config_file.changes')}
                columns={columns}
                rows={[...changes].sort((a, b) => order(a) - order(b))}
                rowKey={(change) => `${change.section}:${change.key}`}
                empty={<p className="ks-muted">{t('config_file.nothing')}</p>}
              />
            </>
          ) : null}
          {plan.issues.length === 0 && step.kind === 'checked' ? (
            <div>
              <Button
                variant="primary"
                icon={<Icon icon={Upload} />}
                disabled={counts.add === '0' && counts.update === '0'}
                onClick={() => setStep({ ...step, kind: 'confirming' })}
              >
                {t('config_file.apply')}
              </Button>
            </div>
          ) : null}
          {step.kind === 'confirming' ? (
            <Confirm
              question={t('config_file.confirm', {
                added: counts.add!,
                updated: counts.update!,
              })}
              action={
                <Button variant="primary" busy={busy} onClick={() => void apply(step.file)}>
                  {t('config_file.apply')}
                </Button>
              }
              cancel={
                <Button variant="ghost" onClick={() => setStep({ ...step, kind: 'checked' })}>
                  {t('common.cancel')}
                </Button>
              }
            >
              <p className="ks-muted text-sm">{t('config_file.confirm_help')}</p>
            </Confirm>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
