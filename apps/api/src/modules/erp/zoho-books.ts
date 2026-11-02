import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  callsLeft,
  ZOHO_CALLS_PER_MINUTE,
  ZOHO_REGIONS,
  type ZohoRegion,
  zohoHostIssue,
} from '@thelamp/shared';
import type { Config } from '../../config';
import { publicFetch } from '../../platform/outbound';
import { CONFIG } from '../../platform/tokens';

/** What Zoho Books may read and write for a connection (docs/integrations/zoho-books.md). */
export const ZOHO_SCOPES = [
  'ZohoBooks.contacts.READ',
  'ZohoBooks.settings.READ',
  'ZohoBooks.invoices.READ',
  'ZohoBooks.customerpayments.READ',
  'ZohoBooks.salesorders.CREATE',
  'ZohoBooks.salesorders.READ',
].join(',');

/** A page of a Zoho list holds at most this many records. */
const PER_PAGE = 200;
const TIMEOUT_MS = 30_000;

export interface ZohoRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ZohoAnswer {
  status: number;
  json: unknown;
}

/**
 * How requests reach Zoho (decision D129): over the outbound guard to Zoho's own hosts, or, in
 * tests, to a fake organisation (`ZOHO_API=memory`). Nothing else in the cell calls Zoho.
 */
export abstract class ZohoTransport {
  abstract send(request: ZohoRequest): Promise<ZohoAnswer>;
}

/** Zoho itself, through `publicFetch`: HTTPS on 443 to a public address, connected to as checked. */
@Injectable()
export class PublicZohoTransport extends ZohoTransport {
  async send(request: ZohoRequest): Promise<ZohoAnswer> {
    const response = await publicFetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }
}

/** The books answered 429: a limit was met; the run stops and the next carries on. */
export class ZohoRateLimited extends Error {}
/** The refresh token was refused: the connection must be made again. */
export class ZohoReconnect extends Error {}
/** The run's share of the day's calls is spent. */
export class ZohoDailyLimit extends Error {}
/** Any other refusal, with Zoho's code and message (never a token). */
export class ZohoFailed extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Counts a run's calls against the organisation's day (BR-59) and paces them under Zoho's
 * per-minute limit; `used` is the day's count, saved with the run.
 */
export class CallMeter {
  private readonly recent: number[] = [];

  constructor(
    public used: number,
    private readonly dailyLimit: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Calls made in this run. */
  calls = 0;

  async take(): Promise<void> {
    if (callsLeft(this.used, this.dailyLimit) <= 0) throw new ZohoDailyLimit();
    const now = Date.now();
    while (this.recent.length > 0 && now - this.recent[0]! >= 60_000) this.recent.shift();
    if (this.recent.length >= ZOHO_CALLS_PER_MINUTE) {
      await this.sleep(60_000 - (now - this.recent[0]!));
      this.recent.shift();
    }
    this.recent.push(Date.now());
    this.used += 1;
    this.calls += 1;
  }
}

/** What a connection's API calls need: where, which organisation, and its refresh token. */
export interface ZohoLink {
  connectionId: string;
  accountsServer: string;
  apiDomain: string;
  refreshToken: string;
  organizationId: string | null;
}

const message = (json: unknown) =>
  json && typeof json === 'object' && 'message' in json ? String(json.message) : 'Zoho refused';
const codeOf = (json: unknown) =>
  json && typeof json === 'object' && 'code' in json ? String(json.code) : '';

/**
 * Zoho Books' API v3 for every connection on the cell (decision D129): the OAuth handshake, then
 * reads and writes for one organisation, with the access token held for its hour in this process.
 * Hosts come only from Zoho's list (`zohoHostIssue`), checked before a secret or token is sent.
 */
@Injectable()
export class ZohoBooks {
  private readonly tokens = new Map<string, { token: string; until: number }>();

  constructor(
    private readonly transport: ZohoTransport,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Whether this cell holds the vendor's Zoho client. */
  configured(): boolean {
    return Boolean(this.config.ZOHO_CLIENT_ID && this.config.ZOHO_CLIENT_SECRET);
  }

  /** Where Zoho sends the browser back: the portal's page, which hands the code to the API. */
  redirectUri(): string {
    return `${this.config.WEB_URL.replace(/\/$/, '')}/settings/erp/zoho`;
  }

  /** Where the browser goes to agree, in the person's region, with a state that comes back. */
  authorizeUrl(region: ZohoRegion, state: string): string {
    const params = new URLSearchParams({
      scope: ZOHO_SCOPES,
      client_id: this.client().id,
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://${ZOHO_REGIONS[region].accounts}/oauth/v2/auth?${params}`;
  }

  /** Spends a code for the connection's tokens; the hosts are checked first. */
  async exchange(
    accountsServer: string,
    code: string,
  ): Promise<{ refreshToken: string; accessToken: string; apiDomain: string }> {
    const accounts = this.host(accountsServer, 'accounts', 'accountsServer');
    const client = this.client();
    const answer = await this.transport.send({
      method: 'POST',
      url: `${accounts}/oauth/v2/token?${new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: this.redirectUri(),
        code,
      })}`,
      headers: {},
    });
    const body = (answer.json ?? {}) as Record<string, unknown>;
    if (answer.status !== 200 || typeof body.refresh_token !== 'string' || !body.access_token) {
      throw new AppError('ERP_REFUSED', 'Zoho did not accept the code. Connect again.');
    }
    const apiDomain = this.host(String(body.api_domain ?? ''), 'api', 'apiDomain');
    return {
      refreshToken: body.refresh_token,
      accessToken: String(body.access_token),
      apiDomain,
    };
  }

  /** Revokes a refresh token at Zoho; a refusal there changes nothing here. */
  async revoke(accountsServer: string, refreshToken: string): Promise<void> {
    if (zohoHostIssue(accountsServer, 'accounts')) return;
    await this.transport
      .send({
        method: 'POST',
        url: `${this.origin(accountsServer)}/oauth/v2/token/revoke?${new URLSearchParams({ token: refreshToken })}`,
        headers: {},
      })
      .catch(() => undefined);
  }

  /** The organisations the person who agreed may reach, with the code's own access token. */
  async organizations(
    apiDomain: string,
    accessToken: string,
  ): Promise<{ id: string; name: string }[]> {
    const answer = await this.transport.send({
      method: 'GET',
      url: `${this.origin(apiDomain)}/books/v3/organizations`,
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    this.refuseFailure(answer);
    const list = ((answer.json as { organizations?: unknown[] })?.organizations ?? []) as {
      organization_id: string;
      name: string;
    }[];
    return list.map((org) => ({ id: String(org.organization_id), name: String(org.name) }));
  }

  /** Forgets a connection's access token, after a disconnect or a new refresh token. */
  forget(connectionId: string): void {
    this.tokens.delete(connectionId);
  }

  /** One record by path, such as `contacts/{id}`, under the record's own key in the answer. */
  async get<T>(link: ZohoLink, meter: CallMeter, path: string, key: string): Promise<T> {
    const answer = await this.call(link, meter, 'GET', path, {});
    return (answer as Record<string, unknown>)[key] as T;
  }

  /** Every page of a list, such as `contacts`, under its key, while the meter allows. */
  async *list<T>(
    link: ZohoLink,
    meter: CallMeter,
    path: string,
    key: string,
    query: Record<string, string> = {},
  ): AsyncGenerator<T[]> {
    for (let page = 1; ; page += 1) {
      const answer = (await this.call(link, meter, 'GET', path, {
        ...query,
        page: String(page),
        per_page: String(PER_PAGE),
      })) as Record<string, unknown>;
      yield ((answer[key] as T[] | undefined) ?? []) as T[];
      const context = answer.page_context as { has_more_page?: boolean } | null | undefined;
      if (!context?.has_more_page) return;
    }
  }

  /** Writes a record, such as a sales order, and gives Zoho's answer. */
  async post(
    link: ZohoLink,
    meter: CallMeter,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    return (await this.call(link, meter, 'POST', path, {}, body)) as Record<string, unknown>;
  }

  private async call(
    link: ZohoLink,
    meter: CallMeter,
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken(link, meter);
      await meter.take();
      const params = new URLSearchParams({
        ...(link.organizationId ? { organization_id: link.organizationId } : {}),
        ...query,
      });
      const answer = await this.transport.send({
        method,
        url: `${this.origin(link.apiDomain)}/books/v3/${path}?${params}`,
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // An access token Zoho no longer takes is made again once; a second refusal is final.
      if (answer.status === 401 && attempt === 0) {
        this.forget(link.connectionId);
        continue;
      }
      this.refuseFailure(answer);
      return answer.json;
    }
  }

  private async accessToken(link: ZohoLink, meter: CallMeter): Promise<string> {
    const held = this.tokens.get(link.connectionId);
    if (held && held.until > Date.now()) return held.token;
    const client = this.client();
    await meter.take();
    const answer = await this.transport.send({
      method: 'POST',
      url: `${this.origin(link.accountsServer)}/oauth/v2/token?${new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.secret,
        refresh_token: link.refreshToken,
      })}`,
      headers: {},
    });
    if (answer.status === 429) throw new ZohoRateLimited();
    const body = (answer.json ?? {}) as Record<string, unknown>;
    if (answer.status !== 200 || typeof body.access_token !== 'string') {
      throw new ZohoReconnect();
    }
    const seconds = Number(body.expires_in ?? 3600);
    // Kept five minutes short of its hour, so a call never starts on a token about to lapse.
    this.tokens.set(link.connectionId, {
      token: body.access_token,
      until: Date.now() + Math.max(60, seconds - 300) * 1000,
    });
    return body.access_token;
  }

  private refuseFailure(answer: ZohoAnswer): void {
    if (answer.status === 429) throw new ZohoRateLimited();
    if (answer.status === 401) throw new ZohoReconnect();
    if (answer.status >= 300) {
      throw new ZohoFailed(answer.status, codeOf(answer.json), message(answer.json));
    }
  }

  private client(): { id: string; secret: string } {
    const id = this.config.ZOHO_CLIENT_ID;
    const secret = this.config.ZOHO_CLIENT_SECRET;
    if (!id || !secret) {
      throw new AppError('ERP_NOT_CONFIGURED', 'This server isn’t set up for Zoho Books.');
    }
    return { id, secret };
  }

  /** A checked host as an origin, or the field it came in refused. */
  private host(address: string, kind: 'accounts' | 'api', path: string): string {
    const issue = zohoHostIssue(address, kind);
    if (issue) {
      throw new AppError('VALIDATION', 'That isn’t one of Zoho’s addresses.', [{ path, issue }]);
    }
    return this.origin(address);
  }

  private origin(address: string): string {
    if (zohoHostIssue(address, address.includes('zohoapis') ? 'api' : 'accounts')) {
      throw new ZohoReconnect();
    }
    return address
      .trim()
      .replace(/(:443)?\/?$/, '')
      .toLowerCase();
  }
}
