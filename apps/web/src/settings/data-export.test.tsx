import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browser } from '../browser';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const READY = {
  id: '01a10000-0000-7000-8000-0000000000f5',
  status: 'ready' as const,
  requestedBy: { id: '01a10000-0000-7000-8000-000000000002', name: 'Anita Rao' },
  fileName: 'data-export-2026-10-26.zip',
  bytes: 52_428_800,
  sha256: 'a'.repeat(64),
  tables: 84,
  rows: 120_431,
  files: 312,
  keyId: '0123456789abcdef',
  error: null,
  createdAt: '2026-10-26T05:00:00.000Z',
  finishedAt: '2026-10-26T05:04:00.000Z',
  expiresAt: '2026-11-02T05:04:00.000Z',
  download: null,
};

const KEY = {
  keyId: '0123456789abcdef',
  algorithm: 'Ed25519',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----\n',
};

function exportsClient(items: object[]) {
  let current = items;
  return fakeClient(
    {
      '/v1/data-exports': () => ({ items: current }),
      '/v1/data-exports/signing-key': KEY,
      [`/v1/data-exports/${READY.id}`]: {
        ...READY,
        download: { url: 'https://files.example/archive.zip', expiresAt: READY.expiresAt },
      },
    },
    {
      'POST /v1/data-exports': ({ body }: RequestOptions) => {
        const asked = {
          ...READY,
          ...(body as { id: string }),
          status: 'queued',
          fileName: null,
          bytes: null,
          sha256: null,
          tables: null,
          rows: null,
          files: null,
          expiresAt: null,
        };
        current = [asked, ...current];
        return asked;
      },
    },
    ['settings.manage'],
  );
}

describe('data export in Settings (M21, D95)', () => {
  it('lists exports with what they hold, and downloads through a fresh link', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {});
    const client = exportsClient([READY]);
    renderAt('/settings/data-export', client);
    const table = await screen.findByRole('table', { name: 'Exports' });
    const row = within(table).getByRole('row', { name: /Anita Rao/ });
    expect(row).toHaveTextContent('Ready');
    expect(row).toHaveTextContent('84 tables, 1,20,431 rows, 312 files');
    expect(row).toHaveTextContent('50 MB');
    expect(row).toHaveTextContent('a'.repeat(64));
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /^Download the export of/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://files.example/archive.zip'));
    expect(screen.getByRole('link', { name: 'Data export' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const check = screen.getByRole('region', { name: 'Checking an archive' });
    expect(within(check).getByText('0123456789abcdef')).toBeVisible();
  });

  it('asks for an export and waits while it is prepared', async () => {
    const client = exportsClient([]);
    renderAt('/settings/data-export', client);
    const user = userEvent.setup();
    expect(await screen.findByText('No exports yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Prepare an export' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your export.');
    expect(screen.getByRole('button', { name: 'Prepare an export' })).toBeDisabled();
    expect(
      within(screen.getByRole('table', { name: 'Exports' })).getByText('Waiting'),
    ).toBeVisible();
    expect((writesOf(client)[0]![3] as RequestOptions).body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });
});
