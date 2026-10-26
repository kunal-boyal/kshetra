import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browser } from '../browser';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const RAVI = '01a10000-0000-7000-8000-000000000004';

const REQUEST = {
  id: '01a10000-0000-7000-8000-0000000000a1',
  person: { id: RAVI, name: 'Ravi Shah', code: 'SUN-004' },
  kind: 'access' as const,
  status: 'received' as const,
  details: 'Everything you hold about me',
  response: null,
  raisedBy: { self: true, name: 'Ravi Shah' },
  dueOn: '2099-11-25',
  createdAt: '2026-10-26T05:00:00.000Z',
  closedAt: null,
  closedBy: null,
  archive: null,
  download: null,
};

const PERSON = {
  id: RAVI,
  code: 'SUN-004',
  name: 'Ravi Shah',
  phone: null,
  email: null,
  designation: 'executive',
  role: 'field_user',
  managerId: null,
  manager: null,
  joiningDate: '2026-04-01',
  exitDate: null,
  calendarKey: null,
  status: 'inactive',
  territories: [],
  custom: {},
  createdAt: '2026-10-06T07:00:00.000Z',
  updatedAt: '2026-10-06T07:00:00.000Z',
  device: null,
};

function requestsClient(
  request: object,
  onWrite: (path: string, body: unknown) => unknown = () => undefined,
) {
  let current = request;
  const answer = (path: string, options: RequestOptions) => {
    const changed = onWrite(path, options.body);
    if (changed instanceof ApiError) throw changed;
    current = { ...current, ...(changed as object) };
    return current;
  };
  return fakeClient(
    {
      '/v1/data-requests': () => ({ items: [current] }),
      '/v1/data-requests?status=open': () => ({
        items: (current as { status: string }).status === 'received' ? [current] : [],
      }),
      '/v1/data-requests?status=closed': () => ({
        items: (current as { status: string }).status === 'received' ? [] : [current],
      }),
      [`/v1/data-requests/${REQUEST.id}`]: () => current,
      '/v1/users': { items: [PERSON], nextCursor: null },
    },
    {
      'POST /v1/data-requests': ({ body }: RequestOptions) => ({ ...REQUEST, ...(body as object) }),
      [`POST /v1/data-requests/${REQUEST.id}/archive`]: (options: RequestOptions) =>
        answer('archive', options),
      [`POST /v1/data-requests/${REQUEST.id}/close`]: (options: RequestOptions) =>
        answer('close', options),
    },
    ['settings.manage'],
  );
}

describe('personal data requests in Settings (M21, D95)', () => {
  it('lists open requests by when due, and logs one for someone who has left', async () => {
    const client = requestsClient(REQUEST);
    renderAt('/settings/data-requests', client);
    const open = await screen.findByRole('region', { name: 'Open' });
    await within(open).findAllByRole('link');
    expect(
      within(open).getByRole('link', { name: 'Ravi Shah · A copy of their data' }),
    ).toBeVisible();
    expect(within(open).getByText('Due 25 Nov 2099')).toBeVisible();

    const user = userEvent.setup();
    const log = screen.getByRole('region', { name: 'Log a request' });
    await user.type(within(log).getByRole('searchbox', { name: 'Person' }), 'ravi');
    await user.click(await within(log).findByRole('button', { name: /Ravi Shah/ }));
    await user.selectOptions(within(log).getByLabelText('Request'), 'erasure');
    await user.type(within(log).getByLabelText('What they asked'), 'By letter');
    await user.click(within(log).getByRole('button', { name: 'Log request' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe('/v1/data-requests');
    expect((options as RequestOptions).body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      userId: RAVI,
      kind: 'erasure',
      details: 'By letter',
    });
  });

  it('prepares an access request’s archive, downloads it and marks it done', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {});
    const client = requestsClient(REQUEST, (path, body) => {
      if (path === 'archive') {
        return {
          archive: {
            status: 'ready',
            bytes: 1024,
            sha256: 'a'.repeat(64),
            expiresAt: '2099-11-02T00:00:00.000Z',
          },
          download: {
            url: 'https://files.example/ravi.zip',
            expiresAt: '2099-11-02T00:00:00.000Z',
          },
        };
      }
      return {
        status: (body as { outcome: string }).outcome,
        response: (body as { response: string }).response,
      };
    });
    renderAt(`/settings/data-requests/${REQUEST.id}`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Prepare their archive' }));
    await user.click(await screen.findByRole('button', { name: 'Download their archive' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://files.example/ravi.zip'));

    await user.type(screen.getByRole('textbox', { name: /^Answer to them/ }), 'Sent to your email');
    await user.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText('Done')).toBeVisible();
    expect((writesOf(client).at(-1)![3] as RequestOptions).body).toEqual({
      outcome: 'completed',
      response: 'Sent to your email',
    });
  });

  it('erases only after asking, and says when the person must be deactivated first', async () => {
    const client = requestsClient(
      { ...REQUEST, kind: 'erasure' },
      () =>
        new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
          { path: 'outcome', issue: 'Deactivate them before erasing their data' },
        ]),
    );
    renderAt(`/settings/data-requests/${REQUEST.id}`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erase their data' }));
    expect(screen.getByText(/Erase Ravi Shah’s personal data\?/)).toBeVisible();
    expect(writesOf(client)).toEqual([]);
    await user.click(
      within(screen.getByRole('group')).getByRole('button', { name: 'Erase their data' }),
    );
    expect(await screen.findByText('Deactivate them before erasing their data')).toBeVisible();
  });
});
