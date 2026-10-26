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
 * Tables left out of an export (decision D95): plumbing that holds nothing of the tenant's own,
 * and stored answers to repeated requests, which can carry a secret shown once.
 */
export const ARCHIVE_SKIPPED_TABLES = ['idempotency_keys', 'outbox_events', 'sync_tombstones'];

/**
 * Tables left out of a move: tombstones only, as a moved tenant's phones take a full copy. Stored
 * answers move, so a phone's upload sent again lands once; so do events not yet delivered.
 */
export const MOVE_SKIPPED_TABLES = ['sync_tombstones'];

/** Columns left out of an export, but not a move: secrets, and what stands in for them. */
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

export interface Reference {
  child: string;
  parent: string;
  columns: string[];
}

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
   * the archive holds exactly what it sees. A `move` also carries secrets, stored answers, events
   * not yet delivered and photos' derived copies, for the cell the tenant moves to.
   */
  async write(
    tx: TenantTx,
    tenantId: string,
    path: string,
    purpose: ArchiveManifest['purpose'] = 'export',
    subject?: string,
  ): Promise<ArchiveFacts> {
    const move = purpose === 'move';
    if ((purpose === 'personal') !== (subject !== undefined)) {
      throw new Error('A personal archive names its person, and only it does.');
    }
    const filters = subject ? await this.personFilters(tx, subject) : null;
    const out = createWriteStream(path);
    const archive = new ArchiveFile(out);
    const tables: ArchiveManifest['tables'] = [];
    for (const name of await this.tableNames(tx, move ? MOVE_SKIPPED_TABLES : undefined)) {
      const filter = filters ? filters.get(name) : null;
      // A personal archive holds only tables with rows that point at the person.
      if (filter === undefined) continue;
      tables.push(await this.writeTable(tx, archive, tenantId, name, move, filter));
    }
    const files: ArchiveManifest['media'] = [];
    for (const file of await this.media.forArchive(tx, tenantId, subject)) {
      const variants = [null, ...(move ? Object.keys(file.derivatives) : [])];
      for (const variant of variants) {
        const bytes = await this.media.variantBytes(tx, tenantId, file.id, variant);
        const entryPath = variant ? `media/${file.id}.${variant}` : `media/${file.id}`;
        await archive.add(entryPath, bytes, false);
        files.push({
          id: file.id,
          variant,
          path: entryPath,
          kind: file.kind,
          contentType: file.contentType,
          fileName: file.fileName,
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      purpose,
      ...(subject ? { subject } : {}),
      product: this.config.PRODUCT_NAME,
      tenant: { id: tenantId, name: (await this.directory.displayName(tenantId)) ?? '' },
      cell: this.config.CELL_ID,
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      keyId: this.signer.keyId,
      tables,
      media: files,
      omitted: {
        tables: [...(move ? MOVE_SKIPPED_TABLES : ARCHIVE_SKIPPED_TABLES)],
        columns: move
          ? []
          : Object.entries(ARCHIVE_SECRET_COLUMNS).flatMap(([table, columns]) =>
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
  async tableNames(
    tx: TenantTx,
    skipped: readonly string[] = ARCHIVE_SKIPPED_TABLES,
  ): Promise<string[]> {
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
      .filter((name) => !skipped.includes(name));
  }

  /** The references between the cell's tables, from the catalogue. */
  async references(tx: TenantTx): Promise<Reference[]> {
    const result = await tx.execute(sql`
      select child.relname as child, parent.relname as parent,
             array(
               select a.attname::text from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
             ) as columns
        from pg_constraint c
        join pg_class child on child.oid = c.conrelid
        join pg_class parent on parent.oid = c.confrelid
        join pg_namespace n on n.oid = child.relnamespace
       where c.contype = 'f' and n.nspname = 'cell' and c.conparentid = 0`);
    return result.rows as unknown as Reference[];
  }

  /**
   * For a personal archive (decision D95): each table's rows that point at the person, by every
   * column that refers to them, their own row in `users`, and the audit entries they made or that
   * are about them. Tables that never point at a person are left out.
   */
  private async personFilters(tx: TenantTx, userId: string): Promise<Map<string, string>> {
    // A checked UUID: the request that names the person came through the API's own schema.
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error('Not a person’s ID.');
    const id = `'${userId}'`;
    const filters = new Map<string, string[]>();
    for (const reference of await this.references(tx)) {
      if (reference.parent !== 'users') continue;
      const columns = reference.columns.filter((column) => column !== 'tenant_id');
      const list = filters.get(reference.child) ?? [];
      list.push(...columns.map((column) => `t.${quote(column)} = ${id}`));
      filters.set(reference.child, list);
    }
    filters.set('users', [`t.id = ${id}`, ...(filters.get('users') ?? [])]);
    filters.set('audit_log', [
      `t.actor_id = ${id}`,
      `(t.target_type = 'user' and t.target_id = ${id})`,
    ]);
    return new Map([...filters].map(([table, list]) => [table, list.join(' or ')]));
  }

  private async writeTable(
    tx: TenantTx,
    archive: ArchiveFile,
    tenantId: string,
    name: string,
    move: boolean,
    filter: string | null = null,
  ): Promise<ArchiveManifest['tables'][number]> {
    const path = `tables/${name}.jsonl`;
    const entry = archive.open(path);
    const secrets = move ? [] : (ARCHIVE_SECRET_COLUMNS[name] ?? []);
    // Rows go out as Postgres writes them, so numbers keep every digit; secrets are taken out.
    const row = secrets.length
      ? `(to_jsonb(t) - array[${secrets.map((column) => `'${column}'`).join(', ')}]::text[])::text`
      : 'to_jsonb(t)::text';
    // The tenant ID is a checked UUID (`forTenant` refuses anything else); RLS holds it too.
    // DECLARE CURSOR takes no parameters, and the names are quoted, so this text is built.
    await tx.execute(
      // nosemgrep: tools.semgrep.thelamp-sql-raw-interpolated
      sql.raw(
        `declare archive_rows no scroll cursor for select ${row} as line from cell.${quote(name)} t where t.tenant_id = '${tenantId}'${filter ? ` and (${filter})` : ''}`,
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
