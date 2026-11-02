import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ErpConnectionResult,
  type ErpProblem,
  type ErpRunResult,
  ErpSettings,
  type ErrorDetail,
  newId,
  type ZohoRegion,
  zohoRegionOf,
} from '@thelamp/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { erpConnections, erpLinks, erpRuns } from '../../db/schema/erp';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { RedisClient } from '../../platform/redis';
import { AccountTypesService } from '../accounts/account-types.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { People } from '../iam/people';
import { TerritoriesService } from '../territories/territories.service';
import { ZohoBooks } from './zoho-books';

export type ConnectionRow = typeof erpConnections.$inferSelect;
type RunRow = typeof erpRuns.$inferSelect;

/** The job that reads the books into the tenant's records. */
export const PULL = 'erp.pull';
/** The job that sends accepted orders to the books. */
export const PUSH = 'erp.push';
/** A connection's state is good for ten minutes, the time to agree at Zoho. */
const STATE_SECONDS = 600;
/** A run still marked running after this long was cut short (a worker stopped). */
const STALE_RUN_MS = 2 * 60 * 60_000;

/** Where the refresh token is sealed: its column and row, so it can't be moved to another. */
export const sealedAt = (id: string) => `erp_connections.refresh_token_sealed:${id}`;
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
    private readonly queues: Queues,
    private readonly people: People,
    private readonly accountTypes: AccountTypesService,
    private readonly territories: TerritoriesService,
    private readonly catalogue: CatalogueService,
    private readonly priceLists: PriceListsService,
  ) {}

  async providers(tx: TenantTx, tenantId: string) {
    const row = await this.row(tx, tenantId);
    return {
      providers: [
        {
          provider: 'zoho_books' as const,
          configured: this.zoho.configured(),
          connection: row ? await this.result(tx, row) : null,
        },
      ],
    };
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
      const before = await this.row(tx, access.tenantId, true);
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
        .select({ id: erpConnections.id, sealed: erpConnections.refreshTokenSealed })
        .from(erpConnections)
        .where(eq(erpConnections.tenantId, tenantId));
      let resealed = 0;
      for (const row of rows) {
        if (!row.sealed || this.cipher.isCurrent(row.sealed)) continue;
        await tx
          .update(erpConnections)
          .set({ refreshTokenSealed: this.cipher.reseal(row.sealed, sealedAt(row.id)) })
          .where(and(eq(erpConnections.tenantId, tenantId), eq(erpConnections.id, row.id)));
        resealed += 1;
      }
      return resealed;
    });
  }

  async row(tx: TenantTx, tenantId: string, lock = false): Promise<ConnectionRow | undefined> {
    const query = tx
      .select()
      .from(erpConnections)
      .where(and(eq(erpConnections.tenantId, tenantId), eq(erpConnections.provider, 'zoho_books')));
    const [row] = lock ? await query.for('update') : await query;
    return row;
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
    if (settings.defaultTerritory) {
      const codes = new Set(
        (await this.territories.list(tx, tenantId, { active: true })).map((t) => t.code),
      );
      if (!codes.has(settings.defaultTerritory)) {
        details.push({ path: 'defaultTerritory', issue: 'Choose one of your active territories' });
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
      provider: 'zoho_books',
      status: row.status as ErpConnectionResult['status'],
      region: row.accountsServer ? zohoRegionOf(row.accountsServer) : null,
      organization: row.organizationId
        ? { id: row.organizationId, name: row.organizationName ?? row.organizationId }
        : null,
      organizations: row.status === 'choosing' ? row.organizations : [],
      settings: ErpSettings.parse(row.settings),
      connectedAt: row.connectedAt?.toISOString() ?? null,
      connectedBy: by && row.connectedBy ? { id: row.connectedBy, name: by.name } : null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
    };
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
  };
}
