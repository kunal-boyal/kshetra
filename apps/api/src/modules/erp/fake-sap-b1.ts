import { Injectable } from '@nestjs/common';
import type { SapBusinessPartner, SapInvoice, SapItem, SapPayment } from '@thelamp/shared';
import { randomUUID } from 'node:crypto';
import { type SapAnswer, type SapRequest, SapTransport } from './sap-b1';

/** A sales order as the fake keeps it. */
export interface FakeSapOrder {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  NumAtCard?: string;
  DocDate?: string;
  DocumentLines: { ItemCode: string; Quantity: number; UnitPrice: number }[];
}

/** The fake company's sign-in, fictional, as tests send it. */
export const FAKE_SAP_COMPANY = {
  companyDb: 'SBODEMOIN',
  username: 'thelamp-connector',
  password: 'fictional-service-layer-password',
};

/**
 * An SAP Business One company in memory (`SAP_B1_API=memory`, decision D129), answering as the
 * Service Layer does for what a connection uses: sign-in with cookies, business partners, items
 * and their groups, A/R invoices, incoming payments and orders, filtered by the few OData
 * expressions a connection sends and paged by `@odata.nextLink`. Tests fill it, expire its
 * sessions, make it fail, and count its calls.
 */
@Injectable()
export class FakeSapB1 extends SapTransport {
  partners: SapBusinessPartner[] = [];
  items: SapItem[] = [];
  itemGroups: { Number: number; GroupName: string }[] = [];
  invoices: SapInvoice[] = [];
  payments: SapPayment[] = [];
  orders: FakeSapOrder[] = [];
  /** A page holds this many records; tests lower it to see paging. */
  pageSize = 100;
  readonly requests: SapRequest[] = [];
  private readonly sessions = new Set<string>();
  private failures: { match: string; status: number; method?: 'GET' | 'POST' }[] = [];

  /** Every session ends, as after the Service Layer's 30 minutes or a restart. */
  expireSessions(): void {
    this.sessions.clear();
  }

  /** The next request whose path holds `match` answers `status`; 0 does the work and loses it. */
  failNext(match: string, status: number, method?: 'GET' | 'POST'): void {
    this.failures.push({ match, status, ...(method ? { method } : {}) });
  }

  /** Calls to the company's records, sign-in and sign-out left out. */
  apiCalls(): SapRequest[] {
    return this.requests.filter(
      (request) => !/\/(Login|Logout)$/.test(new URL(request.url).pathname),
    );
  }

  async send(request: SapRequest): Promise<SapAnswer> {
    this.requests.push(request);
    const url = new URL(request.url);
    const failure = this.failures.find(
      (entry) =>
        url.pathname.includes(entry.match) && (!entry.method || entry.method === request.method),
    );
    if (failure) {
      this.failures = this.failures.filter((entry) => entry !== failure);
      if (failure.status === 0) {
        await this.answer(request, url);
        throw new Error('The connection was reset.');
      }
      return {
        status: failure.status,
        json: { error: { code: '-1', message: 'Refused by the fake.' } },
        cookies: [],
      };
    }
    return this.answer(request, url);
  }

  private async answer(request: SapRequest, url: URL): Promise<SapAnswer> {
    const path = url.pathname.replace(/^\/b1s\/v2\//, '');
    if (path === 'Login') {
      const body = JSON.parse(request.body ?? '{}') as Record<string, string>;
      if (
        body.CompanyDB !== FAKE_SAP_COMPANY.companyDb ||
        body.UserName !== FAKE_SAP_COMPANY.username ||
        body.Password !== FAKE_SAP_COMPANY.password
      ) {
        return {
          status: 401,
          json: { error: { code: '-304', message: 'Fail to get DB Credentials from SLD' } },
          cookies: [],
        };
      }
      const session = randomUUID();
      this.sessions.add(session);
      return {
        status: 200,
        json: { SessionId: session, SessionTimeout: 30 },
        cookies: [`B1SESSION=${session}; path=/b1s; Secure; HttpOnly`, 'ROUTEID=.node1; path=/b1s'],
      };
    }
    const session = /B1SESSION=([^;]+)/.exec(request.headers.Cookie ?? '')?.[1];
    if (!session || !this.sessions.has(session)) {
      return {
        status: 401,
        json: { error: { code: '301', message: 'Invalid session or session already timeout.' } },
        cookies: [],
      };
    }
    if (path === 'Logout') {
      this.sessions.delete(session);
      return { status: 204, json: null, cookies: [] };
    }
    const query = url.searchParams;
    switch (path) {
      case 'BusinessPartners':
        return this.page(path, this.partners, query);
      case 'Items':
        return this.page(path, this.items, query);
      case 'ItemGroups':
        return this.page(path, this.itemGroups, query);
      case 'Invoices':
        return this.page(path, this.invoices, query);
      case 'IncomingPayments':
        return this.page(path, this.payments, query);
      case 'Orders':
        if (request.method === 'POST') {
          const body = JSON.parse(request.body ?? '{}') as Omit<
            FakeSapOrder,
            'DocEntry' | 'DocNum'
          >;
          const order = {
            ...body,
            DocEntry: 900 + this.orders.length,
            DocNum: 5000 + this.orders.length,
          };
          this.orders.push(order);
          return { status: 201, json: order, cookies: [] };
        }
        return this.page(path, this.orders, query);
      default:
        return { status: 404, json: { error: { code: '-1', message: 'Not found.' } }, cookies: [] };
    }
  }

  /** The few `$filter` expressions a connection sends: `Field eq|ge 'value'`, joined by `and`. */
  private matches(record: Record<string, unknown>, filter: string | null): boolean {
    if (!filter) return true;
    return filter.split(/\s+and\s+/).every((part) => {
      const match = /^\(?(\w+)\s+(eq|ge)\s+'([^']*)'\)?$/.exec(part.trim());
      if (!match) throw new Error(`The fake can't read the filter ${part}`);
      const [, field, op, value] = match as unknown as [string, string, string, string];
      const actual = String(record[field] ?? '');
      return op === 'eq' ? actual === value : actual.slice(0, value.length) >= value;
    });
  }

  private page(path: string, records: readonly object[], query: URLSearchParams): SapAnswer {
    const filter = query.get('$filter');
    const found = records.filter((record) =>
      this.matches(record as Record<string, unknown>, filter),
    );
    const skip = Number(query.get('$skip') ?? 0);
    const value = found.slice(skip, skip + this.pageSize);
    const more = skip + this.pageSize < found.length;
    const next = new URLSearchParams(query);
    next.set('$skip', String(skip + this.pageSize));
    return {
      status: 200,
      json: { value, ...(more ? { '@odata.nextLink': `${path}?${next}` } : {}) },
      cookies: [],
    };
  }
}
