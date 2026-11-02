import { Injectable } from '@nestjs/common';
import { AppError } from '@thelamp/shared';
import { publicFetch } from '../../platform/outbound';
import { type CallMeter, ErpFailed, ErpRateLimited, ErpReconnect } from './erp-calls';

/** Records a page of a list holds; the Service Layer's own default is 20. */
const PAGE_SIZE = 100;
const TIMEOUT_MS = 30_000;

export interface SapRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SapAnswer {
  status: number;
  json: unknown;
  /** The answer's Set-Cookie values, which carry the session. */
  cookies: string[];
}

/**
 * How requests reach a Service Layer (decision D129): through the outbound guard, so only a public
 * address on HTTPS 443 is ever reached, or, in tests, a fake company (`SAP_B1_API=memory`).
 */
export abstract class SapTransport {
  abstract send(request: SapRequest): Promise<SapAnswer>;
}

@Injectable()
export class PublicSapTransport extends SapTransport {
  async send(request: SapRequest): Promise<SapAnswer> {
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
    return { status: response.status, json, cookies: response.headers.getSetCookie() };
  }
}

/** What a connection's calls need: the Service Layer's root, company, user and password. */
export interface SapLink {
  connectionId: string;
  root: string;
  companyDb: string;
  username: string;
  password: string;
}

/** A signed-in session: its cookies, renewed when the Service Layer forgets it. */
export interface SapSession {
  link: SapLink;
  cookie: string;
}

/** The Service Layer's error, whichever OData version wrote it. */
function failureOf(json: unknown): { code: string; message: string } {
  const error = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const message =
    typeof error?.message === 'string'
      ? error.message
      : typeof (error?.message as { value?: unknown } | undefined)?.value === 'string'
        ? String((error!.message as { value: string }).value)
        : 'SAP refused';
  return { code: error?.code === undefined ? '' : String(error.code), message };
}

/**
 * SAP Business One's Service Layer for every connection on the cell (BR-60, decision D129): a
 * session signed in with the company, user and password, kept by its cookies, signed in again once
 * when it lapses mid-run, and signed out after each run. Lists page by `@odata.nextLink`.
 */
@Injectable()
export class SapB1 {
  constructor(private readonly transport: SapTransport) {}

  /** Signs in; wrong details or a locked user ask for the connection to be made again. */
  async signIn(link: SapLink, meter?: CallMeter): Promise<SapSession> {
    await meter?.take();
    const answer = await this.transport.send({
      method: 'POST',
      url: `${link.root}/Login`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CompanyDB: link.companyDb,
        UserName: link.username,
        Password: link.password,
      }),
    });
    if (answer.status === 429) throw new ErpRateLimited();
    if (answer.status !== 200) throw new ErpReconnect(failureOf(answer.json).message);
    const cookie = answer.cookies
      .map((value) => value.split(';')[0]!.trim())
      .filter((pair) => /^(B1SESSION|ROUTEID)=/.test(pair))
      .join('; ');
    if (!cookie.includes('B1SESSION=')) throw new ErpReconnect('SAP gave no session.');
    return { link, cookie };
  }

  /** Checks details by signing in and out, for saving them: refused in the admin's words. */
  async check(link: SapLink): Promise<void> {
    let session: SapSession;
    try {
      session = await this.signIn(link);
    } catch (error) {
      if (error instanceof ErpReconnect || error instanceof ErpRateLimited) {
        throw new AppError(
          'ERP_REFUSED',
          'SAP Business One didn’t accept the company, user or password.',
        );
      }
      throw error;
    }
    await this.signOut(session);
  }

  async signOut(session: SapSession): Promise<void> {
    await this.transport
      .send({
        method: 'POST',
        url: `${session.link.root}/Logout`,
        headers: { Cookie: session.cookie },
      })
      .catch(() => undefined);
  }

  /** Every page of a list, such as `BusinessPartners`, with an OData query. */
  async *list<T>(
    session: SapSession,
    meter: CallMeter,
    path: string,
    query: Record<string, string> = {},
  ): AsyncGenerator<T[]> {
    let next: string | null = `${path}?${new URLSearchParams(query)}`;
    while (next) {
      const answer = (await this.call(session, meter, 'GET', next)) as {
        value?: T[];
        '@odata.nextLink'?: string;
      };
      yield answer.value ?? [];
      const link = answer['@odata.nextLink'];
      next = link ? link.replace(/^\/?(b1s\/v2\/)?/, '') : null;
    }
  }

  /** Writes a document, such as a sales order, and gives the Service Layer's answer. */
  async post(
    session: SapSession,
    meter: CallMeter,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    return (await this.call(session, meter, 'POST', path, body)) as Record<string, unknown>;
  }

  private async call(
    session: SapSession,
    meter: CallMeter,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      await meter.take();
      const answer = await this.transport.send({
        method,
        url: `${session.link.root}/${path}`,
        headers: {
          Cookie: session.cookie,
          Prefer: `odata.maxpagesize=${PAGE_SIZE}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // A session the Service Layer forgot is signed in again once; a second refusal is final.
      if (answer.status === 401 && attempt === 0) {
        session.cookie = (await this.signIn(session.link, meter)).cookie;
        continue;
      }
      if (answer.status === 401) throw new ErpReconnect();
      if (answer.status === 429) throw new ErpRateLimited();
      if (answer.status >= 300) {
        const failure = failureOf(answer.json);
        throw new ErpFailed(answer.status, failure.code, failure.message);
      }
      return answer.json;
    }
  }
}
