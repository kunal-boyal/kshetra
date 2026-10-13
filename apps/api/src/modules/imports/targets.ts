import { Injectable } from '@nestjs/common';
import type { ImportProblem, ImportTarget, TenantPermission } from '@kshetra/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import type { Cell, ImportField } from './reading';

/** One row of the file, by field key once the mapping is applied. */
export interface ImportRow {
  /** The row's number in the file, counting from 1, as the person sees it in their sheet. */
  row: number;
  cells: Readonly<Record<string, Cell>>;
}

export interface TargetField extends ImportField {
  /** A custom field's own label; the apps name the standard fields themselves. */
  label?: { en: string; hi: string };
}

/** What a target needs to know besides the rows. */
export interface ImportContext {
  access: Access;
  /** The import's target, such as `accounts:distributor` for a source that imports a family. */
  target: ImportTarget;
  /** Cell values the tenant's files use for "empty", such as "-". */
  emptyValues: readonly string[];
  /** Percentage columns where a value of 1 or less is a fraction (BR-17). */
  fractions: readonly string[];
}

/**
 * Something an import can load (module M19), registered by the module that owns it, so the
 * imports module never reads another module's tables. `check` finds every problem without
 * writing; `commit` writes every row in the caller's transaction, checking again first, and
 * throws an `ImportRefused` with the problems rather than write part of the file.
 */
export interface ImportTargetSource {
  /** A target, or a family of them: `accounts` imports every `accounts:<type>`. */
  name: string;
  /** What an import of this target needs, besides `import.run`. */
  permission: TenantPermission;
  fields(tx: TenantTx, tenantId: string, target: ImportTarget): Promise<TargetField[]>;
  check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext): Promise<ImportProblem[]>;
  commit(
    tx: TenantTx,
    rows: readonly ImportRow[],
    context: ImportContext,
  ): Promise<{ created: number; updated: number }>;
}

/** Problems found while committing: nothing was written. */
export class ImportRefused extends Error {
  constructor(readonly problems: ImportProblem[]) {
    super('The file has problems; nothing was imported.');
  }
}

/** Where modules register what they can import. */
@Injectable()
export class ImportTargets {
  private readonly sources = new Map<string, ImportTargetSource>();

  register(source: ImportTargetSource): void {
    if (this.sources.has(source.name)) throw new Error(`${source.name} is registered already.`);
    this.sources.set(source.name, source);
  }

  /** The source of a target: its own, or its family's. */
  get(target: string): ImportTargetSource {
    const source = this.sources.get(target) ?? this.sources.get(target.split(':')[0]!);
    if (!source) throw new Error(`Nothing imports ${target}.`);
    return source;
  }

  /** Every registered source, for listing what a person may import. */
  all(): ImportTargetSource[] {
    return [...this.sources.values()];
  }
}
