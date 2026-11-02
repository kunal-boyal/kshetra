import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  type ErpConnectionResult,
  type ErpProblem,
  type ErpRunResult,
  ErpSettings,
  EXPORT_KEEP_DAYS,
  type ErpProvider,
  type ErrorDetail,
  newId,
  sapEndpointIssue,
  sapServiceRoot,
  type ZohoRegion,
  zohoRegionOf,
} from '@thelamp/shared';
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { erpConnections, erpLinks, erpRuns } from '../../db/schema/erp';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { Database, type TenantTx } from '../../platform/database';
import { publicUrlIssue } from '../../platform/outbound';
import { Queues } from '../../platform/queues';
import type { Config } from '../../config';
import { CONFIG } from '../../platform/tokens';
import { RedisClient } from '../../platform/redis';
import { AccountTypesService } from '../accounts/account-types.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { MediaService } from '../media/media.service';
import { MediaUrls } from '../media/media-urls';
import { OrdersService } from '../orders/orders.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { People } from '../iam/people';
import { TerritoriesService } from '../territories/territories.service';
import { SapB1 } from './sap-b1';
import { checkTallyFile, TallyFileRefused, tallyText } from './tally-file';
import { ZohoBooks } from './zoho-books';

export type ConnectionRow = typeof erpConnections.$inferSelect;
type RunRow = typeof erpRuns.$inferSelect;

/** The job that reads the books into the tenant's records. */
export const PULL = 'erp.pull';
/** The job that sends accepted orders to the books, or writes Tally's orders file. */
export const PUSH = 'erp.push';
/** An orders file is kept as long as an export (spec 12.2). */
const ORDERS_FILE_KEEP_MS = EXPORT_KEEP_DAYS * 86_400_000;
/** Orders counted as waiting for Tally, at most. */
const WAITING_COUNTED = 500;
/** A connection's state is good for ten minutes, the time to agree at Zoho. */
const STATE_SECONDS = 600;
/** A run still marked running after this long was cut short (a worker stopped). */
const STALE_RUN_MS = 2 * 60 * 60_000;
/** A Tally file is an import file: 20 MB at most, as the body parser allows (M19). */
const TALLY_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Where the refresh token is sealed: its column and row, so it can't be moved to another. */
export const sealedAt = (id: string) => `erp_connections.refresh_token_sealed:${id}`;
/** Where SAP's password is sealed. */
export const credentialsAt = (id: string) => `erp_connections.credentials_sealed:${id}`;
const stateKey = (state: string) => `erp-state:${createHash('sha256').update(state).digest('hex')}`;

const notFound = () => new AppError('NOT_FOUND', 'This was not found.');
const invalid = (details: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', details);

/**
 * ERP connections (module M20, BR-59, decision D129): connecting through the provider's OAuth,
 * choosing the organisation, the mappings, disconnecting, and the runs that read the books. The
 * refresh token is sealed and never leaves the cell; nothing here reads the books' records.
 */
@Injectable()
export class ErpConnectionsService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly cipher: ColumnCipher,
    private readonly redis: RedisClient,
    private readonly zoho: ZohoBooks,
    private readonly sapB1: SapB1,
    @Inject(CONFIG) private readonly cellConfig: Config,
    private readonly queues: Queues,
    private readonly people: People,
    private readonly accountTypes: AccountTypesService,
    private readonly territories: TerritoriesService,
    private readonly catalogue: CatalogueService,
    private readonly priceLists: PriceListsService,
    private readonly media: MediaService,
    private readonly urls: MediaUrls,
    private readonly orders: OrdersService,
  ) {}

  async providers(tx: TenantTx, tenantId: string) {
    const zoho = await this.row(tx, tenantId, 'zoho_books');
    const sap = await this.row(tx, tenantId, 'sap_b1');
    const tally = await this.row(tx, tenantId, 'tally');
    return {
      providers: [
        {
          provider: 'zoho_books' as const,
          configured: this.zoho.configured(),
          connection: zoho ? await this.result(tx, zoho) : null,
        },
        // SAP Business One needs nothing of the cell: each tenant brings its own server and user.
        {
          provider: 'sap_b1' as const,
          configured: true,
          connection: sap ? await this.result(tx, sap) : null,
        },
        // Tally needs nothing of the cell either: its files come up through the portal.
        {
          provider: 'tally' as const,
          configured: true,
          connection: tally ? await this.result(tx, tally) : null,
        },
      ],
    };
  }

  /**
   * Connects SAP Business One, or changes its details (BR-60): the Service Layer's address must be
   * HTTPS on 443 and public, and the company, user and password must sign in before anything is
   * kept. The password is sealed and never shown again; the mappings are kept.
   */
  async connectSap(
    access: Access,
    input: { endpoint: string; companyDb: string; username: string; password: string },
  ): Promise<ErpConnectionResult> {
    const shape = sapEndpointIssue(input.endpoint);
    if (shape) throw invalid([{ path: 'endpoint', issue: shape }]);
    const root = sapServiceRoot(input.endpoint);
    if (this.cellConfig.SAP_B1_API === 'public') {
      const reach = await publicUrlIssue(root);
      if (reach) throw invalid([{ path: 'endpoint', issue: reach }]);
    }
    await this.sapB1.check({
      connectionId: 'checking',
      root,
      companyDb: input.companyDb,
      username: input.username,
      password: input.password,
    });
    return this.database.forTenant(access.tenantId, async (tx) => {
      const before = await this.row(tx, access.tenantId, 'sap_b1', true);
      const id = before?.id ?? newId();
      const now = new Date();
      const values = {
        status: 'connected',
        endpoint: root,
        companyDb: input.companyDb,
        username: input.username,
        credentialsSealed: this.cipher.seal(input.password, credentialsAt(id)),
        organizationId: input.companyDb,
        organizationName: input.companyDb,
        connectedBy: access.userId,
        connectedAt: now,
        updatedAt: now,
        updatedBy: access.userId,
      };
      const [row] = before
        ? await tx
            .update(erpConnections)
            .set(values)
            .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
            .returning()
        : await tx
            .insert(erpConnections)
            .values({
              tenantId: access.tenantId,
              id,
              provider: 'sap_b1',
              settings: ErpSettings.parse({}),
              createdBy: access.userId,
              ...values,
            })
            .returning();
      // Another company's records are read afresh, and its changes from the start.
      if (before && (before.companyDb !== input.companyDb || before.endpoint !== root)) {
        await this.forgetSeen(tx, access.tenantId, id);
        await tx
          .update(erpConnections)
          .set({ cursors: {} })
          .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)));
      }
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'erp.connected',
        target: { type: 'erp_connection', id },
        before: before
          ? { status: before.status, endpoint: before.endpoint, companyDb: before.companyDb }
          : null,
        after: {
          provider: 'sap_b1',
          endpoint: root,
          companyDb: input.companyDb,
          username: input.username,
        },
      });
      return this.result(tx, row!);
    });
  }

  /**
   * Connects Tally (BR-61), or connects it again after a disconnection: nothing is reached, so it
   * is connected at once; its company is the one its first file names, and the mappings are kept.
   */
  async connectTally(access: Access): Promise<ErpConnectionResult> {
    return this.database.forTenant(access.tenantId, async (tx) => {
      const before = await this.row(tx, access.tenantId, 'tally', true);
      const id = before?.id ?? newId();
      const now = new Date();
      const values = {
        status: 'connected',
        connectedBy: access.userId,
        connectedAt: now,
        updatedAt: now,
        updatedBy: access.userId,
      };
      const [row] = before
        ? await tx
            .update(erpConnections)
            .set(values)
            .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
            .returning()
        : await tx
            .insert(erpConnections)
            .values({
              tenantId: access.tenantId,
              id,
              provider: 'tally',
              settings: ErpSettings.parse({}),
              createdBy: access.userId,
              ...values,
            })
            .returning();
      if (before?.status !== 'connected') {
        await this.audit.record(tx, access.tenantId, userActor(access), {
          action: 'erp.connected',
          target: { type: 'erp_connection', id },
          before: before ? { status: before.status } : null,
          after: { provider: 'tally' },
        });
      }
      return this.result(tx, row!);
    });
  }

  /**
   * Keeps a file exported from Tally and asks for it to be read (BR-61): a Tally export, with no
   * declarations, of the connection's company (the first file names it), while no other file is
   * being read. The file is an import file, kept for the tenant's `importFileRetentionDays`.
   */
  async upload(
    tx: TenantTx,
    access: Access,
    id: string,
    bytes: Uint8Array,
    fileName: string,
  ): Promise<ErpRunResult> {
    const row = await this.byId(tx, access.tenantId, id, true);
    if (row.provider !== 'tally') throw notFound();
    if (row.status !== 'connected') {
      throw new AppError('CONFLICT', 'Connect Tally first.');
    }
    if (bytes.byteLength === 0 || bytes.byteLength > TALLY_FILE_MAX_BYTES) {
      throw new AppError('VALIDATION', 'Upload a file of at most 20 MB.', [
        { path: 'file', issue: bytes.byteLength === 0 ? 'The file is empty' : 'Larger than 20 MB' },
      ]);
    }
    let company: string | null;
    try {
      ({ company } = checkTallyFile(tallyText(bytes)));
    } catch (error) {
      if (!(error instanceof TallyFileRefused)) throw error;
      throw new AppError('ERP_REFUSED', 'This isn’t a file exported from Tally.', [
        { path: 'file', issue: `tally_${error.issue}` },
      ]);
    }
    if (company && row.organizationName && company !== row.organizationName) {
      throw new AppError('ERP_REFUSED', 'This file is from another company in Tally.', [
        { path: 'file', issue: 'tally_other_company' },
      ]);
    }
    if (await this.running(tx, access.tenantId, id)) {
      throw new AppError('CONFLICT', 'A file is still being read; upload this one once it is.');
    }
    const runId = newId();
    const file = await this.media.store(tx, access.tenantId, {
      kind: 'import_file',
      fileName,
      contentType: 'application/xml',
      bytes,
      userId: access.userId,
      ownerType: 'erp_run',
      ownerId: runId,
      retentionClass: 'import_file',
    });
    if (company && !row.organizationName) {
      await tx
        .update(erpConnections)
        .set({ organizationId: company.slice(0, 200), organizationName: company })
        .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)));
    }
    const [run] = await tx
      .insert(erpRuns)
      .values({
        tenantId: access.tenantId,
        id: runId,
        connectionId: id,
        kind: 'upload',
        status: 'running',
        fileMediaId: file.id,
        fileName,
      })
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'erp.file_uploaded',
      target: { type: 'erp_run', id: runId },
      after: { connectionId: id, fileName, bytes: bytes.byteLength, sha256: file.sha256 },
    });
    // The worker reads it once this transaction has committed.
    await this.queues.add(
      'connectors',
      PULL,
      { tenantId: access.tenantId, connectionId: id, runId },
      { jobId: `erp-pull-${runId}` },
    );
    return runResult(run!);
  }

  /**
   * Asks for a file of the accepted orders waiting for Tally (BR-61), and, when an earlier file is
   * named, every order it carried again, for an import that went wrong; one run at a time.
   */
  async requestOrdersFile(access: Access, id: string, again: string | null): Promise<ErpRunResult> {
    const run = await this.database.forTenant(access.tenantId, async (tx) => {
      const row = await this.byId(tx, access.tenantId, id, true);
      if (row.provider !== 'tally') throw notFound();
      if (row.status !== 'connected') throw new AppError('CONFLICT', 'Connect Tally first.');
      if (again) {
        const [earlier] = await tx
          .select({ kind: erpRuns.kind })
          .from(erpRuns)
          .where(
            and(
              eq(erpRuns.tenantId, access.tenantId),
              eq(erpRuns.connectionId, id),
              eq(erpRuns.id, again),
            ),
          );
        if (earlier?.kind !== 'push') {
          throw invalid([{ path: 'again', issue: 'Choose an earlier orders file' }]);
        }
      }
      if (await this.running(tx, access.tenantId, id)) {
        throw new AppError('CONFLICT', 'A file is still being read or made; try once it is done.');
      }
      const [created] = await tx
        .insert(erpRuns)
        .values({
          tenantId: access.tenantId,
          id: newId(),
          connectionId: id,
          kind: 'push',
          status: 'running',
        })
        .returning();
      return created!;
    });
    await this.queues.add(
      'connectors',
      PUSH,
      { tenantId: access.tenantId, connectionId: id, runId: run.id, again },
      { jobId: `erp-push-${run.id}` },
    );
    return runResult(run);
  }

  /**
   * A five-minute link to save an orders file, for 7 days after it was made (spec 12.2); every
   * download is audited. Uploaded files are never served back.
   */
  async fileLink(access: Access, id: string, runId: string) {
    return this.database.forTenant(access.tenantId, async (tx) => {
      await this.byId(tx, access.tenantId, id);
      const [run] = await tx
        .select()
        .from(erpRuns)
        .where(
          and(
            eq(erpRuns.tenantId, access.tenantId),
            eq(erpRuns.connectionId, id),
            eq(erpRuns.id, runId),
          ),
        );
      const key =
        run && runResult(run).download
          ? await this.media.objectKey(tx, access.tenantId, run.fileMediaId!)
          : null;
      if (!run || !key) throw notFound();
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'erp.file_downloaded',
        target: { type: 'erp_run', id: runId },
        after: { connectionId: id, fileName: run.fileName },
      });
      return this.urls.read(key);
    });
  }

  /**
   * Removes the Tally files uploaded before the cutoff (the tenant's `importFileRetentionDays`,
   * BR-41), or the orders files made before it (7 days); each run's record stays. Returns how many
   * files went.
   */
  async expireFiles(
    tx: TenantTx,
    tenantId: string,
    before: Date,
    kind: 'upload' | 'push' = 'upload',
  ): Promise<number> {
    const old = await tx
      .select({ fileMediaId: erpRuns.fileMediaId })
      .from(erpRuns)
      .where(
        and(
          eq(erpRuns.tenantId, tenantId),
          eq(erpRuns.kind, kind),
          isNotNull(erpRuns.fileMediaId),
          lt(erpRuns.startedAt, before),
        ),
      );
    let removed = 0;
    for (const { fileMediaId } of old) {
      if (await this.media.objectKey(tx, tenantId, fileMediaId!)) {
        await this.media.expire(tx, tenantId, fileMediaId!);
        removed += 1;
      }
    }
    return removed;
  }

  /** Where to send the browser to agree; the state comes back with the person and the tenant. */
  async start(access: Access, region: ZohoRegion): Promise<{ authorizeUrl: string }> {
    const state = randomBytes(24).toString('base64url');
    const authorizeUrl = this.zoho.authorizeUrl(region, state);
    await this.redis.redis.set(
      stateKey(state),
      JSON.stringify({ tenantId: access.tenantId, userId: access.userId }),
      'EX',
      STATE_SECONDS,
    );
    return { authorizeUrl };
  }

  /**
   * Spends what Zoho sent the browser back with: the state once, the accounts server checked
   * against Zoho's list, the code for the tokens. With one organisation it is chosen; with
   * several the admin picks. Connecting again keeps the mappings and, if still reachable, the
   * organisation.
   */
  async complete(
    access: Access,
    input: { code: string; state: string; accountsServer: string },
  ): Promise<ErpConnectionResult> {
    const held = await this.redis.redis.getdel(stateKey(input.state));
    const owner = held ? (JSON.parse(held) as { tenantId: string; userId: string }) : null;
    if (!owner || owner.tenantId !== access.tenantId || owner.userId !== access.userId) {
      throw invalid([{ path: 'state', issue: 'Start connecting again; this link has expired' }]);
    }
    const tokens = await this.zoho.exchange(input.accountsServer, input.code);
    const organizations = await this.zoho.organizations(tokens.apiDomain, tokens.accessToken);
    return this.database.forTenant(access.tenantId, async (tx) => {
      const before = await this.row(tx, access.tenantId, 'zoho_books', true);
      const id = before?.id ?? newId();
      const kept = before?.organizationId
        ? organizations.find((org) => org.id === before.organizationId)
        : undefined;
      const chosen = kept ?? (organizations.length === 1 ? organizations[0] : undefined);
      const now = new Date();
      const values = {
        status: chosen ? 'connected' : 'choosing',
        accountsServer: input.accountsServer
          .trim()
          .replace(/(:443)?\/?$/, '')
          .toLowerCase(),
        apiDomain: tokens.apiDomain,
        organizationId: chosen?.id ?? null,
        organizationName: chosen?.name ?? null,
        organizations,
        refreshTokenSealed: this.cipher.seal(tokens.refreshToken, sealedAt(id)),
        connectedBy: access.userId,
        connectedAt: now,
        updatedAt: now,
        updatedBy: access.userId,
      };
      const [row] = before
        ? await tx
            .update(erpConnections)
            .set(values)
            .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
            .returning()
        : await tx
            .insert(erpConnections)
            .values({
              tenantId: access.tenantId,
              id,
              provider: 'zoho_books',
              settings: ErpSettings.parse({}),
              createdBy: access.userId,
              ...values,
            })
            .returning();
      this.zoho.forget(id);
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'erp.connected',
        target: { type: 'erp_connection', id },
        before: before ? { status: before.status, organizationId: before.organizationId } : null,
        after: {
          provider: 'zoho_books',
          region: zohoRegionOf(values.accountsServer),
          status: values.status,
          organizationId: values.organizationId,
        },
      });
      return this.result(tx, row!);
    });
  }

  /** The organisation, from those the agreement reaches. */
  async chooseOrganization(
    access: Access,
    id: string,
    organizationId: string,
  ): Promise<ErpConnectionResult> {
    return this.database.forTenant(access.tenantId, async (tx) => {
      const row = await this.byId(tx, access.tenantId, id, true);
      const org = row.organizations.find((entry) => entry.id === organizationId);
      if (!org || !row.refreshTokenSealed) {
        throw invalid([
          { path: 'organizationId', issue: 'Choose one of the organisations listed' },
        ]);
      }
      const [updated] = await tx
        .update(erpConnections)
        .set({
          status: 'connected',
          organizationId: org.id,
          organizationName: org.name,
          updatedAt: new Date(),
          updatedBy: access.userId,
        })
        .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
        .returning();
      if (row.organizationId !== org.id) await this.forgetSeen(tx, access.tenantId, id);
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'erp.settings_changed',
        target: { type: 'erp_connection', id },
        before: { organizationId: row.organizationId },
        after: { organizationId: org.id },
      });
      return this.result(tx, updated!);
    });
  }

  /** The mappings, each reference checked against the tenant's own records. */
  async updateSettings(access: Access, id: string, input: unknown): Promise<ErpConnectionResult> {
    const settings = ErpSettings.parse(input);
    return this.database.forTenant(access.tenantId, async (tx) => {
      const row = await this.byId(tx, access.tenantId, id, true);
      await this.checkSettings(tx, access.tenantId, settings);
      const [updated] = await tx
        .update(erpConnections)
        .set({ settings, updatedAt: new Date(), updatedBy: access.userId })
        .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
        .returning();
      // Records left out under the old mappings are looked at again under the new ones.
      await this.forgetSeen(tx, access.tenantId, id);
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'erp.settings_changed',
        target: { type: 'erp_connection', id },
        before: row.settings,
        after: settings,
      });
      return this.result(tx, updated!);
    });
  }

  /** Revokes the agreement at Zoho and forgets the token; the links stay for a reconnection. */
  async disconnect(access: Access, id: string): Promise<ErpConnectionResult> {
    const { result, revoke } = await this.database.forTenant(access.tenantId, async (tx) => {
      const row = await this.byId(tx, access.tenantId, id, true);
      const token = row.refreshTokenSealed
        ? this.cipher.open(row.refreshTokenSealed, sealedAt(id))
        : null;
      const [updated] = await tx
        .update(erpConnections)
        .set({
          status: 'disconnected',
          refreshTokenSealed: null,
          credentialsSealed: null,
          organizations: [],
          updatedAt: new Date(),
          updatedBy: access.userId,
        })
        .where(and(eq(erpConnections.tenantId, access.tenantId), eq(erpConnections.id, id)))
        .returning();
      if (row.status !== 'disconnected') {
        await this.audit.record(tx, access.tenantId, userActor(access), {
          action: 'erp.disconnected',
          target: { type: 'erp_connection', id },
          before: { status: row.status },
          after: { status: 'disconnected' },
        });
      }
      return {
        result: await this.result(tx, updated!),
        revoke: token && row.accountsServer ? { server: row.accountsServer, token } : null,
      };
    });
    this.zoho.forget(id);
    if (revoke) await this.zoho.revoke(revoke.server, revoke.token);
    return result;
  }

  async runs(tx: TenantTx, tenantId: string, id: string): Promise<{ items: ErpRunResult[] }> {
    await this.byId(tx, tenantId, id);
    const rows = await tx
      .select()
      .from(erpRuns)
      .where(and(eq(erpRuns.tenantId, tenantId), eq(erpRuns.connectionId, id)))
      .orderBy(desc(erpRuns.startedAt))
      .limit(20);
    return { items: rows.map(runResult) };
  }

  /** Sync now: one run at a time, so asking again while one runs answers that one. */
  async requestRun(access: Access, id: string): Promise<ErpRunResult> {
    const run = await this.database.forTenant(access.tenantId, async (tx) => {
      const row = await this.byId(tx, access.tenantId, id, true);
      if (row.status !== 'connected') {
        throw new AppError('CONFLICT', 'Connect the ERP and choose its organisation first.');
      }
      // Tally is never reached: its records come only in the files uploaded.
      if (row.provider === 'tally') {
        throw new AppError('CONFLICT', 'Upload a file exported from Tally instead.');
      }
      const running = await this.running(tx, access.tenantId, id);
      if (running) return { row: running, fresh: false };
      const [created] = await tx
        .insert(erpRuns)
        .values({
          tenantId: access.tenantId,
          id: newId(),
          connectionId: id,
          kind: 'pull',
          status: 'running',
        })
        .returning();
      return { row: created!, fresh: true };
    });
    if (run.fresh) {
      await this.queues.add(
        'connectors',
        PULL,
        { tenantId: access.tenantId, connectionId: id, runId: run.row.id },
        { jobId: `erp-pull-${run.row.id}` },
      );
    }
    return runResult(run.row);
  }

  /** The run under way, if any; one cut short long ago is closed as failed. */
  async running(tx: TenantTx, tenantId: string, id: string): Promise<RunRow | null> {
    const [row] = await tx
      .select()
      .from(erpRuns)
      .where(
        and(
          eq(erpRuns.tenantId, tenantId),
          eq(erpRuns.connectionId, id),
          eq(erpRuns.status, 'running'),
        ),
      )
      .orderBy(desc(erpRuns.startedAt))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.startedAt.getTime() < STALE_RUN_MS) return row;
    await tx
      .update(erpRuns)
      .set({ status: 'failed', stoppedBy: 'error', finishedAt: new Date() })
      .where(and(eq(erpRuns.tenantId, tenantId), eq(erpRuns.id, row.id)));
    return null;
  }

  /** Runs older than the keeping time go (decision D129: 90 days). */
  async removeRunsBefore(tx: TenantTx, tenantId: string, cutoff: Date): Promise<number> {
    const removed = await tx
      .delete(erpRuns)
      .where(and(eq(erpRuns.tenantId, tenantId), lt(erpRuns.startedAt, cutoff)))
      .returning({ id: erpRuns.id });
    return removed.length;
  }

  /**
   * Seals every connection's refresh token again under the current column key, after a rotation
   * (`pnpm reseal`, decision D101).
   */
  async resealSecrets(tenantId: string): Promise<number> {
    return this.database.forTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: erpConnections.id,
          token: erpConnections.refreshTokenSealed,
          credentials: erpConnections.credentialsSealed,
        })
        .from(erpConnections)
        .where(eq(erpConnections.tenantId, tenantId));
      let resealed = 0;
      for (const row of rows) {
        const token = row.token && !this.cipher.isCurrent(row.token);
        const credentials = row.credentials && !this.cipher.isCurrent(row.credentials);
        if (!token && !credentials) continue;
        await tx
          .update(erpConnections)
          .set({
            ...(token
              ? { refreshTokenSealed: this.cipher.reseal(row.token!, sealedAt(row.id)) }
              : {}),
            ...(credentials
              ? { credentialsSealed: this.cipher.reseal(row.credentials!, credentialsAt(row.id)) }
              : {}),
          })
          .where(and(eq(erpConnections.tenantId, tenantId), eq(erpConnections.id, row.id)));
        resealed += (token ? 1 : 0) + (credentials ? 1 : 0);
      }
      return resealed;
    });
  }

  async row(
    tx: TenantTx,
    tenantId: string,
    provider: ErpProvider = 'zoho_books',
    lock = false,
  ): Promise<ConnectionRow | undefined> {
    const query = tx
      .select()
      .from(erpConnections)
      .where(and(eq(erpConnections.tenantId, tenantId), eq(erpConnections.provider, provider)));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  /** Every connection of a tenant, whichever its provider. */
  async all(tx: TenantTx, tenantId: string): Promise<ConnectionRow[]> {
    return tx.select().from(erpConnections).where(eq(erpConnections.tenantId, tenantId));
  }

  async byId(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<ConnectionRow> {
    const query = tx
      .select()
      .from(erpConnections)
      .where(and(eq(erpConnections.tenantId, tenantId), eq(erpConnections.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  private async checkSettings(tx: TenantTx, tenantId: string, settings: ErpSettings) {
    const details: ErrorDetail[] = [];
    if (
      settings.accountType &&
      !(await this.accountTypes.byKey(tx, tenantId, settings.accountType))
    ) {
      details.push({ path: 'accountType', issue: 'Choose one of your account types' });
    }
    const groups = Object.entries(settings.groupTerritories);
    if (settings.defaultTerritory || groups.length > 0) {
      const codes = new Set(
        (await this.territories.list(tx, tenantId, { active: true })).map((t) => t.code),
      );
      if (settings.defaultTerritory && !codes.has(settings.defaultTerritory)) {
        details.push({ path: 'defaultTerritory', issue: 'Choose one of your active territories' });
      }
      for (const [group, code] of groups) {
        if (!codes.has(code)) {
          details.push({
            path: `groupTerritories.${group}`,
            issue: 'Choose one of your active territories',
          });
        }
      }
    }
    const lists = new Set((await this.priceLists.refs(tx, tenantId)).map((list) => list.id));
    if (settings.itemPriceList && !lists.has(settings.itemPriceList)) {
      details.push({ path: 'itemPriceList', issue: 'Choose one of your price lists' });
    }
    settings.priceBooks.forEach((book, index) => {
      if (!lists.has(book.priceList)) {
        details.push({
          path: `priceBooks.${index}.priceList`,
          issue: 'Choose one of your price lists',
        });
      }
    });
    const units = new Set(
      (await this.catalogue.settings(tx, tenantId)).units.map((unit) => unit.key),
    );
    for (const [name, key] of Object.entries(settings.units)) {
      if (!units.has(key))
        details.push({ path: `units.${name}`, issue: 'Choose one of your units' });
    }
    if (details.length > 0) throw invalid(details);
  }

  /** Records seen but not taken are read again on the next run. */
  private async forgetSeen(tx: TenantTx, tenantId: string, id: string) {
    await tx
      .update(erpLinks)
      .set({ externalModified: null, fingerprint: null })
      .where(and(eq(erpLinks.tenantId, tenantId), eq(erpLinks.connectionId, id)));
  }

  async result(tx: TenantTx, row: ConnectionRow): Promise<ErpConnectionResult> {
    const by = row.connectedBy
      ? (await this.people.facts(tx, row.tenantId, [row.connectedBy])).get(row.connectedBy)
      : undefined;
    return {
      id: row.id,
      provider: row.provider as ErpConnectionResult['provider'],
      status: row.status as ErpConnectionResult['status'],
      region: row.accountsServer ? zohoRegionOf(row.accountsServer) : null,
      endpoint: row.endpoint,
      companyDb: row.companyDb,
      username: row.username,
      organization: row.organizationId
        ? { id: row.organizationId, name: row.organizationName ?? row.organizationId }
        : null,
      organizations: row.status === 'choosing' ? row.organizations : [],
      settings: ErpSettings.parse(row.settings),
      connectedAt: row.connectedAt?.toISOString() ?? null,
      connectedBy: by && row.connectedBy ? { id: row.connectedBy, name: by.name } : null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      ordersWaiting:
        row.provider === 'tally' && row.status === 'connected'
          ? await this.ordersWaiting(tx, row)
          : null,
    };
  }

  /** Accepted orders since Tally was connected that no orders file has carried. */
  private async ordersWaiting(tx: TenantTx, row: ConnectionRow): Promise<number> {
    const sent = await tx
      .select({ localKey: erpLinks.localKey })
      .from(erpLinks)
      .where(
        and(
          eq(erpLinks.tenantId, row.tenantId),
          eq(erpLinks.connectionId, row.id),
          eq(erpLinks.entity, 'order'),
        ),
      );
    const carried = new Set(sent.map((link) => link.localKey));
    const accepted = await this.orders.acceptedSince(
      tx,
      row.tenantId,
      row.createdAt,
      WAITING_COUNTED,
    );
    return accepted.filter((id) => !carried.has(id)).length;
  }
}

export function runResult(row: RunRow): ErpRunResult {
  return {
    id: row.id,
    kind: row.kind as ErpRunResult['kind'],
    status: row.status as ErpRunResult['status'],
    stoppedBy: (row.stoppedBy as ErpRunResult['stoppedBy']) ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    counts: row.counts,
    problems: row.problems as ErpProblem[],
    calls: row.calls,
    file: row.fileName,
    download:
      row.kind === 'push' &&
      row.fileMediaId !== null &&
      Date.now() - row.startedAt.getTime() < ORDERS_FILE_KEEP_MS,
  };
}
