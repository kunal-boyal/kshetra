import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ApiClientResult,
  type ApiScopeKey,
  apiClientId,
  AppError,
  type CreateApiClientBody,
  tenantOfClientId,
} from '@thelamp/shared';
import { and, asc, eq } from 'drizzle-orm';
import { apiClients } from '../../db/schema/iam';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { type ApiClientCheck, ApiClientCredentials } from '../../platform/planes';
import { notFound } from './actor';

type Row = typeof apiClients.$inferSelect;

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
/** URL-safe random text, `bytes` long before encoding. */
const random = (bytes: number) => randomBytes(bytes).toString('base64url');

/** An API client as IAM checks it on a request. */
export interface ApiClientState {
  id: string;
  name: string;
  scopes: ApiScopeKey[];
  authRevision: number;
}

/**
 * A tenant's API clients (module M20, decision D94): tenant admins make them with scopes, see
 * them, rotate their secrets and revoke them; the directory's token endpoint checks their
 * credentials through `ApiClientCredentials`. A secret is shown once and kept only as a hash.
 */
@Injectable()
export class ApiClientsService extends ApiClientCredentials {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {
    super();
  }

  list(tx: TenantTx, tenantId: string): Promise<ApiClientResult[]> {
    return tx
      .select()
      .from(apiClients)
      .where(eq(apiClients.tenantId, tenantId))
      .orderBy(asc(apiClients.name))
      .then((rows) => rows.map(result));
  }

  /** Makes a client under the portal's own ID; its secret comes back now and never again. */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateApiClientBody,
  ): Promise<{ client: ApiClientResult; clientSecret: string }> {
    refuseClients(access);
    const [existing] = await tx
      .select({ id: apiClients.id })
      .from(apiClients)
      .where(and(eq(apiClients.tenantId, access.tenantId), eq(apiClients.id, body.id)));
    // A resend can't show the secret again: it was never kept.
    if (existing) {
      throw new AppError(
        'CONFLICT',
        'This client exists already. Rotate its secret to get a new one.',
      );
    }
    const clientSecret = random(32);
    const [row] = await tx
      .insert(apiClients)
      .values({
        id: body.id,
        tenantId: access.tenantId,
        name: body.name,
        clientId: apiClientId(access.tenantId, random(15)),
        secretHash: hash(clientSecret),
        scopes: body.scopes,
        createdBy: access.userId,
        updatedBy: access.userId,
      })
      .returning();
    const client = result(row!);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'api_client.created',
      target: { type: 'api_client', id: client.id },
      after: { name: client.name, scopes: client.scopes, clientId: client.clientId },
    });
    return { client, clientSecret };
  }

  /** A new secret, shown now; the old one, and tokens issued with it, stop working. */
  async rotate(
    tx: TenantTx,
    access: Access,
    id: string,
  ): Promise<{ client: ApiClientResult; clientSecret: string }> {
    refuseClients(access);
    const current = await this.locked(tx, access.tenantId, id);
    if (current.status !== 'active') {
      throw new AppError('CONFLICT', 'This client is revoked; make a new one.');
    }
    const clientSecret = random(32);
    const [row] = await tx
      .update(apiClients)
      .set({
        secretHash: hash(clientSecret),
        authRevision: current.authRevision + 1,
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(apiClients.tenantId, access.tenantId), eq(apiClients.id, id)))
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'api_client.secret_rotated',
      target: { type: 'api_client', id },
    });
    return { client: result(row!), clientSecret };
  }

  /** Revokes a client for good: its tokens stop working at once. */
  async revoke(tx: TenantTx, access: Access, id: string): Promise<ApiClientResult> {
    refuseClients(access);
    const current = await this.locked(tx, access.tenantId, id);
    if (current.status !== 'active') return result(current);
    const [row] = await tx
      .update(apiClients)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        authRevision: current.authRevision + 1,
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(apiClients.tenantId, access.tenantId), eq(apiClients.id, id)))
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'api_client.revoked',
      target: { type: 'api_client', id },
      before: { status: 'active' },
      after: { status: 'revoked' },
    });
    return result(row!);
  }

  /**
   * The token endpoint's question: do these credentials belong to an active client? The client ID
   * names the tenant, so only that tenant's clients are read. A match marks the client used.
   */
  async check(clientId: string, clientSecret: string): Promise<ApiClientCheck | null> {
    const tenantId = tenantOfClientId(clientId);
    if (!tenantId) return null;
    return this.database.forTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(apiClients)
        .where(and(eq(apiClients.tenantId, tenantId), eq(apiClients.clientId, clientId)));
      if (!row || row.status !== 'active') return null;
      const given = Buffer.from(hash(clientSecret), 'hex');
      const kept = Buffer.from(row.secretHash, 'hex');
      if (given.length !== kept.length || !timingSafeEqual(given, kept)) return null;
      await tx
        .update(apiClients)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(apiClients.tenantId, tenantId), eq(apiClients.id, row.id)));
      return {
        tenantId,
        apiClientId: row.id,
        scopes: row.scopes as ApiScopeKey[],
        authRevision: row.authRevision,
      };
    });
  }

  /** An active client, as IAM checks it on each of its requests. */
  async state(tx: TenantTx, tenantId: string, id: string): Promise<ApiClientState | null> {
    const [row] = await tx
      .select()
      .from(apiClients)
      .where(and(eq(apiClients.tenantId, tenantId), eq(apiClients.id, id)));
    if (!row || row.status !== 'active') return null;
    return {
      id: row.id,
      name: row.name,
      scopes: row.scopes as ApiScopeKey[],
      authRevision: row.authRevision,
    };
  }

  private async locked(tx: TenantTx, tenantId: string, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(apiClients)
      .where(and(eq(apiClients.tenantId, tenantId), eq(apiClients.id, id)))
      .for('update');
    if (!row) throw notFound();
    return row;
  }
}

/** A client never makes or changes clients, whatever its scopes. */
function refuseClients(access: Access): void {
  if (access.apiClient) {
    throw new AppError('FORBIDDEN', 'API clients can’t manage API clients.');
  }
}

function result(row: Row): ApiClientResult {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    scopes: row.scopes as ApiScopeKey[],
    status: row.status === 'revoked' ? 'revoked' : 'active',
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
