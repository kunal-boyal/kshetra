import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import { FormEntries, migrate, type SqlDatabase } from '@kshetra/api-client/sync';
import type { FormView } from '@kshetra/forms';
import { SETTING_DEFAULTS, type SyncPullResult } from '@kshetra/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { FormEntryScreen } from './form-entry';
import { FormsScreen } from './forms';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const USER = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${USER}`;
const SHOP = '01a10000-0000-7000-8000-000000000080';
const NEEM = '01a10000-0000-7000-8000-0000000000b0';
const UREA = '01a10000-0000-7000-8000-0000000000b3';
const ENTRY = '01a10000-0000-7000-8000-0000000000e1';
const text = (en: string) => ({ en, hi: en });
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

const base = {
  version: 2,
  active: true,
  icon: 'clipboard-list',
  tags: [] as string[],
  shift: 'required' as const,
  signature: 'none' as const,
  geofence: 'inherit' as const,
  review: 'manual' as const,
};

/** A shop check: a condition, item lines with an amount, a group, photos and a signature. */
const CHECK: FormView = {
  ...base,
  id: '01a10000-0000-7000-8000-0000000000f1',
  key: 'shop_check',
  name: noun('Shop check', 'Shop checks'),
  accountLink: { mode: 'required', accountTypes: ['customer'] },
  visitSession: false,
  signature: 'required',
  fields: [
    { key: 'open', type: 'yes_no', label: text('Shop open'), required: true },
    {
      key: 'why_closed',
      type: 'short_text',
      label: text('Why closed'),
      required: true,
      maxLength: 200,
      visibleWhen: { match: 'all', clauses: [{ field: 'open', op: 'eq', value: false }] },
    },
    {
      key: 'stock',
      type: 'product_lines',
      label: text('Stock seen'),
      required: false,
      maxLines: 50,
      valueColumn: { label: text('Value') },
    },
    {
      key: 'people',
      type: 'repeating_group',
      label: text('People met'),
      required: false,
      maxItems: 5,
      fields: [
        { key: 'person', type: 'short_text', label: text('Name'), required: true, maxLength: 100 },
      ],
    },
    { key: 'mood', type: 'rating', label: text('How it went'), required: false },
  ],
};

/** Filled inside a visit, so it opens from the visit, not from Forms. */
const VISIT: FormView = {
  ...base,
  id: '01a10000-0000-7000-8000-0000000000f2',
  key: 'visit_report',
  name: noun('Visit report', 'Visit reports'),
  accountLink: { mode: 'required', accountTypes: ['customer'] },
  visitSession: true,
  fields: [
    { key: 'notes', type: 'long_text', label: text('Notes'), required: false, maxLength: 2000 },
  ],
};

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

const item = (id: string, name: string, code: string) => ({
  id,
  code,
  name,
  product: { id: `${id.slice(0, -2)}c${id.slice(-1)}`, name },
  category: null,
  packLabel: '1 KG',
  hsn: null,
  taxRate: '5.0000',
  mrp: null,
  baseUnit: 'pack',
  units: [{ key: 'pack', factor: '1.000' }],
  measureType: 'kg' as const,
  measurePerBaseUnit: '1.000000',
  custom: {},
  active: true,
});

function pulled(): SyncPullResult {
  return {
    entities: {
      users: full([]),
      territories: full([]),
      accounts: full([
        {
          id: SHOP,
          type: 'customer',
          code: 'C-80',
          name: 'Janpath Mart',
          territoryId: '01a10000-0000-7000-8000-000000000010',
          parentId: null,
          address: {},
          location: null,
          geofenceRadiusM: null,
          locationStatus: 'unverified',
          status: 'active',
          segments: [],
          custom: {},
          slots: [],
        },
      ]),
      contacts: full([]),
      items: full([item(NEEM, 'Neem Shield', 'NEEM-500'), item(UREA, 'Urea Plus', 'UREA-1')]),
    },
    cursor: 'c1',
    more: false,
  };
}

function fakeClient() {
  const session: SessionState = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const client = {
    session,
    owner: OWNER,
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => undefined),
    syncPull: jest.fn(async () => pulled()),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [CHECK, VISIT],
        catalogue: {
          units: [{ key: 'pack', name: noun('Pack', 'Packs'), base: true }],
          measureTypes: ['kg', 'L'],
        },
        access: { role: 'field_user', scope: 'self', permissions: ['submission.create'] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

type Page = { name: 'list' } | { name: 'entry'; id: string };

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page.name === 'list' ? <FormsScreen /> : <FormEntryScreen id={page.id} />;
}

async function renderPhone(page: Page, db: SqlDatabase) {
  const fake = fakeClient();
  await render(
    <LanguageProvider initial="en">
      <AppProvider
        createClient={fake.create}
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
        }
      >
        <SyncProvider openDatabase={async () => db}>
          <Look>
            <Shown page={page} />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return fake.client;
}

async function freshDatabase() {
  const db = nodeSqlite();
  await migrate(db);
  return db;
}

describe('forms on the phone', () => {
  it('offers the forms filled on their own, and starts a draft of the current version', async () => {
    const db = await freshDatabase();
    await renderPhone({ name: 'list' }, db);
    const start = await screen.findByRole('button', { name: 'Shop check' });
    expect(screen.queryByRole('button', { name: 'Visit report' })).toBeNull();
    await fireEvent.press(start);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const [entry] = await new FormEntries(db).list(OWNER);
    expect(entry).toMatchObject({ formKey: 'shop_check', formVersion: 2, state: 'draft' });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/forms/[id]',
      params: { id: entry!.id },
    });
  });

  it('fills a form as its conditions say, checks it as the server will, and queues it', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK });
    await renderPhone({ name: 'entry', id: ENTRY }, db);
    expect(await screen.findByText('Shop check')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Why closed/)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(
      await screen.findByText('3 things need a look before this can be submitted.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Choose the account this is for.')).toBeOnTheScreen();
    expect(screen.getByText('Fill this in.')).toBeOnTheScreen();
    expect(screen.getByText('Sign in the box.')).toBeOnTheScreen();

    await fireEvent.press(await screen.findByRole('radio', { name: 'Janpath Mart' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'No' }));
    // Closed: the reason shows, and is needed.
    expect(await screen.findByLabelText('Why closed *')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Why closed *'), 'Owner away');

    await fireEvent.press(screen.getByRole('button', { name: 'Add an item' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Neem Shield' }));
    await fireEvent.press(screen.getByRole('button', { name: 'One more' }));
    await fireEvent.changeText(screen.getByLabelText('Value'), '1,250.50');

    await fireEvent.press(screen.getByRole('button', { name: 'Add to People met' }));
    await fireEvent.changeText(screen.getByLabelText('Name *'), 'Meena Shah');
    await fireEvent.press(screen.getByRole('radio', { name: '4 stars' }));

    // A signature, as the pad keeps it: one stroke of path data.
    const pad = screen.getByLabelText('Signature box, empty');
    await fireEvent(pad, 'responderGrant', { nativeEvent: { locationX: 10, locationY: 20 } });
    await fireEvent(pad, 'responderMove', { nativeEvent: { locationX: 40, locationY: 25 } });
    await fireEvent(pad, 'responderRelease', { nativeEvent: { locationX: 40, locationY: 25 } });
    expect(await screen.findByLabelText('Signature, signed')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/forms'));
    expect(await entries.get(OWNER, ENTRY)).toMatchObject({
      state: 'queued',
      accountId: SHOP,
      values: {
        open: false,
        why_closed: 'Owner away',
        stock: [{ itemId: NEEM, quantity: 2, value: '1250.50' }],
        people: [{ person: 'Meena Shah' }],
        mood: 4,
      },
      signature: ['M10 20 L40 25'],
    });
  });

  it('keeps each change of a draft on the phone as it is made', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK, accountId: SHOP });
    await renderPhone({ name: 'entry', id: ENTRY }, db);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Yes' }));
    // The phone keeps a change 400 ms after the last one.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await entries.get(OWNER, ENTRY))?.values).toEqual({ open: true });
  });

  it('shows a submitted entry read only', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK, accountId: SHOP });
    await entries.submit(OWNER, ENTRY, { values: { open: true } });
    await renderPhone({ name: 'entry', id: ENTRY }, db);
    expect(await screen.findByText('Waiting to send')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard this draft' })).toBeNull();
  });

  it('lists drafts, and what waits to be sent', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK });
    const sent = '01a10000-0000-7000-8000-0000000000e2';
    await entries.start({ id: sent, owner: OWNER, form: CHECK });
    await entries.submit(OWNER, sent);
    await renderPhone({ name: 'list' }, db);
    expect(await screen.findByText('Drafts')).toBeOnTheScreen();
    expect(screen.getByText('Waiting to send')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Shop check, (Saved|Submitted)/ })).toHaveLength(
      2,
    );
  });

  it('discards a draft after asking', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK });
    await renderPhone({ name: 'entry', id: ENTRY }, db);
    await fireEvent.press(await screen.findByRole('button', { name: 'Discard this draft' }));
    expect(
      await screen.findByText('Discard this draft? What was filled in is lost.'),
    ).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button', { name: 'Discard this draft' });
    await fireEvent.press(buttons.at(-1)!);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/forms'));
    expect(await entries.get(OWNER, ENTRY)).toBeNull();
  });
});
