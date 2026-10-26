import { createHash } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { Inject, Injectable } from '@nestjs/common';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST,
  ARCHIVE_SIGNATURE,
  ARCHIVE_VERSION,
  type ArchiveManifest,
} from '@thelamp/shared';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { sql } from 'drizzle-orm';
import journal from '../../../drizzle/meta/_journal.json';
import type { Config } from '../../config';
import { ArchiveSigner } from '../../platform/archive-signer';
import type { TenantTx } from '../../platform/database';
import { TenantDirectory } from '../../platform/planes';
import { CONFIG } from '../../platform/tokens';
import { MediaService } from '../media/media.service';

/**
 * Tables left out of an archive (decision D95): plumbing that holds nothing of the tenant's own,
 * and stored answers to repeated requests, which can carry a secret shown once.
 */
export const ARCHIVE_SKIPPED_TABLES = ['idempotency_keys', 'outbox_events', 'sync_tombstones'];

/** Columns left out of an archive: secrets, and what stands in for them. */
export const ARCHIVE_SECRET_COLUMNS: Record<string, readonly string[]> = {
  api_clients: ['secret_hash'],
  devices: ['device_key_hash', 'push_token'],
  push_tokens: ['token'],
  webhook_subscriptions: ['secret_sealed'],
};

/** Rows read from the database at a time. */
const BATCH = 2000;

/** The last migration in this build, which an archive's rows follow. */
const SCHEMA = journal.entries[journal.entries.length - 1]!.tag;

/** An identifier from the catalogue, quoted for SQL. */
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface ArchiveFacts {
  bytes: number;
  sha256: string;
  tables: number;
  rows: number;
  files: number;
  keyId: string;
}

/**
 * Writes a tenant's signed archive to a file (module M21, decision D95): every `cell` table with a
 * `tenant_id` as JSON lines, read in one snapshot, then every stored file, then the manifest of
 * them all and its Ed25519 signature. New tables join without a change here; anything left out is
 * named in the manifest. The archive streams to disk, so its size is the disk's to bear.
 */
@Injectable()
export class TenantArchive {
  constructor(
    private readonly signer: ArchiveSigner,
    private readonly media: MediaService,
    private readonly directory: TenantDirectory,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * `tx` must read one snapshot (repeatable read) in the tenant, as `Database.forTenant` opens it;
   * the archive holds exactly what it sees.
   */
  async write(tx: TenantTx, tenantId: string, path: string): Promise<ArchiveFacts> {
    const out = createWriteStream(path);
    const archive = new ArchiveFile(out);
    const tables: ArchiveManifest['tables'] = [];
    for (const name of await this.tableNames(tx)) {
      tables.push(await this.writeTable(tx, archive, tenantId, name));
    }
    const files: ArchiveManifest['media'] = [];
    for (const file of await this.media.forArchive(tx, tenantId)) {
      const { bytes } = await this.media.read(tx, tenantId, file.id);
      const entryPath = `media/${file.id}`;
      await archive.add(entryPath, bytes, false);
      files.push({
        id: file.id,
        path: entryPath,
        kind: file.kind,
        contentType: file.contentType,
        fileName: file.fileName,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      product: this.config.PRODUCT_NAME,
      tenant: { id: tenantId, name: (await this.directory.displayName(tenantId)) ?? '' },
      cell: this.config.CELL_ID,
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      keyId: this.signer.keyId,
      tables,
      media: files,
      omitted: {
        tables: [...ARCHIVE_SKIPPED_TABLES],
        columns: Object.entries(ARCHIVE_SECRET_COLUMNS).flatMap(([table, columns]) =>
          columns.map((column) => `${table}.${column}`),
        ),
      },
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await archive.add(ARCHIVE_MANIFEST, manifestBytes, true);
    await archive.add(ARCHIVE_SIGNATURE, Buffer.from(this.signer.sign(manifestBytes)), false);
    const { bytes, sha256 } = await archive.end();
    return {
      bytes,
      sha256,
      tables: tables.length,
      rows: tables.reduce((sum, table) => sum + table.rows, 0),
      files: files.length,
      keyId: this.signer.keyId,
    };
  }

  /** The tenant's tables: partitioned ones once, through their parent; plumbing left out. */
  async tableNames(tx: TenantTx): Promise<string[]> {
    const result = await tx.execute(sql`
      select c.relname as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'cell'
         and c.relkind in ('r', 'p')
         and not c.relispartition
         and exists (
           select 1 from pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
         )
       order by c.relname`);
    return (result.rows as { name: string }[])
      .map((row) => row.name)
      .filter((name) => !ARCHIVE_SKIPPED_TABLES.includes(name));
  }

  private async writeTable(
    tx: TenantTx,
    archive: ArchiveFile,
    tenantId: string,
    name: string,
  ): Promise<ArchiveManifest['tables'][number]> {
    const path = `tables/${name}.jsonl`;
    const entry = archive.open(path);
    const secrets = ARCHIVE_SECRET_COLUMNS[name] ?? [];
    // Rows go out as Postgres writes them, so numbers keep every digit; secrets are taken out.
    const row = secrets.length
      ? `(to_jsonb(t) - array[${secrets.map((column) => `'${column}'`).join(', ')}]::text[])::text`
      : 'to_jsonb(t)::text';
    // The tenant ID is a checked UUID (`forTenant` refuses anything else); RLS holds it too.
    await tx.execute(
      sql.raw(
        `declare archive_rows no scroll cursor for select ${row} as line from cell.${quote(name)} t where t.tenant_id = '${tenantId}'`,
      ),
    );
    let rows = 0;
    for (;;) {
      const batch = await tx.execute(sql.raw(`fetch ${BATCH} from archive_rows`));
      const lines = batch.rows as { line: string }[];
      if (lines.length === 0) break;
      await entry.write(Buffer.from(lines.map((item) => `${item.line}\n`).join('')));
      rows += lines.length;
    }
    await tx.execute(sql.raw('close archive_rows'));
    const { bytes, sha256 } = await entry.close();
    return { name, path, rows, bytes, sha256 };
  }
}

/** A ZIP written as it goes, waiting for the disk when it falls behind. */
class ArchiveFile {
  private readonly zip: Zip;
  private readonly whole = createHash('sha256');
  private size = 0;
  private failure: Error | null = null;
  private readonly finished: Promise<void>;

  constructor(private readonly out: WriteStream) {
    this.finished = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        this.failure = error;
        return;
      }
      this.whole.update(chunk);
      this.size += chunk.byteLength;
      out.write(chunk);
      if (final) out.end();
    });
  }

  private async drained() {
    if (this.failure) throw this.failure;
    if (this.out.writableNeedDrain) await once(this.out, 'drain');
  }

  /** An entry written in parts, with its uncompressed size and SHA-256. */
  open(path: string) {
    const entry = new ZipDeflate(path, { level: 6 });
    this.zip.add(entry);
    const hash = createHash('sha256');
    let bytes = 0;
    return {
      write: async (chunk: Uint8Array) => {
        hash.update(chunk);
        bytes += chunk.byteLength;
        entry.push(chunk);
        await this.drained();
      },
      close: async () => {
        entry.push(new Uint8Array(0), true);
        await this.drained();
        return { bytes, sha256: hash.digest('hex') };
      },
    };
  }

  /** A whole entry; files that are compressed already, such as photos, are stored as they are. */
  async add(path: string, bytes: Uint8Array, compress: boolean) {
    const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    this.zip.add(entry);
    entry.push(bytes, true);
    await this.drained();
  }

  /** Finishes the ZIP; its size and SHA-256 once on disk. */
  async end(): Promise<{ bytes: number; sha256: string }> {
    this.zip.end();
    await this.finished;
    if (this.failure) throw this.failure;
    return { bytes: this.size, sha256: this.whole.digest('hex') };
  }
}
