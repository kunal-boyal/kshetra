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
    /**
     * Zoho's price books, SAP's price lists (by number) or Tally's price levels (by name), each
     * read into one of the tenant's price lists.
     */
    priceBooks: z
      .array(z.strictObject({ pricebookId: z.string().min(1).max(100), priceList: z.uuid() }))
      .max(20)
      .default([]),
    /** SAP: a user field on items holding the GST rate (BR-60). */
    taxRateField: z.string().trim().min(1).max(100).nullable().default(null),
    /** SAP and Tally: the GST rate of an item whose own is missing. */
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
    /** Tally: the groups whose ledgers are customers, with every group under them (BR-61). */
    debtorGroups: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(20)
      .default(['Sundry Debtors']),
    /** Tally: a group's name to the territory code its customers belong to. */
    groupTerritories: z
      .record(z.string().trim().min(1).max(100), z.string().trim().min(1).max(60))
      .default({}),
    /** Tally: the voucher types read as sales and receipts, with every type under them. */
    salesTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(20).default(['Sales']),
    receiptTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(20).default(['Receipt']),
    /** Tally: the voucher type accepted orders go in as, and later Day Books show them by. */
    orderType: z.string().trim().min(1).max(100).default('Sales Order'),
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
    /** Tally: accepted orders no orders file has carried yet (at most 500 counted). */
    ordersWaiting: z.int().nullable(),
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

/**
 * `POST /v1/erp-connections/tally`: a Tally connection, which reaches nothing; the company is
 * fixed by the first file uploaded (BR-61).
 */
export const TallyConnectBody = z.strictObject({}).meta({ id: 'TallyConnectBody' });

/** `POST /v1/erp-connections/{id}/uploads`: the file's name, for the runs list. */
export const ErpUploadQuery = z
  .strictObject({ name: z.string().trim().min(1).max(200).optional() })
  .meta({ id: 'ErpUploadQuery' });

/**
 * `POST /v1/erp-connections/{id}/orders-file`: a file of the accepted orders waiting for Tally,
 * with, if named, every order an earlier file carried again (BR-61).
 */
export const TallyOrdersFileBody = z
  .strictObject({ again: z.uuid().optional() })
  .meta({ id: 'TallyOrdersFileBody' });

/** `GET /v1/erp-connections/{id}/runs/{runId}/file`: a short-lived link to save an orders file. */
export const ErpRunParams = z.strictObject({ id: z.uuid(), runId: z.uuid() });
export const ErpFileLink = z
  .object({ url: z.string(), expiresAt: z.iso.datetime() })
  .meta({ id: 'ErpFileLink' });

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
    /** A read, a send of orders, or a Tally file uploaded (BR-61). */
    kind: z.enum(['pull', 'push', 'upload']),
    status: z.enum(['running', 'ok', 'partial', 'failed']),
    /**
     * Why a run stopped short: the day's calls, Zoho's limit, a refused token, an error, or an
     * uploaded file that couldn't be read.
     */
    stoppedBy: z.enum(['daily_limit', 'rate_limited', 'reconnect', 'error', 'bad_file']).nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    counts: z.partialRecord(ErpEntity, ErpRunCounts),
    problems: z.array(ErpProblem),
    calls: z.int(),
    /** Tally: the uploaded file's name, or the orders file's. */
    file: z.string().nullable(),
    /** Tally: whether the orders file can still be saved (kept 7 days). */
    download: z.boolean(),
  })
  .meta({ id: 'ErpRun' });
export type ErpRunResult = z.infer<typeof ErpRunResult>;

export const ErpRunList = z.object({ items: z.array(ErpRunResult) }).meta({ id: 'ErpRuns' });
