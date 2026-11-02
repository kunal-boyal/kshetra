import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber } from '@thelamp/i18n';
import {
  type ErpConnectionResult,
  ErpConnectionResult as ConnectionSchema,
  type ErpProblem,
  ErpProvidersResult,
  ErpRunList,
  type ErpRunResult,
  ErpRunResult as RunSchema,
  ErpSettings,
  ErpStartResult,
  ZOHO_REGION_KEYS,
  type ZohoRegion,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  SelectField,
  StatusBadge,
  type BadgeVariant,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { browser } from '../browser';
import { usePriceLists } from '../catalogue/data';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, useTerritories, write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section } from '../people/shared';

const KEY = ['erp'] as const;
const runsKey = (id: string) => ['erp', id, 'runs'] as const;

const STATUS_BADGE: Record<ErpConnectionResult['status'], BadgeVariant> = {
  connected: 'success',
  choosing: 'pending',
  needs_reconnect: 'danger',
  disconnected: 'neutral',
};
const RUN_BADGE: Record<ErpRunResult['status'], BadgeVariant> = {
  running: 'info',
  ok: 'success',
  partial: 'pending',
  failed: 'danger',
};

/**
 * Settings › ERP (module M20, decision D129): the organisation's books, Zoho Books first. An admin
 * connects through the provider's own sign-in, chooses the organisation, maps what comes in, and
 * sees each run with what it couldn't take; accepted orders go out once switched on.
 */
export function ErpPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const providers = useQuery({
    queryKey: KEY,
    queryFn: () => read(client, '/v1/erp-connections', ErpProvidersResult),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('erp.title')} intro={t('erp.intro')} />
      {providers.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(providers.error, t)}
        </p>
      ) : !providers.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        providers.data.providers.map((entry) => (
          <ZohoCard
            key={entry.provider}
            configured={entry.configured}
            connection={entry.connection}
          />
        ))
      )}
    </div>
  );
}

function ZohoCard({
  configured,
  connection,
}: {
  configured: boolean;
  connection: ErpConnectionResult | null;
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const at = (time: string) => formatDateTime(time, { locale, timeZone: access.timezone });
  const live = connection && connection.status !== 'disconnected' ? connection : null;
  return (
    <Section title={t('erp.zoho')}>
      <div className="flex flex-col gap-4">
        <p className="ks-muted">{t('erp.zoho_intro')}</p>
        {!configured ? (
          <p className="ks-notice">{t('erp.not_configured')}</p>
        ) : !live ? (
          <ConnectForm again={false} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge variant={STATUS_BADGE[live.status]}>
                {t(`erp.status_${live.status}`)}
              </StatusBadge>
            </div>
            <Facts
              items={[
                [t('erp.organisation'), live.organization?.name ?? t('erp.organisation_none')],
                [t('erp.region'), live.region ? t(`erp.region_${live.region}`) : '—'],
                [
                  t('erp.connected'),
                  live.connectedAt
                    ? live.connectedBy
                      ? t('erp.connected_by', {
                          at: at(live.connectedAt),
                          name: live.connectedBy.name,
                        })
                      : at(live.connectedAt)
                    : '—',
                ],
                [t('erp.last_run'), live.lastRunAt ? at(live.lastRunAt) : t('erp.never')],
              ]}
            />
            {live.status === 'needs_reconnect' ? (
              <>
                <p className="ks-notice" role="alert">
                  {t('erp.reconnect_notice')}
                </p>
                <ConnectForm again region={live.region} />
              </>
            ) : null}
            {live.status === 'choosing' ? <OrganisationForm connection={live} /> : null}
            {live.status === 'connected' ? (
              <>
                <MappingsForm connection={live} />
                <Runs connectionId={live.id} />
              </>
            ) : null}
            <Disconnect connection={live} />
          </>
        )}
      </div>
    </Section>
  );
}

/** Sends the browser to Zoho to agree, in the chosen region; Zoho brings it back here. */
function ConnectForm({ again, region }: { again: boolean; region?: ZohoRegion | null }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const [chosen, setChosen] = useState<ZohoRegion>(region ?? 'in');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      const started = await write(
        client,
        'POST',
        '/v1/erp-connections/zoho/start',
        ErpStartResult,
        { region: chosen },
      );
      if (started) browser.go(started.authorizeUrl);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      aria-label={t(again ? 'erp.connect_again' : 'erp.connect')}
      onSubmit={(event) => void start(event)}
      noValidate
    >
      <SelectField
        label={t('erp.region')}
        help={t('erp.region_help')}
        value={chosen}
        onChange={(event) => setChosen(event.target.value as ZohoRegion)}
        options={ZOHO_REGION_KEYS.map((key) => ({ value: key, label: t(`erp.region_${key}`) }))}
      />
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          {t(again ? 'erp.connect_again' : 'erp.connect')}
        </Button>
      </div>
    </form>
  );
}

function OrganisationForm({ connection }: { connection: ErpConnectionResult }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [chosen, setChosen] = useState(connection.organizations[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await write(
        client,
        'PUT',
        `/v1/erp-connections/${connection.id}/organization`,
        ConnectionSchema,
        { organizationId: chosen },
      );
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      aria-label={t('erp.choose_organisation')}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <SelectField
        label={t('erp.choose_organisation')}
        value={chosen}
        onChange={(event) => setChosen(event.target.value)}
        options={connection.organizations.map((org) => ({ value: org.id, label: org.name }))}
      />
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!chosen}>
          {t('erp.use_organisation')}
        </Button>
      </div>
    </form>
  );
}

type Draft = {
  accountType: string;
  territoryField: string;
  defaultTerritory: string;
  itemPriceList: string;
  priceBooks: { pricebookId: string; priceList: string }[];
  units: { name: string; unit: string }[];
  invoiceDays: string;
  dailyCalls: string;
  read: ErpSettings['read'];
  pushOrders: boolean;
};

const draftOf = (settings: ErpSettings): Draft => ({
  accountType: settings.accountType ?? '',
  territoryField: settings.territoryField ?? '',
  defaultTerritory: settings.defaultTerritory ?? '',
  itemPriceList: settings.itemPriceList ?? '',
  priceBooks: settings.priceBooks,
  units: Object.entries(settings.units).map(([name, unit]) => ({ name, unit })),
  invoiceDays: String(settings.invoiceDays),
  dailyCalls: String(settings.dailyCalls),
  read: settings.read,
  pushOrders: settings.pushOrders,
});

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** What the connection reads into which records, checked by the server against the tenant's own. */
function MappingsForm({ connection }: { connection: ErpConnectionResult }) {
  const { client, queryClient: appQueryClient } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const config = useConfig(client, appQueryClient);
  const territories = useTerritories();
  const priceLists = usePriceLists();
  const [draft, setDraft] = useState(() => draftOf(connection.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const change = (patch: Partial<Draft>) => {
    setDone(false);
    setDraft((now) => ({ ...now, ...patch }));
  };
  const accountTypes = config.data?.bundle.accountTypes ?? [];
  const units = config.data?.bundle.catalogue.units ?? [];
  const lists = priceLists.data ?? [];
  const listOptions = lists.map((list) => ({ value: list.id, label: list.name }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(undefined);
    try {
      const body = {
        accountType: draft.accountType || null,
        territoryField: draft.territoryField.trim() || null,
        defaultTerritory: draft.defaultTerritory || null,
        itemPriceList: draft.itemPriceList || null,
        priceBooks: draft.priceBooks
          .map((book) => ({ pricebookId: book.pricebookId.trim(), priceList: book.priceList }))
          .filter((book) => book.pricebookId && book.priceList),
        units: Object.fromEntries(
          draft.units
            .map((entry) => [entry.name.trim(), entry.unit] as const)
            .filter(([name, unit]) => name && unit),
        ),
        invoiceDays: whole(draft.invoiceDays),
        dailyCalls: whole(draft.dailyCalls),
        read: draft.read,
        pushOrders: draft.pushOrders,
      };
      const result = await write(
        client,
        'PUT',
        `/v1/erp-connections/${connection.id}/settings`,
        ConnectionSchema,
        body,
      );
      if (result) setDraft(draftOf(result.settings));
      await queryClient.invalidateQueries({ queryKey: KEY });
      setDone(true);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const readKeys = ['customers', 'items', 'invoices', 'payments'] as const;
  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      aria-label={t('erp.mappings')}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <h3 className="ks-title">{t('erp.mappings')}</h3>
      <fieldset className="flex flex-col gap-2">
        <legend className="ks-label">{t('erp.read')}</legend>
        {readKeys.map((key) => (
          <Checkbox
            key={key}
            label={t(`erp.read_${key}`)}
            checked={draft.read[key]}
            onChange={(event) => change({ read: { ...draft.read, [key]: event.target.checked } })}
          />
        ))}
      </fieldset>
      <SelectField
        label={t('erp.account_type')}
        help={t('erp.account_type_help')}
        value={draft.accountType}
        error={errors.accountType}
        onChange={(event) => change({ accountType: event.target.value })}
        options={[
          { value: '', label: t('erp.not_chosen') },
          ...accountTypes.map((type) => ({ value: type.key, label: type.name[locale].other })),
        ]}
      />
      <TextField
        label={t('erp.territory_field')}
        help={t('erp.territory_field_help')}
        value={draft.territoryField}
        error={errors.territoryField}
        onChange={(event) => change({ territoryField: event.target.value })}
      />
      <SelectField
        label={t('erp.default_territory')}
        help={t('erp.default_territory_help')}
        value={draft.defaultTerritory}
        error={errors.defaultTerritory}
        onChange={(event) => change({ defaultTerritory: event.target.value })}
        options={[
          { value: '', label: t('erp.not_chosen') },
          ...(territories.data ?? [])
            .filter((territory) => territory.active)
            .map((territory) => ({
              value: territory.code,
              label: `${territory.name} (${territory.code})`,
            })),
        ]}
      />
      <SelectField
        label={t('erp.item_price_list')}
        help={t('erp.item_price_list_help')}
        value={draft.itemPriceList}
        error={errors.itemPriceList}
        onChange={(event) => change({ itemPriceList: event.target.value })}
        options={[{ value: '', label: t('erp.default_list') }, ...listOptions]}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="ks-label">{t('erp.price_books')}</legend>
        <p className="ks-help">{t('erp.price_books_help')}</p>
        {draft.priceBooks.map((book, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <TextField
              label={t('erp.price_book_id')}
              value={book.pricebookId}
              error={errors[`priceBooks.${index}.pricebookId`]}
              onChange={(event) =>
                change({
                  priceBooks: draft.priceBooks.map((entry, at) =>
                    at === index ? { ...entry, pricebookId: event.target.value } : entry,
                  ),
                })
              }
            />
            <SelectField
              label={t('erp.price_book_list')}
              value={book.priceList}
              error={errors[`priceBooks.${index}.priceList`]}
              onChange={(event) =>
                change({
                  priceBooks: draft.priceBooks.map((entry, at) =>
                    at === index ? { ...entry, priceList: event.target.value } : entry,
                  ),
                })
              }
              options={[{ value: '', label: t('erp.not_chosen') }, ...listOptions]}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                change({ priceBooks: draft.priceBooks.filter((_, at) => at !== index) })
              }
            >
              {t('erp.remove_row', { n: index + 1 })}
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              change({ priceBooks: [...draft.priceBooks, { pricebookId: '', priceList: '' }] })
            }
          >
            {t('erp.add_price_book')}
          </Button>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="ks-label">{t('erp.units')}</legend>
        <p className="ks-help">{t('erp.units_help')}</p>
        {draft.units.map((entry, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <TextField
              label={t('erp.unit_name')}
              value={entry.name}
              onChange={(event) =>
                change({
                  units: draft.units.map((row, at) =>
                    at === index ? { ...row, name: event.target.value } : row,
                  ),
                })
              }
            />
            <SelectField
              label={t('erp.unit_ours')}
              value={entry.unit}
              error={errors[`units.${entry.name.trim()}`]}
              onChange={(event) =>
                change({
                  units: draft.units.map((row, at) =>
                    at === index ? { ...row, unit: event.target.value } : row,
                  ),
                })
              }
              options={[
                { value: '', label: t('erp.not_chosen') },
                ...units.map((unit) => ({ value: unit.key, label: unit.name[locale].one })),
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => change({ units: draft.units.filter((_, at) => at !== index) })}
            >
              {t('erp.remove_row', { n: index + 1 })}
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => change({ units: [...draft.units, { name: '', unit: '' }] })}
          >
            {t('erp.add_unit')}
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <TextField
          label={t('erp.invoice_days')}
          help={t('erp.invoice_days_help')}
          inputMode="numeric"
          value={draft.invoiceDays}
          error={errors.invoiceDays}
          onChange={(event) => change({ invoiceDays: event.target.value })}
        />
        <TextField
          label={t('erp.daily_calls')}
          help={t('erp.daily_calls_help')}
          inputMode="numeric"
          value={draft.dailyCalls}
          error={errors.dailyCalls}
          onChange={(event) => change({ dailyCalls: event.target.value })}
        />
      </div>
      <Checkbox
        label={t('erp.push_orders')}
        detail={t('erp.push_orders_help')}
        checked={draft.pushOrders}
        onChange={(event) => change({ pushOrders: event.target.checked })}
      />
      {failure && Object.keys(fieldErrors(failure)).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" busy={busy}>
          {t('erp.save_mappings')}
        </Button>
        {done ? <span role="status">{t('erp.saved')}</span> : null}
      </div>
    </form>
  );
}

/** Each run with what it read and wrote, and the latest run's problems in words. */
function Runs({ connectionId }: { connectionId: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const runs = useQuery({
    queryKey: runsKey(connectionId),
    queryFn: () => read(client, `/v1/erp-connections/${connectionId}/runs`, ErpRunList),
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [asked, setAsked] = useState(false);

  async function syncNow() {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/erp-connections/${connectionId}/runs`, RunSchema);
      setAsked(true);
      await queryClient.invalidateQueries({ queryKey: runsKey(connectionId) });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const count = (value: number) => formatNumber(value, { locale });
  const summary = (run: ErpRunResult) =>
    (Object.entries(run.counts) as [string, NonNullable<ErpRunResult['counts']['account']>][])
      .map(([entity, counts]) =>
        t('erp.run_counts', {
          entity: t(`erp.entity_${entity as 'account'}`),
          read: count(counts.read),
          written: count(counts.created + counts.updated),
          skipped: count(counts.skipped),
        }),
      )
      .join(' · ') || '—';
  const columns: Column<ErpRunResult>[] = [
    {
      key: 'started',
      header: t('erp.col_started'),
      render: (run) => formatDateTime(run.startedAt, { locale, timeZone: access.timezone }),
    },
    { key: 'kind', header: t('erp.col_kind'), render: (run) => t(`erp.kind_${run.kind}`) },
    {
      key: 'status',
      header: t('erp.col_status'),
      render: (run) => (
        <StatusBadge variant={RUN_BADGE[run.status]}>
          {t(`erp.run_${run.status}`)}
          {run.stoppedBy ? ` · ${t(`erp.stopped_${run.stoppedBy}`)}` : ''}
        </StatusBadge>
      ),
    },
    { key: 'counts', header: t('erp.col_counts'), render: summary },
    { key: 'calls', header: t('erp.col_calls'), align: 'end', render: (run) => count(run.calls) },
  ];
  const latest = runs.data?.items[0];
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t('erp.runs')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="ks-title">{t('erp.runs')}</h3>
        <Button size="sm" variant="secondary" busy={busy} onClick={() => void syncNow()}>
          {t('erp.sync_now')}
        </Button>
      </div>
      {asked ? <p role="status">{t('erp.sync_asked')}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {runs.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(runs.error, t)}
        </p>
      ) : !runs.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('erp.runs')}
          columns={columns}
          rows={runs.data.items}
          rowKey={(run) => run.id}
          empty={<p className="ks-muted">{t('erp.runs_none')}</p>}
        />
      )}
      {latest && latest.problems.length > 0 ? <Problems problems={latest.problems} /> : null}
    </section>
  );
}

function Problems({ problems }: { problems: readonly ErpProblem[] }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-semibold">{t('erp.problems', { n: problems.length })}</h4>
      <ul className="flex flex-col gap-1" aria-label={t('erp.problems', { n: problems.length })}>
        {problems.map((problem) => (
          <li key={`${problem.entity}:${problem.externalId}`} className="ks-help">
            {t('erp.problem', {
              entity: t(`erp.entity_${problem.entity}`),
              label: problem.label,
              issue: t(`erp.issue_${problem.issue}`),
            })}
            {problem.detail ? ` ${problem.field ? `${problem.field}: ` : ''}${problem.detail}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Disconnect({ connection }: { connection: ErpConnectionResult }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function disconnect() {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(
        client,
        'POST',
        `/v1/erp-connections/${connection.id}/disconnect`,
        ConnectionSchema,
      );
      await queryClient.invalidateQueries({ queryKey: KEY });
      setAsking(false);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {asking ? (
        <Confirm
          question={t('erp.disconnect_question')}
          action={
            <Button size="sm" variant="danger" busy={busy} onClick={() => void disconnect()}>
              {t('erp.disconnect')}
            </Button>
          }
          cancel={
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            {t('erp.disconnect')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Where Zoho sends the browser back (`/settings/erp/zoho`): hands the code, the state and the
 * accounts server to the API once, then returns to Settings › ERP. A refusal at Zoho comes back
 * as `error` and is said in words.
 */
export function ZohoReturnPage({ search }: { search: Record<string, string | undefined> }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [failure, setFailure] = useState<unknown>();
  const sent = useRef(false);
  const code = search.code;
  const state = search.state;
  const accountsServer = search['accounts-server'];
  const refused = search.error;

  useEffect(() => {
    // The state is spent once; a second render must not send it again.
    if (sent.current || refused || !code || !state || !accountsServer) return;
    sent.current = true;
    write(client, 'POST', '/v1/erp-connections/zoho/complete', ConnectionSchema, {
      code,
      state,
      accountsServer,
    })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: KEY });
        await navigate({ to: '/settings/erp', replace: true });
      })
      .catch(setFailure);
  }, [client, queryClient, navigate, code, state, accountsServer, refused]);

  const missing = !refused && (!code || !state || !accountsServer);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('erp.connecting_title')}
        back={{ to: '/settings/erp', label: t('erp.title') }}
      />
      {refused ? (
        <p className="ks-help error" role="alert">
          {t('erp.refused_at_zoho')}
        </p>
      ) : missing ? (
        <p className="ks-help error" role="alert">
          {t('erp.return_incomplete')}
        </p>
      ) : failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : (
        <p className="ks-muted" role="status">
          {t('erp.connecting')}
        </p>
      )}
      {refused || missing || failure ? (
        <Link to="/settings/erp" className="ks-btn secondary self-start">
          {t('erp.back_to_erp')}
        </Link>
      ) : null}
    </div>
  );
}
