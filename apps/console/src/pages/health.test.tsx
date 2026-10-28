import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderConsole } from '../test-support';

const FIGURES = {
  requests: 412,
  errors: 13,
  points: 960,
  latePoints: 40,
  queues: {
    notifications: { waiting: 3, active: 1, delayed: 0, failed: 0, oldestWaitSeconds: 12 },
    exports: { waiting: 40, active: 1, delayed: 0, failed: 2, oldestWaitSeconds: 420 },
  },
  outbox: { backlog: 0, oldestSeconds: null },
  phones: { seen: 120, waiting: 8, parked: 1, oldestQueuedSeconds: 7_500 },
};

const HEALTH = {
  items: [
    {
      cell: { name: 'mumbai-1', region: 'ap-south-1', kind: 'shared' },
      latest: { at: '2026-10-26T10:00:00.000Z', figures: FIGURES },
      issues: [{ key: 'errors' }, { key: 'queue', queue: 'exports' }, { key: 'sync' }],
      hours: [
        {
          hour: '2026-10-26T10:00:00.000Z',
          requests: 412,
          errors: 13,
          points: 960,
          latePoints: 40,
          worstQueueWaitSeconds: 420,
          worstSyncSeconds: 7_500,
          minutes: 1,
        },
      ],
    },
    {
      cell: { name: 'pune-dedicated', region: 'ap-south-2', kind: 'dedicated' },
      latest: null,
      issues: [{ key: 'silent' }],
      hours: [],
    },
  ],
};

describe('health per cell in the console (M22, D93)', () => {
  it('shows each cell’s last minute, what needs looking at, its queues and its day', async () => {
    renderConsole(
      '/health',
      fakeClient(ADMIN, () => HEALTH),
    );
    const mumbai = (
      await screen.findByRole('heading', { name: 'mumbai-1 · ap-south-1 · shared' })
    ).closest('section')!;
    // Every cell in one table first, with its state.
    const cells = screen.getByRole('table', { name: 'Cells' });
    expect(within(cells).getByRole('row', { name: /mumbai-1/ })).toHaveTextContent(
      'Needs looking at',
    );
    expect(within(cells).getAllByRole('row').at(-1)).toHaveTextContent('Silent');
    expect(within(cells).getAllByRole('row').at(-1)).toHaveTextContent('Never');
    expect(within(mumbai).getByText('Server errors above 2% of requests')).toBeVisible();
    expect(within(mumbai).getByText('Jobs waiting more than 5 minutes in exports')).toBeVisible();
    expect(within(mumbai).getByText('Phones with uploads waiting more than an hour')).toBeVisible();
    const queues = within(mumbai).getByRole('table', { name: 'Queues · mumbai-1' });
    expect(within(queues).getByRole('row', { name: /exports/ })).toHaveTextContent('7 min');
    expect(within(mumbai).getByText('2 h 5 min', { selector: 'dd' })).toBeVisible();
    expect(
      within(mumbai).getByRole('table', { name: 'The last day, by the hour · mumbai-1' }),
    ).toHaveTextContent('412');

    const pune = screen
      .getByRole('heading', { name: 'pune-dedicated · ap-south-2 · dedicated' })
      .closest('section')!;
    expect(within(pune).getByText('Not reporting for 3 minutes or more')).toBeVisible();
    expect(within(pune).getByText('This cell has not reported yet.')).toBeVisible();
  });
});
