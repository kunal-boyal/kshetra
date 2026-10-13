import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type CreateImportQuery,
  type ImportListQuery,
  type ImportListResult,
  type ImportProblem,
  type ImportResult,
  issueAt,
  newId,
  type UpdateImportMappingBody,
} from '@kshetra/shared';
import { and, desc, eq, inArray, like, lt, or } from 'drizzle-orm';
import type { Config } from '../../config';
import { importJobs, importMappings, type PreviewRow } from '../../db/schema/imports';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, AccessResolver } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { CONFIG } from '../../platform/tokens';
import { MediaService } from '../media/media.service';
import {
  type Cell,
  cellText,
  fileKind,
  findHeaderRow,
  isEmptyCell,
  MAX_FILE_BYTES,
  MAX_ROWS,
  normaliseHeader,
  readRows,
  suggestMapping,
  UnreadableFileError,
} from './reading';
import { type ImportRow, ImportRefused, ImportTargets, type TargetField } from './targets';

type Job = typeof importJobs.$inferSelect;

/** Shown to the person in full; beyond these, the count says how many more. */
const MAX_PROBLEMS = 1_000;
const PREVIEW_ROWS = 200;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const notFound = () => new AppError('NOT_FOUND', 'This was not found.');

/** Headers as the file has them, each named once: blanks become "Column 3", repeats "Name (2)". */
function headersOf(row: readonly Cell[]): string[] {
  const seen = new Map<string, number>();
  return row.map((cell, index) => {
    const text = cellText(cell) || `Column ${index + 1}`;
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return count === 1 ? text : `${text} (${count})`;
  });
}

/** The data rows under the header, by field, skipping rows with nothing in them. */
function importRows(
  rows: readonly Cell[][],
  job: Pick<Job, 'headerRow' | 'headers' | 'mapping'>,
): ImportRow[] {
  const start = job.headerRow ?? 1;
  const columns = job.headers.flatMap((header, index) => {
    const field = job.mapping[header];
    return field ? [[index, field] as const] : [];
  });
  return rows.slice(start).flatMap((row, offset) => {
    if (row.every((cell) => isEmptyCell(cell))) return [];
    const cells: Record<string, Cell> = {};
    for (const [index, field] of columns) cells[field] = row[index] ?? null;
    return [{ row: start + offset + 1, cells }];
  });
}

/**
 * Imports (module M19). A file is uploaded and kept; the worker finds its header and suggests
 * which column fills which field; the person confirms the mapping; the worker checks every row
 * and keeps a preview; and the commit writes every row in one transaction, or none (BR-43).
 */
@Injectable()
export class ImportsService implements OnModuleInit {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly database: Database,
    private readonly media: MediaService,
    private readonly targets: ImportTargets,
    private readonly queues: Queues,
    private readonly audit: AuditLog,
    private readonly access: AccessResolver,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    const run =
      (work: (tenantId: string, id: string) => Promise<void>) =>
      async (data: { tenantId?: string; [field: string]: unknown }) =>
        work(String(data.tenantId), String(data.importId));
    this.queues.handle(
      'imports',
      'imports.read',
      run((tenant, id) => this.read(tenant, id)),
    );
    this.queues.handle(
      'imports',
      'imports.check',
      run((tenant, id) => this.check(tenant, id)),
    );
    this.queues.handle(
      'imports',
      'imports.commit',
      run((tenant, id) => this.write(tenant, id)),
    );
  }

  /** The import's target, if the caller may import it. */
  private target(access: Access, name: Job['target']) {
    const target = this.targets.get(name);
    if (!access.permissions.has(target.permission)) {
      throw new AppError('FORBIDDEN', "You don't have access to this.");
    }
    return target;
  }

  private enqueue(tx: TenantTx, kind: string, tenantId: string, importId: string): void {
    this.database.afterCommit(tx, () => this.queues.add('imports', kind, { tenantId, importId }));
  }

  async create(
    tx: TenantTx,
    access: Access,
    query: CreateImportQuery,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<ImportResult> {
    this.target(access, query.target);
    const kind = fileKind(query.fileName, contentType);
    if (!kind) {
      throw new AppError('VALIDATION', 'Upload an XLSX or CSV file.', [
        { path: 'fileName', issue: 'Use an .xlsx or .csv file' },
      ]);
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
      throw new AppError('VALIDATION', 'Upload a file of at most 20 MB.', [
        { path: 'file', issue: bytes.byteLength === 0 ? 'The file is empty' : 'Larger than 20 MB' },
      ]);
    }
    const id = newId();
    const file = await this.media.store(tx, access.tenantId, {
      kind: 'import_file',
      fileName: query.fileName,
      contentType: kind === 'csv' ? 'text/csv' : XLSX,
      bytes,
      userId: access.userId,
      ownerType: 'import',
      ownerId: id,
      retentionClass: 'import_file',
    });
    const [job] = await tx
      .insert(importJobs)
      .values({
        id,
        tenantId: access.tenantId,
        target: query.target,
        fileMediaId: file.id,
        fileName: query.fileName,
        createdBy: access.userId,
      })
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'import.uploaded',
      target: { type: 'import', id },
      after: {
        target: query.target,
        fileName: query.fileName,
        size: file.size,
        sha256: file.sha256,
      },
    });
    this.enqueue(tx, 'imports.read', access.tenantId, id);
    return this.result(tx, job!);
  }

  async get(tx: TenantTx, access: Access, id: string): Promise<ImportResult> {
    const job = await this.find(tx, access.tenantId, id);
    this.target(access, job.target);
    return this.result(tx, job);
  }

  async list(tx: TenantTx, access: Access, query: ImportListQuery): Promise<ImportListResult> {
    // A family, such as `accounts`, stands for every target in it.
    const allowed = this.targets
      .all()
      .filter((source) => access.permissions.has(source.permission))
      .map((source) => source.name);
    if (query.target && !allowed.includes(query.target.split(':')[0]!)) {
      return { items: [], nextCursor: null };
    }
    if (allowed.length === 0) return { items: [], nextCursor: null };
    const ofTarget = query.target
      ? eq(importJobs.target, query.target)
      : or(
          inArray(importJobs.target, allowed),
          ...allowed.map((family) => like(importJobs.target, `${family}:%`)),
        );
    const rows = await tx
      .select()
      .from(importJobs)
      .where(
        and(
          eq(importJobs.tenantId, access.tenantId),
          ofTarget,
          query.cursor ? lt(importJobs.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(importJobs.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((job) => ({
        id: job.id,
        target: job.target as ImportResultTarget,
        fileName: job.fileName,
        status: job.status,
        totalRows: job.totalRows,
        errorRows: job.errorRows,
        created: job.created,
        updated: job.updated,
        createdBy: job.createdBy,
        createdAt: job.createdAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * Another sheet to read, or the mapping to check the rows with. A mapping names each header's
   * field, or null to leave the column out; every required field needs a column, and a field
   * takes one column at most.
   */
  async setMapping(
    tx: TenantTx,
    access: Access,
    id: string,
    body: UpdateImportMappingBody,
  ): Promise<ImportResult> {
    const job = await this.find(tx, access.tenantId, id, true);
    const target = this.target(access, job.target);
    if (!['mapping', 'ready', 'invalid'].includes(job.status)) {
      throw new AppError('CONFLICT', 'This import is busy, or already done.');
    }
    if (body.sheet !== undefined && body.sheet !== job.sheet) {
      if (!job.sheets.includes(body.sheet)) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'sheet', issue: 'There is no sheet with this name' },
        ]);
      }
      const [changed] = await tx
        .update(importJobs)
        .set({ sheet: body.sheet, status: 'reading', mapping: {}, updatedAt: new Date() })
        .where(and(eq(importJobs.tenantId, access.tenantId), eq(importJobs.id, id)))
        .returning();
      this.enqueue(tx, 'imports.read', access.tenantId, id);
      return this.result(tx, changed!);
    }

    const fields = await target.fields(tx, access.tenantId, job.target as ImportResultTarget);
    const keys = new Set(fields.map((field) => field.key));
    const mapping = body.mapping ?? job.mapping;
    const problems = Object.entries(mapping).flatMap(([header, field]) => [
      ...(job.headers.includes(header)
        ? []
        : [issueAt(['mapping', header], 'There is no such column')]),
      ...(field === null || keys.has(field)
        ? []
        : [issueAt(['mapping', header], `There is no field \`${field}\``)]),
    ]);
    const used = Object.values(mapping).filter((field): field is string => field !== null);
    for (const field of new Set(used.filter((key, index) => used.indexOf(key) !== index))) {
      problems.push(issueAt(['mapping'], `\`${field}\` is chosen for more than one column`));
    }
    for (const field of fields.filter((entry) => entry.required && !used.includes(entry.key))) {
      problems.push(issueAt(['mapping'], `Choose a column for \`${field.key}\``));
    }
    if (problems.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', problems);
    }

    if (body.saveAs) {
      const saved = Object.fromEntries(
        Object.entries(mapping).flatMap(([header, field]) =>
          field ? [[normaliseHeader(header), field]] : [],
        ),
      );
      await tx
        .insert(importMappings)
        .values({
          id: newId(),
          tenantId: access.tenantId,
          target: job.target,
          name: body.saveAs,
          mapping: saved,
          createdBy: access.userId,
        })
        .onConflictDoUpdate({
          target: [importMappings.tenantId, importMappings.target, importMappings.name],
          set: { mapping: saved, updatedAt: new Date() },
        });
    }
    const [changed] = await tx
      .update(importJobs)
      .set({
        mapping,
        status: 'validating',
        errors: [],
        preview: [],
        errorRows: null,
        updatedAt: new Date(),
      })
      .where(and(eq(importJobs.tenantId, access.tenantId), eq(importJobs.id, id)))
      .returning();
    this.enqueue(tx, 'imports.check', access.tenantId, id);
    return this.result(tx, changed!);
  }

  /** Starts the commit of a checked file. Asking again while it runs, or after, changes nothing. */
  async commit(tx: TenantTx, access: Access, id: string): Promise<ImportResult> {
    const job = await this.find(tx, access.tenantId, id, true);
    this.target(access, job.target);
    if (job.status === 'committing' || job.status === 'committed') return this.result(tx, job);
    if (job.status !== 'ready') {
      throw new AppError('CONFLICT', 'Check the file, and fix its problems, before importing it.');
    }
    const [changed] = await tx
      .update(importJobs)
      .set({ status: 'committing', updatedAt: new Date() })
      .where(and(eq(importJobs.tenantId, access.tenantId), eq(importJobs.id, id)))
      .returning();
    this.enqueue(tx, 'imports.commit', access.tenantId, id);
    return this.result(tx, changed!);
  }

  /**
   * A template's import aliases (spec 5.14), saved as the mapping named `template` for each
   * target, so its customers' usual headers are understood from the first file.
   */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    imports: Readonly<
      Record<
        string,
        {
          aliases: Record<string, readonly string[]>;
          emptyValues: readonly string[];
          fractions?: readonly string[];
        }
      >
    >,
  ): Promise<void> {
    for (const [target, settings] of Object.entries(imports)) {
      const mapping = Object.fromEntries(
        Object.entries(settings.aliases).flatMap(([field, aliases]) =>
          aliases.map((alias) => [alias, field] as const),
        ),
      );
      await tx.insert(importMappings).values({
        id: newId(),
        tenantId,
        target,
        name: 'template',
        mapping,
        emptyValues: [...settings.emptyValues],
        fractions: [...(settings.fractions ?? [])],
      });
    }
  }

  // The worker's side.

  /** Finds the header, and suggests the mapping. */
  async read(tenantId: string, id: string): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const job = await this.find(tx, tenantId, id, true);
      if (job.status !== 'reading') return;
      const target = this.targets.get(job.target);
      let sheet;
      try {
        sheet = await this.sheet(tx, job);
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) throw error;
        await this.fail(tx, job, error.message);
        return;
      }
      const saved = await this.saved(tx, tenantId, job.target);
      const fields = (await target.fields(tx, tenantId, job.target as ImportResultTarget)).map(
        (field) => ({
          ...field,
          names: [
            ...field.names,
            ...saved.flatMap((entry) =>
              Object.entries(entry.mapping).flatMap(([header, key]) =>
                key === field.key ? [header] : [],
              ),
            ),
          ],
        }),
      );
      const headerIndex = findHeaderRow(sheet.rows, fields);
      const headers = headersOf(sheet.rows[headerIndex] ?? []);
      const job2 = { headerRow: headerIndex + 1, headers, mapping: {} };
      const total = importRows(sheet.rows, job2).length;
      if (total > MAX_ROWS) {
        await this.fail(
          tx,
          job,
          `The file has more than ${MAX_ROWS} rows. Split it, and import each part.`,
        );
        return;
      }
      await tx
        .update(importJobs)
        .set({
          sheets: sheet.sheets,
          sheet: sheet.sheet,
          headerRow: headerIndex + 1,
          headers,
          mapping: suggestMapping(
            headers,
            fields,
            saved.map((entry) => entry.mapping),
          ),
          totalRows: total,
          status: 'mapping',
          updatedAt: new Date(),
        })
        .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)));
    });
  }

  /** Checks every row, and keeps the problems and a preview. */
  async check(tenantId: string, id: string): Promise<void> {
    const job = await this.database.forTenant(tenantId, (tx) => this.find(tx, tenantId, id));
    if (job.status !== 'validating') return;
    const prepared = await this.prepare(tenantId, job);
    if (!prepared) return;
    const { rows, context, target } = prepared;
    const problems = await this.database.forTenant(
      tenantId,
      (tx) => target.check(tx, rows, context),
      { readOnly: true },
    );
    await this.database.forTenant(tenantId, async (tx) => {
      if (await this.unchanged(tx, job)) {
        await this.settle(tx, job, rows, problems, problems.length === 0 ? 'ready' : 'invalid');
      }
    });
  }

  /** Writes every row in one transaction, or none. */
  async write(tenantId: string, id: string): Promise<void> {
    const job = await this.database.forTenant(tenantId, (tx) => this.find(tx, tenantId, id));
    if (job.status !== 'committing') return;
    const prepared = await this.prepare(tenantId, job);
    if (!prepared) return;
    const { rows, context, target } = prepared;
    try {
      const counts = await this.database.forTenant(tenantId, async (tx) => {
        // A job delivered twice commits once: the second waits on the lock, then finds it done.
        if (!(await this.unchanged(tx, job))) return null;
        const written = await target.commit(tx, rows, context);
        await tx
          .update(importJobs)
          .set({
            status: 'committed',
            created: written.created,
            updated: written.updated,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)));
        await this.audit.record(tx, tenantId, userActor(context.access), {
          action: 'import.committed',
          target: { type: 'import', id },
          after: { target: job.target, ...written },
        });
        return written;
      });
      if (counts) {
        this.logger.log(`Import ${id}: ${counts.created} added, ${counts.updated} changed.`);
      }
    } catch (error) {
      await this.database.forTenant(tenantId, async (tx) => {
        if (!(await this.unchanged(tx, job))) return;
        if (error instanceof ImportRefused) {
          await this.settle(tx, job, rows, error.problems, 'invalid');
        } else if (error instanceof AppError) {
          await this.fail(tx, job, error.message);
        } else {
          this.logger.error(`Import ${id} failed: ${(error as Error).message}`);
          await this.fail(tx, job, 'Something went wrong, and nothing was imported. Try again.');
        }
      });
    }
  }

  /** The importer's access now, and the rows by field; null after marking the job failed. */
  private async prepare(tenantId: string, job: Job) {
    const target = this.targets.get(job.target);
    let access: Access;
    try {
      access = await this.access.onBehalfOf(tenantId, job.createdBy, this.config.CELL_ID);
    } catch {
      await this.database.forTenant(tenantId, (tx) =>
        this.fail(tx, job, 'The person who started this import can no longer use it.'),
      );
      return null;
    }
    if (!access.permissions.has(target.permission) || !access.permissions.has('import.run')) {
      await this.database.forTenant(tenantId, (tx) =>
        this.fail(tx, job, 'The person who started this import may no longer run it.'),
      );
      return null;
    }
    const { sheet, saved } = await this.database.forTenant(tenantId, async (tx) => ({
      sheet: await this.sheet(tx, job),
      saved: await this.saved(tx, tenantId, job.target),
    }));
    return {
      target,
      rows: importRows(sheet.rows, job),
      context: {
        access,
        target: job.target as ImportResultTarget,
        fractions: [...new Set(saved.flatMap((entry) => entry.fractions))],
        emptyValues: [...new Set(saved.flatMap((entry) => entry.emptyValues))],
      },
    };
  }

  /** Records a check's outcome: the first problems, the rows with any, and the preview. */
  private async settle(
    tx: TenantTx,
    job: Job,
    rows: readonly ImportRow[],
    problems: readonly ImportProblem[],
    status: 'ready' | 'invalid',
  ): Promise<void> {
    const byRow = new Map<number, string[]>();
    for (const problem of problems) {
      if (problem.row === null) continue;
      byRow.set(problem.row, [...(byRow.get(problem.row) ?? []), problem.issue]);
    }
    const preview: PreviewRow[] = rows.slice(0, PREVIEW_ROWS).map((row) => ({
      row: row.row,
      values: Object.fromEntries(
        Object.entries(row.cells).map(([field, cell]) => [field, cellText(cell)]),
      ),
      problems: byRow.get(row.row) ?? [],
    }));
    await tx
      .update(importJobs)
      .set({
        status,
        errors: problems.slice(0, MAX_PROBLEMS),
        errorRows: new Set(problems.map((problem) => problem.row)).size,
        preview,
        updatedAt: new Date(),
      })
      .where(and(eq(importJobs.tenantId, job.tenantId), eq(importJobs.id, job.id)));
  }

  private async fail(tx: TenantTx, job: Job, reason: string): Promise<void> {
    await tx
      .update(importJobs)
      .set({
        status: 'failed',
        errors: [{ row: null, field: null, issue: reason }],
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(importJobs.tenantId, job.tenantId), eq(importJobs.id, job.id)));
  }

  private async sheet(tx: TenantTx, job: Job) {
    const file = await this.media.read(tx, job.tenantId, job.fileMediaId);
    const kind = fileKind(job.fileName, file.contentType);
    if (!kind) throw new UnreadableFileError('This is not an XLSX or CSV file.');
    return readRows(file.bytes, kind, job.sheet);
  }

  /** Saved mappings for a target, newest first, with the template's last. */
  private async saved(tx: TenantTx, tenantId: string, target: string) {
    const rows = await tx
      .select({
        name: importMappings.name,
        mapping: importMappings.mapping,
        emptyValues: importMappings.emptyValues,
        fractions: importMappings.fractions,
      })
      .from(importMappings)
      .where(and(eq(importMappings.tenantId, tenantId), eq(importMappings.target, target)))
      .orderBy(desc(importMappings.updatedAt));
    return [
      ...rows.filter((row) => row.name !== 'template'),
      ...rows.filter((row) => row.name === 'template'),
    ];
  }

  /**
   * Locks the job for the rest of the transaction, and tells whether it is still as the step
   * found it. Steps run at least once, and a person may change the mapping meanwhile.
   */
  private async unchanged(tx: TenantTx, job: Job): Promise<boolean> {
    const now = await this.find(tx, job.tenantId, job.id, true);
    return now.status === job.status && now.updatedAt.getTime() === job.updatedAt.getTime();
  }

  private async find(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Job> {
    const query = tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)));
    const [job] = lock ? await query.for('update') : await query;
    if (!job) throw notFound();
    return job;
  }

  private async result(tx: TenantTx, job: Job): Promise<ImportResult> {
    const target = this.targets.get(job.target);
    const fields = await target.fields(tx, job.tenantId, job.target as ImportResultTarget);
    return {
      id: job.id,
      target: job.target as ImportResultTarget,
      fileName: job.fileName,
      status: job.status,
      sheets: job.sheets,
      sheet: job.sheet,
      headerRow: job.headerRow,
      headers: job.headers,
      mapping: job.mapping,
      fields: fields.map((field: TargetField) => ({
        key: field.key,
        required: field.required,
        ...(field.label ? { label: field.label } : {}),
      })),
      totalRows: job.totalRows,
      errorRows: job.errorRows,
      errors: job.errors,
      preview: job.preview,
      created: job.created,
      updated: job.updated,
      createdBy: job.createdBy,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}

type ImportResultTarget = ImportResult['target'];
