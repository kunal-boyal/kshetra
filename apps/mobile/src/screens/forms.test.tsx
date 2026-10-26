import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import {
  FormEntries,
  migrate,
  Outbox,
  type SqlDatabase,
  submissionBody,
  Tracking,
  Visits,
} from '@thelamp/api-client/sync';
import type { FormView } from '@thelamp/forms';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
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
// The phone stands at Janpath, New Delhi, known to within 12 m.
const mockFix = { lat: 28.6261, lng: 77.2186, accuracy: 12, mocked: false };
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Highest: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  getBackgroundPermissionsAsync: async () => ({ granted: true }),
  hasStartedLocationUpdatesAsync: async () => false,
  getCurrentPositionAsync: async () => ({
    coords: { latitude: mockFix.lat, longitude: mockFix.lng, accuracy: mockFix.accuracy },
    timestamp: Date.now(),
    mocked: mockFix.mocked,
  }),
}));

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
      quantities: true,
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

/**
 * A detailing call (decision D97): products told about without quantities, a signature needed
 * only when samples were given, and a reason asked only when the visit took no order.
 */
const DETAIL: FormView = {
  ...base,
  id: '01a10000-0000-7000-8000-0000000000f3',
  key: 'detailing',
  name: noun('Detailing call', 'Detailing calls'),
  accountLink: { mode: 'required', accountTypes: ['customer'] },
  visitSession: true,
  signature: 'optional',
  signatureRequiredWhen: { match: 'all', clauses: [{ field: 'samples', op: 'is_not_empty' }] },
  fields: [
    {
      key: 'detailed',
      type: 'product_lines',
      label: text('Products detailed'),
      required: true,
      quantities: false,
      maxLines: 50,
    },
    {
      key: 'samples',
      type: 'product_lines',
      label: text('Samples given'),
      required: false,
      quantities: true,
      maxLines: 50,
    },
    {
      key: 'no_order_reason',
      type: 'single_select',
      label: text('Why no order'),
      required: true,
      options: [{ key: 'stocked', label: text('Stocked up') }],
      visibleWhen: {
        match: 'all',
        clauses: [{ field: 'visit_ordered', op: 'eq', value: false }],
      },
    },
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

/** The phone's client; offline, every upload fails as with no signal, so it stays queued. */
function fakeClient(offline: boolean) {
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
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async (method) => {
      if (offline && method === 'POST') throw new NetworkError(new Error('No signal.'));
      return {};
    }),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [CHECK, VISIT, DETAIL],
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

async function renderPhone(page: Page, db: SqlDatabase, offline = false) {
  const fake = fakeClient(offline);
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

const SHIFT = '01a10000-0000-7000-8000-0000000000c1';

/** A fresh phone database; on duty since two hours ago unless `onDuty` is false. */
async function freshDatabase(onDuty = true) {
  const db = nodeSqlite();
  await migrate(db);
  if (onDuty) {
    await db.transaction((tx) =>
      new Tracking(db).open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 2 * 3_600_000,
        endsBy: Date.now() + 12 * 3_600_000,
        intervalSeconds: 120,
      }),
    );
  }
  return db;
}

/** Submits an entry on the phone as the form screen does, its upload queued unless `sent`. */
async function submitted(db: SqlDatabase, id: string, sent = false) {
  const entries = new FormEntries(db);
  const capture = {
    capturedAt: Date.now(),
    fix: {
      location: { lat: mockFix.lat, lng: mockFix.lng },
      accuracy: 12,
      mocked: false,
      capturedAt: new Date().toISOString(),
    },
    visitId: null,
  };
  await entries.submit(OWNER, id, { values: { open: true } }, capture, async (tx, entry) => {
    if (!sent) {
      await new Outbox(db, {}).enqueue(tx, {
        id,
        owner: OWNER,
        kind: 'submission.create',
        payload: submissionBody(entry),
      });
    }
  });
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

  it('fills a form as its conditions say, checks it as the server will, and queues its upload', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK });
    const client = await renderPhone({ name: 'entry', id: ENTRY }, db);
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
    // Saved and queued on the phone, then sent with its own ID, when and where it was captured.
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith('POST', '/v1/submissions', expect.anything(), {
        body: expect.objectContaining({
          id: ENTRY,
          form: { key: 'shop_check', version: 2 },
          accountId: SHOP,
          fix: expect.objectContaining({
            location: { lat: mockFix.lat, lng: mockFix.lng },
            accuracy: 12,
            mocked: false,
          }),
          signature: { width: 50, height: 50, strokes: ['M10 20 L40 25'] },
        }),
      }),
    );
    expect(await entries.get(OWNER, ENTRY)).toMatchObject({
      state: 'queued',
      visitId: null,
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

  it('needs the day started, a visit for a visit form, and a real fix', async () => {
    const db = await freshDatabase(false);
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: VISIT, accountId: SHOP });
    await renderPhone({ name: 'entry', id: ENTRY }, db, true);
    await fireEvent.press(await screen.findByRole('button', { name: 'Submit' }));
    expect(
      await screen.findByText('Start your day before submitting this form.'),
    ).toBeOnTheScreen();
    await db.transaction((tx) =>
      new Tracking(db).open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 3_600_000,
        endsBy: Date.now() + 3_600_000,
        intervalSeconds: 120,
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(
      await screen.findByText('Check in at the account first, then fill this form there.'),
    ).toBeOnTheScreen();
    const visit = '01a10000-0000-7000-8000-0000000000d1';
    await db.transaction((tx) =>
      new Visits(db).open(tx, {
        owner: OWNER,
        visitId: visit,
        accountId: SHOP,
        shiftId: SHIFT,
        checkedInAt: Date.now(),
      }),
    );
    mockFix.mocked = true;
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(
      await screen.findByText('This location is mocked. Turn off any app that fakes it.'),
    ).toBeOnTheScreen();
    mockFix.mocked = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/accounts/[id]',
        params: { id: SHOP },
      }),
    );
    const [upload] = await new Outbox(db, {}).items(OWNER);
    expect(upload).toMatchObject({
      id: ENTRY,
      dependsOn: [visit],
      payload: { visitId: visit, accountId: SHOP },
    });
  });

  it('asks why there was no order while the visit has taken none', async () => {
    const db = await freshDatabase();
    await db.transaction((tx) =>
      new Visits(db).open(tx, {
        owner: OWNER,
        visitId: '01a10000-0000-7000-8000-0000000000d2',
        accountId: SHOP,
        shiftId: SHIFT,
        checkedInAt: Date.now() - 60_000,
      }),
    );
    await new FormEntries(db).start({ id: ENTRY, owner: OWNER, form: DETAIL, accountId: SHOP });
    await renderPhone({ name: 'entry', id: ENTRY }, db, true);
    // No order yet: the reason is asked.
    expect(await screen.findByText('Why no order *')).toBeOnTheScreen();
  });

  it('waits for the visit’s order, and needs a signature only for samples', async () => {
    const visit = '01a10000-0000-7000-8000-0000000000d3';
    const order = '01a10000-0000-7000-8000-0000000000a9';
    const db = await freshDatabase();
    await db.transaction((tx) =>
      new Visits(db).open(tx, {
        owner: OWNER,
        visitId: visit,
        accountId: SHOP,
        shiftId: SHIFT,
        checkedInAt: Date.now() - 60_000,
      }),
    );
    await new FormEntries(db).start({ id: ENTRY, owner: OWNER, form: DETAIL });
    const client = await renderPhone({ name: 'entry', id: ENTRY }, db);
    const shop = await screen.findByRole('radio', { name: 'Janpath Mart' });
    // An order taken in the visit, still waiting to upload when the account is chosen.
    await db.transaction((tx) =>
      new Outbox(db, {}).enqueue(tx, {
        id: order,
        owner: OWNER,
        kind: 'order.place',
        payload: { id: order, accountId: SHOP, visitId: visit },
      }),
    );
    await fireEvent.press(shop);
    expect(await screen.findByText('Products detailed *')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Why no order *')).toBeNull());

    // Products detailed take no quantity; samples do, and then a signature.
    const [detailed, samples] = screen.getAllByRole('button', { name: 'Add an item' });
    await fireEvent.press(detailed!);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Neem Shield' }));
    expect(screen.queryByRole('button', { name: 'One more' })).toBeNull();
    await fireEvent.press(samples!);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Urea Plus' }));
    expect(screen.getByRole('button', { name: 'One more' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Sign in the box.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Urea Plus' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/accounts/[id]',
        params: { id: SHOP },
      }),
    );
    // The order goes first, so the server sees it before the submission.
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith('POST', '/v1/submissions', expect.anything(), {
        body: expect.objectContaining({
          id: ENTRY,
          visitId: visit,
          values: { detailed: [{ itemId: NEEM, quantity: 1 }] },
        }),
      }),
    );
    const posted = client.request.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, path]) => path);
    expect(posted).toEqual(['/v1/orders', '/v1/submissions']);
  });

  it('shows a submitted entry read only, waiting and then sent', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK, accountId: SHOP });
    await submitted(db, ENTRY);
    await renderPhone({ name: 'entry', id: ENTRY }, db, true);
    expect(await screen.findByText('Waiting to send')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard this draft' })).toBeNull();
  });

  it('lists drafts, what waits to be sent, and what was sent', async () => {
    const db = await freshDatabase();
    const entries = new FormEntries(db);
    await entries.start({ id: ENTRY, owner: OWNER, form: CHECK });
    const sent = '01a10000-0000-7000-8000-0000000000e2';
    await entries.start({ id: sent, owner: OWNER, form: CHECK });
    await submitted(db, sent, true);
    const waiting = '01a10000-0000-7000-8000-0000000000e3';
    await entries.start({ id: waiting, owner: OWNER, form: CHECK });
    await submitted(db, waiting);
    await renderPhone({ name: 'list' }, db, true);
    expect(await screen.findByText('Drafts')).toBeOnTheScreen();
    expect(await screen.findByText('Waiting to send')).toBeOnTheScreen();
    expect(screen.getByText('Sent')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Shop check, (Saved|Submitted)/ })).toHaveLength(
      3,
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
