import { z } from 'zod';
import { ERP_ISSUES, ERP_PROVIDERS, ZOHO_REGION_KEYS } from '../erp';
import { Key } from './config';

/** ERP connections, their mappings and their runs (module M20, BR-59, decision D129). */

export const ErpProviderKey = z.enum(ERP_PROVIDERS);
export const ZohoRegionKey = z.enum(ZOHO_REGION_KEYS);
export const ERP_CONNECTION_STATUSES = [
  'choosing',
  'connected',
  'needs_reconnect',
  'disconnected',
] as const;
export const ErpConnectionStatus = z.enum(ERP_CONNECTION_STATUSES);
export const ERP_ENTITIES = ['account', 'item', 'price', 'invoice', 'receipt', 'order'] as const;
export const ErpEntity = z.enum(ERP_ENTITIES);
export type ErpEntity = z.infer<typeof ErpEntity>;

/** What a connection reads and how (the portal's mappings); every part has a default. */
export const ErpSettings = z
  .strictObject({
    /** The account type customers become; nothing is read into accounts without one. */
    accountType: Key.nullable().default(null),
    /** A Zoho custom field holding the territory's code. */
    territoryField: z.string().trim().min(1).max(100).nullable().default(null),
    /** The territory's code for a new customer whose field is empty. */
    defaultTerritory: z.string().trim().min(1).max(60).nullable().default(null),
    /** The price list an item's rate goes to; null is the default list. */
    itemPriceList: z.uuid().nullable().default(null),
    /** Zoho's price books, each read into one of the tenant's price lists. */
    priceBooks: z
      .array(z.strictObject({ pricebookId: z.string().min(1).max(40), priceList: z.uuid() }))
      .max(20)
      .default([]),
    /** SAP: a user field on items holding the GST rate (BR-60). */
    taxRateField: z.string().trim().min(1).max(100).nullable().default(null),
    /** SAP: the GST rate of an item whose field is empty. */
    defaultTaxRate: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,4})?$/, 'Write a rate such as 18 or 5.5')
      .nullable()
      .default(null),
    /** The books' unit names to the catalogue's unit keys, where they differ. */
    units: z.record(z.string().trim().min(1).max(40), Key).default({}),
    /** How many days back invoices and payments are read. */
    invoiceDays: z.int().min(7).max(730).default(180),
    /** The organisation's daily limit on its Zoho Books plan (Free 1,000). */
    dailyCalls: z.int().min(100).max(100_000).default(1000),
    read: z
      .strictObject({
        customers: z.boolean(),
        items: z.boolean(),
        invoices: z.boolean(),
        payments: z.boolean(),
      })
      .default({ customers: true, items: true, invoices: true, payments: true }),
    /** Accepted orders go to the books as sales orders. */
    pushOrders: z.boolean().default(false),
  })
  .meta({ id: 'ErpSettings' });
export type ErpSettings = z.infer<typeof ErpSettings>;

export const ErpOrganization = z.object({ id: z.string(), name: z.string() });

export const ErpConnectionResult = z
  .object({
    id: z.uuid(),
    provider: ErpProviderKey,
    status: ErpConnectionStatus,
    region: ZohoRegionKey.nullable(),
    organization: ErpOrganization.nullable(),
    /** The organisations to choose from while the status is `choosing`. */
    organizations: z.array(ErpOrganization),
    settings: ErpSettings,
    /** SAP: the Service Layer's address, company database and user; the password never returns. */
    endpoint: z.string().nullable(),
    companyDb: z.string().nullable(),
    username: z.string().nullable(),
    connectedAt: z.iso.datetime().nullable(),
    connectedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    lastRunAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ErpConnection' });
export type ErpConnectionResult = z.infer<typeof ErpConnectionResult>;

/** `GET /v1/erp-connections`: each provider, whether this cell is set up for it, and its connection. */
export const ErpProvidersResult = z
  .object({
    providers: z.array(
      z.object({
        provider: ErpProviderKey,
        configured: z.boolean(),
        connection: ErpConnectionResult.nullable(),
      }),
    ),
  })
  .meta({ id: 'ErpProviders' });

/** `POST /v1/erp-connections/zoho/start`: where to send the browser to agree. */
export const ErpStartBody = z.strictObject({ region: ZohoRegionKey }).meta({ id: 'ErpStartBody' });
export const ErpStartResult = z.object({ authorizeUrl: z.url() }).meta({ id: 'ErpStart' });

/** `POST /v1/erp-connections/zoho/complete`: what Zoho sent the browser back with. */
export const ErpCompleteBody = z
  .strictObject({
    code: z.string().min(1).max(500),
    state: z.string().min(1).max(100),
    accountsServer: z.string().min(1).max(200),
  })
  .meta({ id: 'ErpCompleteBody' });

/**
 * `POST /v1/erp-connections/sap-b1`: the Service Layer's address (HTTPS on 443), the company
 * database, and a user made for the connection; checked by signing in before it is kept.
 */
export const SapConnectBody = z
  .strictObject({
    endpoint: z.string().trim().min(1).max(300),
    companyDb: z.string().trim().min(1).max(100),
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
  })
  .meta({ id: 'SapConnectBody' });

export const ErpOrganizationBody = z
  .strictObject({ organizationId: z.string().min(1).max(40) })
  .meta({ id: 'ErpOrganizationBody' });

export const ErpRunCounts = z.object({
  read: z.int(),
  created: z.int(),
  updated: z.int(),
  unchanged: z.int(),
  skipped: z.int(),
});

/** Something a run couldn't take, named by the record's number or name in the books. */
export const ErpProblem = z.object({
  entity: ErpEntity,
  externalId: z.string(),
  /** The record's number, code or name in the books, to find it there. */
  label: z.string(),
  issue: z.enum(ERP_ISSUES),
  /** The import's own words for a refused row, and its field. */
  field: z.string().nullable(),
  detail: z.string().nullable(),
});
export type ErpProblem = z.infer<typeof ErpProblem>;

export const ErpRunResult = z
  .object({
    id: z.uuid(),
    kind: z.enum(['pull', 'push']),
    status: z.enum(['running', 'ok', 'partial', 'failed']),
    /** Why a run stopped short: the day's calls, Zoho's limit, a refused token, an error. */
    stoppedBy: z.enum(['daily_limit', 'rate_limited', 'reconnect', 'error']).nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    counts: z.partialRecord(ErpEntity, ErpRunCounts),
    problems: z.array(ErpProblem),
    calls: z.int(),
  })
  .meta({ id: 'ErpRun' });
export type ErpRunResult = z.infer<typeof ErpRunResult>;

export const ErpRunList = z.object({ items: z.array(ErpRunResult) }).meta({ id: 'ErpRuns' });
