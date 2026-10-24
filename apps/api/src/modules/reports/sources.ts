import type { MessageKey } from '@thelamp/i18n';
import type {
  Locale,
  ReportCell,
  ReportColumnKind,
  ReportFilters,
  ReportKey,
} from '@thelamp/shared';
import type { SQL } from 'drizzle-orm';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/** A column as a report declares it: a fixed heading from the catalogue, or a configured one. */
export interface ColumnSpec {
  key: string;
  label: MessageKey | { en: string; hi: string };
  kind: ReportColumnKind;
}

/** What a report reads with: whose records, which month, and words in the reader's language. */
export interface ReportContext {
  tenantId: string;
  /** The caller, for reports of records reached otherwise than by person, such as accounts. */
  access: Access;
  filters: ReportFilters;
  locale: Locale;
  timezone: string;
  /** A subquery of the IDs of the people the report covers: the caller's scope, narrowed. */
  people: SQL;
  /** The first and last dates of the month. */
  from: string;
  to: string;
  /** A message in the reader's language, with the tenant's terms. */
  text: (key: MessageKey, params?: Record<string, string | number>) => string;
}

export type ReportRow = Record<string, ReportCell>;

export interface SourcePage {
  rows: ReportRow[];
  nextCursor: string | null;
}

/**
 * One report (M18). It declares its columns and reads its rows a page at a time; the reports
 * service narrows whose records it may read, and the exporter reads every page into a file.
 */
export abstract class ReportSource {
  abstract readonly key: ReportKey;
  abstract columns(tx: TenantTx, context: ReportContext): Promise<ColumnSpec[]>;
  abstract page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage>;
}

/** A cursor that counts people: the reports that run person by person page with it. */
export function personOffset(cursor: string | undefined): number {
  const offset = cursor === undefined ? 0 : Number(cursor);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}
