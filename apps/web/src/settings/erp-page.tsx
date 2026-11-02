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
  ErpFileLink,
  ErpSettings,
  ErpStartResult,
  newId,
  ZOHO_REGION_KEYS,
  type ZohoRegion,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  Icon,
  SelectField,
  StatusBadge,
  type BadgeVariant,
  TextField,
} from '@thelamp/ui-web';
import { Download, FileUp } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { browser } from '../browser';
import { usePriceLists } from '../catalogue/data';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, useTerritories, write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section } from '../people/shared';

const KEY = ['erp'] as const;
const runsKey = (id: string) => ['erp', id, 'runs'] as const;

/** Each provider by the name its brand writes, the same in every language. */
const PROVIDER_NAMES: Record<ErpConnectionResult['provider'], string> = {
  zoho_books: 'Zoho Books',
  sap_b1: 'SAP Business One',
  tally: 'Tally',
};

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
        providers.data.providers.map((entry) =>
          entry.provider === 'tally' ? (
            <TallyCard key={entry.provider} connection={entry.connection} />
          ) : entry.provider === 'sap_b1' ? (
            <SapCard key={entry.provider} connection={entry.connection} />
          ) : (
            <ZohoCard
              key={entry.provider}
              configured={entry.configured}
              connection={entry.connection}
            />
          ),
        )
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

/**
 * SAP Business One (BR-60): the Service Layer's address, the company database and a user made for
 * the connection, checked by signing in; the password is never shown again. Once connected, the
 * mappings, runs and Disconnect, as for Zoho.
 */
function SapCard({ connection }: { connection: ErpConnectionResult | null }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [changing, setChanging] = useState(false);
  const at = (time: string) => formatDateTime(time, { locale, timeZone: access.timezone });
  const live = connection && connection.status !== 'disconnected' ? connection : null;
  return (
    <Section title={t('erp.sap')}>
      <div className="flex flex-col gap-4">
        <p className="ks-muted">{t('erp.sap_intro')}</p>
        {!live ? (
          <SapConnectForm current={connection} onDone={() => setChanging(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge variant={STATUS_BADGE[live.status]}>
                {t(`erp.status_${live.status}`)}
              </StatusBadge>
            </div>
            <Facts
              items={[
                [t('erp.sap_endpoint'), live.endpoint ?? '—'],
                [t('erp.sap_company'), live.companyDb ?? '—'],
                [t('erp.sap_username'), live.username ?? '—'],
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
                  {t('erp.sap_reconnect_notice')}
                </p>
                <SapConnectForm current={live} onDone={() => setChanging(false)} />
              </>
            ) : changing ? (
              <SapConnectForm current={live} onDone={() => setChanging(false)} />
            ) : (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
                  {t('erp.sap_change')}
                </Button>
              </div>
            )}
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

/**
 * Tally (BR-61): nothing reaches it, so connecting is a click. Files exported from TallyPrime come
 * up here, and accepted orders go down as a file to import; the mappings, runs and Disconnect are
 * as for the others.
 */
function TallyCard({ connection }: { connection: ErpConnectionResult | null }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const at = (time: string) => formatDateTime(time, { locale, timeZone: access.timezone });
  const live = connection && connection.status !== 'disconnected' ? connection : null;

  async function connect() {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', '/v1/erp-connections/tally', ConnectionSchema, {});
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('erp.tally')}>
      <div className="flex flex-col gap-4">
        <p className="ks-muted">{t('erp.tally_intro')}</p>
        {failure ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        {!live ? (
          <div>
            <Button variant="primary" busy={busy} onClick={() => void connect()}>
              {t('erp.tally_connect')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge variant={STATUS_BADGE[live.status]}>
                {t(`erp.status_${live.status}`)}
              </StatusBadge>
            </div>
            <Facts
              items={[
                [t('erp.tally_company'), live.organization?.name ?? t('erp.tally_company_none')],
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
            <TallyHowTo />
            <TallyUpload connectionId={live.id} />
            <MappingsForm connection={live} />
            <TallyOrders connection={live} />
            <Runs connectionId={live.id} tally />
            <Disconnect connection={live} />
          </>
        )}
      </div>
    </Section>
  );
}

function TallyHowTo() {
  const { t } = useLanguage();
  return (
    <details className="flex flex-col gap-2">
      <summary className="ks-label cursor-pointer">{t('erp.tally_how')}</summary>
      <ol className="ks-help list-decimal pl-5">
        <li>{t('erp.tally_how_masters')}</li>
        <li>{t('erp.tally_how_day_book')}</li>
        <li>{t('erp.tally_how_orders')}</li>
      </ol>
    </details>
  );
}

/** The refusals the API names an uploaded file by, in the reader's words. */
const TALLY_FILE_ISSUES = new Set(['tally_not_tally', 'tally_declarations', 'tally_other_company']);

/** Sends a file exported from Tally as the request body; the worker reads it as a run. */
function TallyUpload({ connectionId }: { connectionId: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [sent, setSent] = useState(false);

  async function send(file: File) {
    setBusy(true);
    setFailure(undefined);
    setSent(false);
    try {
      await client.request(
        'POST',
        `/v1/erp-connections/${connectionId}/uploads?${new URLSearchParams({ name: file.name })}`,
        RunSchema,
        { file: { data: file, type: 'application/xml' }, idempotencyKey: newId() },
      );
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: runsKey(connectionId) });
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const issue = failure ? fieldErrors(failure).file : undefined;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="ks-title">{t('erp.tally_upload')}</h3>
      <p className="ks-help">{t('erp.tally_upload_help')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="ks-btn secondary cursor-pointer">
          <Icon icon={FileUp} />
          {t('erp.tally_upload')}
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept="application/xml,text/xml,.xml"
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void send(chosen);
          }}
        />
        {busy ? (
          <span className="ks-muted" aria-live="polite">
            {t('erp.tally_uploading')}
          </span>
        ) : null}
      </div>
      {sent ? <p role="status">{t('erp.tally_uploaded')}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {issue && TALLY_FILE_ISSUES.has(issue)
            ? t(`erp.tally_issue_${issue.replace('tally_', '') as 'not_tally'}`)
            : errorMessage(failure, t)}
        </p>
      ) : null}
    </div>
  );
}

/** How many accepted orders wait for Tally, and a button to make their file. */
function TallyOrders({ connection }: { connection: ErpConnectionResult }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [asked, setAsked] = useState(false);
  const waiting = connection.ordersWaiting ?? 0;

  async function make() {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(
        client,
        'POST',
        `/v1/erp-connections/${connection.id}/orders-file`,
        RunSchema,
        {},
      );
      setAsked(true);
      await queryClient.invalidateQueries({ queryKey: runsKey(connection.id) });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('erp.tally_orders')}>
      <h3 className="ks-title">{t('erp.tally_orders')}</h3>
      <p>{t('erp.tally_orders_waiting', { n: waiting })}</p>
      <div>
        <Button
          size="sm"
          variant="secondary"
          busy={busy}
          disabled={waiting === 0}
          onClick={() => void make()}
        >
          {t('erp.tally_make_file')}
        </Button>
      </div>
      {asked ? <p role="status">{t('erp.tally_file_asked')}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </section>
  );
}

/** The issues the API names an address by, in the reader's words. */
const ENDPOINT_ISSUES = new Set([
  'not_an_address',
  'not_https',
  'not_443',
  'not_a_host',
  'not_service_layer',
]);

function SapConnectForm({
  current,
  onDone,
}: {
  current: ErpConnectionResult | null;
  onDone: () => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [draft, setDraft] = useState({
    endpoint: current?.endpoint ?? '',
    companyDb: current?.companyDb ?? '',
    username: current?.username ?? '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch }));
  const again = Boolean(current && current.status !== 'disconnected');

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(undefined);
    try {
      await write(client, 'POST', '/v1/erp-connections/sap-b1', ConnectionSchema, {
        endpoint: draft.endpoint.trim(),
        companyDb: draft.companyDb.trim(),
        username: draft.username.trim(),
        password: draft.password,
      });
      change({ password: '' });
      await queryClient.invalidateQueries({ queryKey: KEY });
      onDone();
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(
        Object.fromEntries(
          Object.entries(found).map(([path, issue]) => [
            path,
            path === 'endpoint' && ENDPOINT_ISSUES.has(issue)
              ? t(`erp.endpoint_${issue as 'not_https'}`)
              : issue,
          ]),
        ),
      );
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const label = t(again ? 'erp.sap_save_details' : 'erp.sap_connect');
  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      aria-label={label}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <TextField
        label={t('erp.sap_endpoint')}
        help={t('erp.sap_endpoint_help')}
        type="url"
        autoComplete="off"
        value={draft.endpoint}
        error={errors.endpoint}
        onChange={(event) => change({ endpoint: event.target.value })}
        required
      />
      <TextField
        label={t('erp.sap_company')}
        autoComplete="off"
        value={draft.companyDb}
        error={errors.companyDb}
        onChange={(event) => change({ companyDb: event.target.value })}
        required
      />
      <TextField
        label={t('erp.sap_username')}
        help={t('erp.sap_username_help')}
        autoComplete="off"
        value={draft.username}
        error={errors.username}
        onChange={(event) => change({ username: event.target.value })}
        required
      />
      <TextField
        label={t('erp.sap_password')}
        help={t('erp.sap_password_help')}
        type="password"
        autoComplete="new-password"
        value={draft.password}
        error={errors.password}
        onChange={(event) => change({ password: event.target.value })}
        required
      />
      {failure && Object.keys(fieldErrors(failure)).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={
            !draft.endpoint.trim() ||
            !draft.companyDb.trim() ||
            !draft.username.trim() ||
            !draft.password
          }
        >
          {label}
        </Button>
      </div>
    </form>
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
  taxRateField: string;
  defaultTaxRate: string;
  units: { name: string; unit: string }[];
  invoiceDays: string;
  dailyCalls: string;
  read: ErpSettings['read'];
  pushOrders: boolean;
  debtorGroups: string;
  groupTerritories: { group: string; territory: string }[];
  salesTypes: string;
  receiptTypes: string;
  orderType: string;
};

const draftOf = (settings: ErpSettings): Draft => ({
  accountType: settings.accountType ?? '',
  territoryField: settings.territoryField ?? '',
  defaultTerritory: settings.defaultTerritory ?? '',
  itemPriceList: settings.itemPriceList ?? '',
  priceBooks: settings.priceBooks,
  taxRateField: settings.taxRateField ?? '',
  defaultTaxRate: settings.defaultTaxRate ?? '',
  units: Object.entries(settings.units).map(([name, unit]) => ({ name, unit })),
  invoiceDays: String(settings.invoiceDays),
  dailyCalls: String(settings.dailyCalls),
  read: settings.read,
  pushOrders: settings.pushOrders,
  debtorGroups: settings.debtorGroups.join(', '),
  groupTerritories: Object.entries(settings.groupTerritories).map(([group, territory]) => ({
    group,
    territory,
  })),
  salesTypes: settings.salesTypes.join(', '),
  receiptTypes: settings.receiptTypes.join(', '),
  orderType: settings.orderType,
});

/** A comma-separated list as names, blanks left out. */
const names = (text: string) =>
  text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

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
  const sap = connection.provider === 'sap_b1';
  const tally = connection.provider === 'tally';
  const provider = PROVIDER_NAMES[connection.provider];

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
        taxRateField: draft.taxRateField.trim() || null,
        defaultTaxRate: draft.defaultTaxRate.trim() || null,
        units: Object.fromEntries(
          draft.units
            .map((entry) => [entry.name.trim(), entry.unit] as const)
            .filter(([name, unit]) => name && unit),
        ),
        invoiceDays: whole(draft.invoiceDays),
        dailyCalls: whole(draft.dailyCalls),
        read: draft.read,
        pushOrders: draft.pushOrders,
        debtorGroups: names(draft.debtorGroups),
        groupTerritories: Object.fromEntries(
          draft.groupTerritories
            .map((entry) => [entry.group.trim(), entry.territory] as const)
            .filter(([group, territory]) => group && territory),
        ),
        salesTypes: names(draft.salesTypes),
        receiptTypes: names(draft.receiptTypes),
        orderType: draft.orderType.trim(),
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
      {tally ? (
        <>
          <TextField
            label={t('erp.debtor_groups')}
            help={t('erp.debtor_groups_help')}
            value={draft.debtorGroups}
            error={errors.debtorGroups}
            onChange={(event) => change({ debtorGroups: event.target.value })}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="ks-label">{t('erp.group_territories')}</legend>
            <p className="ks-help">{t('erp.group_territories_help')}</p>
            {draft.groupTerritories.map((entry, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <TextField
                  label={t('erp.group_name')}
                  value={entry.group}
                  onChange={(event) =>
                    change({
                      groupTerritories: draft.groupTerritories.map((row, at) =>
                        at === index ? { ...row, group: event.target.value } : row,
                      ),
                    })
                  }
                />
                <SelectField
                  label={t('erp.group_territory')}
                  value={entry.territory}
                  error={errors[`groupTerritories.${entry.group.trim()}`]}
                  onChange={(event) =>
                    change({
                      groupTerritories: draft.groupTerritories.map((row, at) =>
                        at === index ? { ...row, territory: event.target.value } : row,
                      ),
                    })
                  }
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    change({
                      groupTerritories: draft.groupTerritories.filter((_, at) => at !== index),
                    })
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
                  change({
                    groupTerritories: [...draft.groupTerritories, { group: '', territory: '' }],
                  })
                }
              >
                {t('erp.add_group_territory')}
              </Button>
            </div>
          </fieldset>
        </>
      ) : (
        <TextField
          label={t('erp.territory_field')}
          help={t(sap ? 'erp.sap_territory_field_help' : 'erp.territory_field_help')}
          value={draft.territoryField}
          error={errors.territoryField}
          onChange={(event) => change({ territoryField: event.target.value })}
        />
      )}
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
      {sap || tally ? null : (
        <SelectField
          label={t('erp.item_price_list')}
          help={t('erp.item_price_list_help')}
          value={draft.itemPriceList}
          error={errors.itemPriceList}
          onChange={(event) => change({ itemPriceList: event.target.value })}
          options={[{ value: '', label: t('erp.default_list') }, ...listOptions]}
        />
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="ks-label">
          {t(tally ? 'erp.tally_price_levels' : sap ? 'erp.sap_price_lists' : 'erp.price_books')}
        </legend>
        <p className="ks-help">
          {t(
            tally
              ? 'erp.tally_price_levels_help'
              : sap
                ? 'erp.sap_price_lists_help'
                : 'erp.price_books_help',
          )}
        </p>
        {draft.priceBooks.map((book, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <TextField
              label={t(
                tally
                  ? 'erp.tally_price_level'
                  : sap
                    ? 'erp.sap_price_list_no'
                    : 'erp.price_book_id',
              )}
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
            {t(
              tally
                ? 'erp.add_tally_price_level'
                : sap
                  ? 'erp.add_sap_price_list'
                  : 'erp.add_price_book',
            )}
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
      {sap || tally ? (
        <div className="flex flex-wrap gap-4">
          {sap ? (
            <TextField
              label={t('erp.tax_rate_field')}
              help={t('erp.tax_rate_field_help')}
              value={draft.taxRateField}
              error={errors.taxRateField}
              onChange={(event) => change({ taxRateField: event.target.value })}
            />
          ) : null}
          <TextField
            label={t(sap ? 'erp.default_tax_rate' : 'erp.tally_default_tax_rate')}
            help={t('erp.default_tax_rate_help')}
            inputMode="decimal"
            value={draft.defaultTaxRate}
            error={errors.defaultTaxRate}
            onChange={(event) => change({ defaultTaxRate: event.target.value })}
          />
        </div>
      ) : null}
      {tally ? (
        <div className="flex flex-col gap-4">
          <TextField
            label={t('erp.sales_types')}
            help={t('erp.sales_types_help')}
            value={draft.salesTypes}
            error={errors.salesTypes}
            onChange={(event) => change({ salesTypes: event.target.value })}
          />
          <TextField
            label={t('erp.receipt_types')}
            help={t('erp.receipt_types_help')}
            value={draft.receiptTypes}
            error={errors.receiptTypes}
            onChange={(event) => change({ receiptTypes: event.target.value })}
          />
          <TextField
            label={t('erp.order_type')}
            help={t('erp.order_type_help')}
            value={draft.orderType}
            error={errors.orderType}
            onChange={(event) => change({ orderType: event.target.value })}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <TextField
            label={t('erp.invoice_days')}
            help={t('erp.invoice_days_help')}
            inputMode="numeric"
            value={draft.invoiceDays}
            error={errors.invoiceDays}
            onChange={(event) => change({ invoiceDays: event.target.value })}
          />
          {sap ? null : (
            <TextField
              label={t('erp.daily_calls')}
              help={t('erp.daily_calls_help')}
              inputMode="numeric"
              value={draft.dailyCalls}
              error={errors.dailyCalls}
              onChange={(event) => change({ dailyCalls: event.target.value })}
            />
          )}
        </div>
      )}
      {tally ? null : (
        <Checkbox
          label={t('erp.push_orders', { provider })}
          detail={t('erp.push_orders_help', { provider })}
          checked={draft.pushOrders}
          onChange={(event) => change({ pushOrders: event.target.checked })}
        />
      )}
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

/**
 * Each run with what it read and wrote, and the latest run's problems in words. Tally's runs are
 * its files: no Sync now, and an orders file can be saved, or made again, for 7 days.
 */
function Runs({ connectionId, tally = false }: { connectionId: string; tally?: boolean }) {
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

  async function save(run: ErpRunResult) {
    setFailure(undefined);
    try {
      const link = await read(
        client,
        `/v1/erp-connections/${connectionId}/runs/${run.id}/file`,
        ErpFileLink,
      );
      browser.go(link.url);
    } catch (error) {
      setFailure(error);
    }
  }

  async function makeAgain(run: ErpRunResult) {
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/erp-connections/${connectionId}/orders-file`, RunSchema, {
        again: run.id,
      });
      setAsked(true);
      await queryClient.invalidateQueries({ queryKey: runsKey(connectionId) });
    } catch (error) {
      setFailure(error);
    }
  }

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
    tally
      ? {
          key: 'file',
          header: t('erp.col_file'),
          render: (run) => {
            const when = formatDateTime(run.startedAt, { locale, timeZone: access.timezone });
            return (
              <div className="flex flex-wrap items-center gap-2">
                <span>{run.file ?? '—'}</span>
                {run.download ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Icon icon={Download} />}
                      aria-label={t('erp.tally_save_file_of', { at: when })}
                      onClick={() => void save(run)}
                    >
                      {t('erp.tally_save_file')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('erp.tally_make_again_of', { at: when })}
                      onClick={() => void makeAgain(run)}
                    >
                      {t('erp.tally_make_again')}
                    </Button>
                  </>
                ) : null}
              </div>
            );
          },
        }
      : {
          key: 'calls',
          header: t('erp.col_calls'),
          align: 'end',
          render: (run) => count(run.calls),
        },
  ];
  const latest = runs.data?.items[0];
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t('erp.runs')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="ks-title">{t('erp.runs')}</h3>
        {tally ? null : (
          <Button size="sm" variant="secondary" busy={busy} onClick={() => void syncNow()}>
            {t('erp.sync_now')}
          </Button>
        )}
      </div>
      {asked ? <p role="status">{t(tally ? 'erp.tally_file_asked' : 'erp.sync_asked')}</p> : null}
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
          question={t('erp.disconnect_question', {
            provider: PROVIDER_NAMES[connection.provider],
          })}
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
