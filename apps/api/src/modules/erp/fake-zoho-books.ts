import { Injectable } from '@nestjs/common';
import type {
  ZohoContact,
  ZohoInvoice,
  ZohoItem,
  ZohoPayment,
  ZohoPriceBook,
} from '@thelamp/shared';
import { randomUUID } from 'node:crypto';
import { type ZohoAnswer, type ZohoRequest, ZohoTransport } from './zoho-books';

/** A sales order as the fake keeps it. */
export interface FakeSalesOrder {
  salesorder_id: string;
  customer_id: string;
  reference_number?: string;
  date?: string;
  line_items: { item_id: string; quantity: number; rate: number }[];
}

/**
 * A Zoho Books organisation in memory (`ZOHO_API=memory`, decision D129), answering as Zoho's
 * accounts server and API v3 do for what a connection uses: codes and tokens, organisations,
 * contacts, items, price books, invoices, payments and sales orders, paged as Zoho pages them.
 * Tests fill its records, make it fail on demand, and count its calls.
 */
@Injectable()
export class FakeZohoBooks extends ZohoTransport {
  organizations = [{ organization_id: '60001', name: 'Sunrise Traders Pvt Ltd' }];
  contacts: ZohoContact[] = [];
  items: ZohoItem[] = [];
  priceBooks: ZohoPriceBook[] = [];
  invoices: ZohoInvoice[] = [];
  payments: ZohoPayment[] = [];
  salesOrders: FakeSalesOrder[] = [];
  /** A page holds this many records; tests lower it to see paging. */
  pageSize = 200;
  /** Every request, as sent, with its tokens and secrets. */
  readonly requests: ZohoRequest[] = [];

  private readonly codes = new Set<string>();
  private readonly refreshTokens = new Set<string>();
  private readonly accessTokens = new Set<string>();
  private failures: {
    match: string;
    status: number;
    method?: 'GET' | 'POST';
    afterwards?: () => void;
  }[] = [];

  /** A code Zoho would hand the browser after the person agreed. */
  issueCode(): string {
    const code = `1000.${randomUUID()}`;
    this.codes.add(code);
    return code;
  }

  /**
   * The next request whose path holds `match` (and of `method`, if given) answers `status`, after
   * `afterwards` runs; a status of 0 does the work and then loses the answer, as a dropped
   * connection would.
   */
  failNext(match: string, status: number, method?: 'GET' | 'POST', afterwards?: () => void): void {
    this.failures.push({
      match,
      status,
      ...(method ? { method } : {}),
      ...(afterwards ? { afterwards } : {}),
    });
  }

  /** Every refresh token stops working, as if the person revoked access at Zoho. */
  revokeAll(): void {
    this.refreshTokens.clear();
    this.accessTokens.clear();
  }

  /** Calls to the books' API, tokens left out. */
  apiCalls(): ZohoRequest[] {
    return this.requests.filter((request) => request.url.includes('/books/v3/'));
  }

  async send(request: ZohoRequest): Promise<ZohoAnswer> {
    this.requests.push(request);
    const url = new URL(request.url);
    const failure = this.failures.find(
      (entry) =>
        url.pathname.includes(entry.match) && (!entry.method || entry.method === request.method),
    );
    if (failure) {
      this.failures = this.failures.filter((entry) => entry !== failure);
      if (failure.status === 0) {
        // The call reaches Zoho and does its work, but the answer is lost on the way back.
        await this.answer(request, url);
        throw new Error('The connection was reset.');
      }
      failure.afterwards?.();
      return { status: failure.status, json: { code: 44, message: 'Refused by the fake.' } };
    }
    return this.answer(request, url);
  }

  private async answer(request: ZohoRequest, url: URL): Promise<ZohoAnswer> {
    const query = url.searchParams;
    if (url.pathname === '/oauth/v2/token') return this.token(query);
    if (url.pathname === '/oauth/v2/token/revoke') {
      this.refreshTokens.delete(query.get('token') ?? '');
      return { status: 200, json: { status: 'success' } };
    }
    const token = request.headers.Authorization?.replace('Zoho-oauthtoken ', '') ?? '';
    if (!this.accessTokens.has(token)) {
      return { status: 401, json: { code: 57, message: 'You are not authorized.' } };
    }
    const path = url.pathname.replace(/^\/books\/v3\//, '');
    if (path === 'organizations') {
      return { status: 200, json: { code: 0, organizations: this.organizations } };
    }
    if (!this.organizations.some((org) => org.organization_id === query.get('organization_id'))) {
      return { status: 400, json: { code: 6041, message: 'Organization not found.' } };
    }
    const one = /^contacts\/(.+)$/.exec(path);
    if (one) {
      const contact = this.contacts.find((entry) => entry.contact_id === one[1]);
      return contact
        ? { status: 200, json: { code: 0, contact } }
        : { status: 404, json: { code: 1002, message: 'Contact does not exist.' } };
    }
    const book = /^pricebooks\/(.+)$/.exec(path);
    if (book) {
      const pricebook = this.priceBooks.find((entry) => entry.pricebook_id === book[1]);
      return pricebook
        ? { status: 200, json: { code: 0, pricebook } }
        : { status: 404, json: { code: 1002, message: 'Price book does not exist.' } };
    }
    const since = query.get('date_start') ?? '';
    switch (path) {
      case 'contacts':
        // A list leaves out what only a contact's own page gives, as Zoho's does.
        return this.page('contacts', this.listed(), query);
      case 'items':
        return this.page('items', this.items, query);
      case 'pricebooks':
        return this.page(
          'pricebooks',
          this.priceBooks.map((book) => {
            const listed = { ...book };
            delete listed.pricebook_items;
            return listed;
          }),
          query,
        );
      case 'invoices':
        return this.page(
          'invoices',
          this.invoices.filter((invoice) => invoice.date >= since),
          query,
        );
      case 'customerpayments':
        return this.page(
          'customerpayments',
          this.payments.filter((payment) => payment.date >= since),
          query,
        );
      case 'salesorders':
        if (request.method === 'POST') return this.createOrder(request);
        return this.page(
          'salesorders',
          this.salesOrders.filter(
            (order) =>
              !query.get('reference_number') ||
              order.reference_number === query.get('reference_number'),
          ),
          query,
        );
      default:
        return { status: 404, json: { code: 5, message: 'Invalid URL.' } };
    }
  }

  private listed() {
    return this.contacts
      .filter((contact) => (contact.contact_type ?? 'customer') === 'customer')
      .map((contact) => {
        const listed = { ...contact };
        delete listed.billing_address;
        delete listed.custom_fields;
        return listed;
      });
  }

  private token(query: URLSearchParams): ZohoAnswer {
    if (query.get('client_id') !== 'test-zoho-client') {
      return { status: 200, json: { error: 'invalid_client' } };
    }
    const issue = () => {
      const access = `1000.access.${randomUUID()}`;
      this.accessTokens.add(access);
      return access;
    };
    if (query.get('grant_type') === 'authorization_code') {
      const code = query.get('code') ?? '';
      if (!this.codes.delete(code)) return { status: 200, json: { error: 'invalid_code' } };
      const refresh = `1000.refresh.${randomUUID()}`;
      this.refreshTokens.add(refresh);
      return {
        status: 200,
        json: {
          access_token: issue(),
          refresh_token: refresh,
          api_domain: 'https://www.zohoapis.in',
          token_type: 'Bearer',
          expires_in: 3600,
        },
      };
    }
    if (!this.refreshTokens.has(query.get('refresh_token') ?? '')) {
      return { status: 200, json: { error: 'invalid_code' } };
    }
    return {
      status: 200,
      json: {
        access_token: issue(),
        api_domain: 'https://www.zohoapis.in',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    };
  }

  private page(key: string, records: readonly unknown[], query: URLSearchParams): ZohoAnswer {
    const page = Number(query.get('page') ?? 1);
    const size = Math.min(this.pageSize, Number(query.get('per_page') ?? 200));
    const slice = records.slice((page - 1) * size, page * size);
    return {
      status: 200,
      json: {
        code: 0,
        [key]: slice,
        page_context: { page, per_page: size, has_more_page: page * size < records.length },
      },
    };
  }

  private createOrder(request: ZohoRequest): ZohoAnswer {
    const body = JSON.parse(request.body ?? '{}') as Omit<FakeSalesOrder, 'salesorder_id'>;
    const salesorder = { ...body, salesorder_id: String(70000 + this.salesOrders.length) };
    this.salesOrders.push(salesorder);
    return { status: 201, json: { code: 0, salesorder } };
  }
}
