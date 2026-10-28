import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayIn } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const MONTH = todayIn('Asia/Kolkata').slice(0, 7);

const entry = (n: number, change: object = {}) => ({
  id: `01a10000-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`,
  actor: {
    kind: 'user',
    id: '01a10000-0000-7000-8000-000000000002',
    name: 'Anita Rao (SUN-002)',
  },
  action: 'settings.updated',
  target: { type: 'settings', id: null },
  before: { planNotificationTime: '08:00' },
  after: { planNotificationTime: '07:30' },
  ip: '10.0.0.4',
  deviceId: null,
  supportGrantId: null,
  createdAt: '2026-10-26T05:00:00.000000Z',
  ...change,
});

function auditClient() {
  return fakeClient(
    {
      [`/v1/audit?period=${MONTH}&limit=50`]: {
        items: [
          entry(1),
          entry(2, {
            actor: { kind: 'system', id: null, name: null },
            action: 'retention.applied',
            target: { type: 'notification', id: null },
            before: null,
            after: { deleted: 3 },
            ip: null,
          }),
        ],
        nextCursor: 'c1',
      },
      [`/v1/audit?period=${MONTH}&limit=50&cursor=c1`]: {
        items: [entry(3, { action: 'organisation.renamed' })],
        nextCursor: null,
      },
      [`/v1/audit?period=${MONTH}&limit=50&actorKind=api_client`]: {
        items: [
          entry(4, {
            actor: {
              kind: 'api_client',
              id: '01a10000-0000-7000-8000-0000000000e1',
              name: 'Tally ERP',
            },
            action: 'user.created',
          }),
        ],
        nextCursor: null,
      },
    },
    {
      'POST /v1/exports': ({ body }: RequestOptions) => ({
        ...(body as object),
        status: 'queued',
        rows: null,
        fileName: null,
        createdAt: '2026-10-26T05:00:00.000Z',
        finishedAt: null,
        expiresAt: null,
        download: null,
      }),
    },
    ['audit.view'],
  );
}

describe('the audit log in Settings (M21, D95)', () => {
  it('shows who did what, with the changes, a page at a time', async () => {
    renderAt('/settings/audit-log', auditClient());
    const table = await screen.findByRole('table', { name: 'Entries' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Anita Rao (SUN-002)');
    expect(rows[1]).toHaveTextContent('settings.updated');
    expect(rows[1]).toHaveTextContent('10.0.0.4');
    expect(rows[2]).toHaveTextContent('The system');
    const user = userEvent.setup();
    await user.click(within(rows[1]!).getByText('Before and after'));
    expect(within(rows[1]!).getByText(/"planNotificationTime": "07:30"/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    // The audit log alone of its group: the group is marked.
    expect(screen.getByRole('link', { name: 'Data' })).toHaveAttribute('aria-current', 'page');
  });

  it('narrows to who acted, and exports with the same filters', async () => {
    const client = auditClient();
    renderAt('/settings/audit-log', client);
    await screen.findByRole('table', { name: 'Entries' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Who acted'), 'api_client');
    expect(await screen.findByText('Tally ERP')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Export as CSV' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your file.');
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe('/v1/exports');
    expect((options as RequestOptions).body).toEqual({
      id: expect.any(String),
      report: 'audit_log',
      format: 'csv',
      locale: 'en',
      filters: { period: MONTH, auditActorKind: 'api_client' },
    });
  });
});
