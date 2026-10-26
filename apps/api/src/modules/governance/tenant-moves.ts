import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import journal from '../../../drizzle/meta/_journal.json';
import type { Config } from '../../config';
import { ArchiveInvalid, readArchive } from '../../platform/archive-signer';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { TenantDirectory } from '../../platform/planes';
import { CONFIG } from '../../platform/tokens';
import { MediaService } from '../media/media.service';
import { type ArchiveFacts, TenantArchive } from './tenant-archive';

/** The last migration in this build; a move needs both cells on the same one. */
const SCHEMA = journal.entries[journal.entries.length - 1]!.tag;

/** Rows sent to the database at a time while importing. */
const BATCH = 1000;

/** Tables partitioned by month whose past months a moved tenant may need. */
const MONTHLY = ['audit_log', 'webhook_deliveries'];

/** Capacity a cell registered by the move tooling offers (spec 9.3). */
const CELL_CAPACITY = 20_000;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface ImportReport {
  tenantId: string;
  tables: number;
  rows: number;
  files: number;
}

interface Reference {
  child: string;
  parent: string;
  columns: string[];
}

/**
 * Moving a tenant between cells (module M21, spec 9.3, decision D95), a step at a time, each run
 * by vendor staff with `pnpm tenant-move` on the cell it concerns: the directory marks the tenant
 * as moving, which freezes its writes; the source cell writes a signed move archive; the target
 * cell imports it, checks every table's count, and takes the directory entry; the source purges
 * what it held. Phones see a new cell and take a full copy.
 */
@Injectable()
export class TenantMoves {
  constructor(
    private readonly database: Database,
    private readonly archive: TenantArchive,
    private readonly directory: TenantDirectory,
    private readonly media: MediaService,
    private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** The tenant a slug names. */
  async tenantId(slug: string): Promise<string> {
    const tenant = await this.directory.bySlug(slug);
    if (!tenant) throw new AppError('NOT_FOUND', `There is no tenant ${slug}.`);
    return tenant.id;
  }

  /** On the target cell, first: puts this cell in the directory, so tenants can move to it. */
  async registerCell(): Promise<string> {
    await this.directory.ensureCell({
      name: this.config.CELL_ID,
      region: this.config.CELL_REGION,
      apiBaseUrl: this.config.CELL_API_URL ?? `http://127.0.0.1:${this.config.PORT}`,
      capacityUsers: CELL_CAPACITY,
    });
    return this.config.CELL_ID;
  }

  /** Marks the tenant as moving: from now on it reads, and its writes wait. */
  async start(tenantId: string, toCell: string): Promise<void> {
    await this.directory.startMove(tenantId, toCell);
  }

  /** Calls the move off before it is finished: the tenant writes here again. */
  async cancel(tenantId: string): Promise<void> {
    await this.directory.cancelMove(tenantId);
  }

  /**
   * On the source cell: writes the signed move archive, once the tenant is frozen and every event
   * it raised has been delivered, so nothing changes after the snapshot.
   */
  async export(tenantId: string, path: string): Promise<ArchiveFacts> {
    const standing = await this.directory.standing(tenantId);
    if (!standing || standing.cell !== this.config.CELL_ID) {
      throw new AppError('CONFLICT', 'The tenant does not live on this cell.');
    }
    if (!standing.moving) {
      throw new AppError('CONFLICT', 'Start the move first, so the tenant stops writing.');
    }
    const waiting = await this.database.forTenant(tenantId, (tx) =>
      this.outbox.waiting(tx, tenantId),
    );
    if (waiting > 0) {
      throw new AppError(
        'CONFLICT',
        `${waiting} of the tenant's events are still being delivered; try again in a minute.`,
      );
    }
    return this.database.forTenant(
      tenantId,
      (tx) => this.archive.write(tx, tenantId, path, 'move'),
      { isolation: 'repeatable read', readOnly: true },
    );
  }

  /**
   * On the target cell: imports a move archive signed by the source cell's key, in one
   * transaction. Every table goes in after the tables it refers to; references within a table are
   * filled in afterwards; row versions start afresh here; each table's count must match the
   * manifest's, or nothing is kept.
   */
  async import(archiveBytes: Uint8Array, publicKeyPem: string): Promise<ImportReport> {
    const { manifest, entries } = readArchive(archiveBytes, publicKeyPem);
    if (manifest.purpose !== 'move') {
      throw new ArchiveInvalid('This is a tenant’s own export; only a move archive is imported.');
    }
    if (manifest.schema !== SCHEMA) {
      throw new ArchiveInvalid(
        `The archive follows migration ${manifest.schema}; this cell is at ${SCHEMA}. Deploy the same version on both.`,
      );
    }
    const tenantId = manifest.tenant.id;
    const standing = await this.directory.standing(tenantId);
    if (standing?.movingTo !== this.config.CELL_ID) {
      throw new AppError('CONFLICT', 'The tenant is not being moved to this cell.');
    }
    return this.database.forTenant(tenantId, async (tx) => {
      const names = manifest.tables.map((table) => table.name);
      for (const name of names) {
        const held = await tx.execute(
          sql.raw(`select 1 from cell.${quote(name)} where tenant_id = '${tenantId}' limit 1`),
        );
        if (held.rows.length > 0) {
          throw new AppError('CONFLICT', `This cell holds rows of the tenant already, in ${name}.`);
        }
      }
      const references = await this.references(tx);
      let rows = 0;
      for (const name of this.order(names, references)) {
        const table = manifest.tables.find((item) => item.name === name)!;
        const lines = Buffer.from(entries[table.path]!)
          .toString('utf8')
          .split('\n')
          .filter(Boolean);
        const own = references
          .filter((reference) => reference.child === name && reference.parent === name)
          .flatMap((reference) => reference.columns.filter((column) => column !== 'tenant_id'));
        await this.insert(tx, tenantId, name, lines, own);
        const [counted] = (
          await tx.execute(
            sql.raw(
              `select count(*)::int as n from cell.${quote(name)} where tenant_id = '${tenantId}'`,
            ),
          )
        ).rows as { n: number }[];
        if (counted?.n !== table.rows) {
          throw new AppError(
            'CONFLICT',
            `${name} holds ${counted?.n ?? 0} rows after the import; the archive has ${table.rows}.`,
          );
        }
        rows += table.rows;
      }
      for (const file of manifest.media) {
        await this.media.restore(tx, tenantId, file.id, file.variant, entries[file.path]!);
      }
      return {
        tenantId,
        tables: names.length,
        rows,
        files: manifest.media.length,
      };
    });
  }

  /** On the target cell, once imported: the directory sends the tenant's people here. */
  async finish(tenantId: string): Promise<void> {
    const standing = await this.directory.standing(tenantId);
    if (standing?.movingTo !== this.config.CELL_ID) {
      throw new AppError('CONFLICT', 'The tenant is not being moved to this cell.');
    }
    const held = await this.database.forTenant(tenantId, (tx) =>
      tx.execute(sql`select 1 from cell.users where tenant_id = ${tenantId} limit 1`),
    );
    if (held.rows.length === 0) {
      throw new AppError('CONFLICT', 'Import the tenant here before finishing the move.');
    }
    await this.directory.finishMove(tenantId);
  }

  /**
   * On the source cell, once the tenant lives elsewhere: removes every row it held here, and its
   * files too when this cell's store isn't shared with the new one.
   */
  async purge(tenantId: string, options: { files: boolean }): Promise<number> {
    const standing = await this.directory.standing(tenantId);
    if (!standing) throw new AppError('NOT_FOUND', 'There is no such tenant.');
    if (standing.cell === this.config.CELL_ID) {
      throw new AppError('CONFLICT', 'The tenant still lives on this cell; nothing is purged.');
    }
    return this.database.forTenant(tenantId, async (tx) => {
      if (options.files) await this.media.removeAllObjects(tx, tenantId);
      const [result] = (await tx.execute(sql`select cell.purge_tenant(${tenantId}) as removed`))
        .rows as { removed: string }[];
      return Number(result?.removed ?? 0);
    });
  }

  /** The references between the cell's tables, from the catalogue. */
  private async references(tx: TenantTx): Promise<Reference[]> {
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

  /** The tables in an order where each comes after those it refers to; a cycle is refused. */
  private order(names: readonly string[], references: readonly Reference[]): string[] {
    const set = new Set(names);
    const waiting = new Map(names.map((name) => [name, new Set<string>()]));
    for (const { child, parent } of references) {
      if (child !== parent && set.has(child) && set.has(parent)) waiting.get(child)!.add(parent);
    }
    const ordered: string[] = [];
    while (waiting.size > 0) {
      const ready = [...waiting].filter(([, parents]) => parents.size === 0).map(([name]) => name);
      if (ready.length === 0) {
        throw new Error(`The tables refer to each other in a cycle: ${[...waiting.keys()]}.`);
      }
      for (const name of ready.sort()) {
        ordered.push(name);
        waiting.delete(name);
        for (const parents of waiting.values()) parents.delete(name);
      }
    }
    return ordered;
  }

  /**
   * Inserts a table's rows as JSON, a batch at a time. Row versions are left to the column's
   * default, this transaction's, so phones see the rows as new; references within the table go in
   * once every row is there.
   */
  private async insert(
    tx: TenantTx,
    tenantId: string,
    name: string,
    lines: readonly string[],
    own: readonly string[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const columns = (
      await tx.execute(sql`
        select a.attname::text as name from pg_attribute a
         where a.attrelid = ${`cell.${quote(name)}`}::regclass
           and a.attnum > 0 and not a.attisdropped
         order by a.attnum`)
    ).rows.map((row) => (row as { name: string }).name);
    const inserted = columns.filter((column) => column !== 'row_version' && !own.includes(column));
    const list = inserted.map(quote).join(', ');
    const target = `cell.${quote(name)}`;
    for (let start = 0; start < lines.length; start += BATCH) {
      const json = `[${lines.slice(start, start + BATCH).join(',')}]`;
      const rows = sql`jsonb_populate_recordset(null::${sql.raw(target)}, ${json}::jsonb)`;
      if (MONTHLY.includes(name)) {
        await tx.execute(sql`
          select cell.ensure_month_partitions(${name}, min(r.created_at), max(r.created_at))
            from ${rows} r`);
      }
      // Every row must be the tenant's own; RLS refuses any other, and so does this.
      await tx.execute(sql`
        insert into ${sql.raw(target)} (${sql.raw(list)})
        select ${sql.raw(list)} from ${rows}
         where tenant_id = ${tenantId}`);
    }
    if (own.length === 0) return;
    const set = own.map((column) => `${quote(column)} = r.${quote(column)}`).join(', ');
    for (let start = 0; start < lines.length; start += BATCH) {
      const json = `[${lines.slice(start, start + BATCH).join(',')}]`;
      await tx.execute(sql`
        update ${sql.raw(target)} as t set ${sql.raw(set)}
          from jsonb_populate_recordset(null::${sql.raw(target)}, ${json}::jsonb) r
         where t.tenant_id = r.tenant_id and t.id = r.id`);
    }
  }
}
