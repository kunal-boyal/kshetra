import { Injectable } from '@nestjs/common';
import { MESSAGES, type MessageKey, resolveTerminology, translate } from '@thelamp/i18n';
import {
  AppError,
  closedByModules,
  type ImportTarget,
  type Locale,
  type MetricUnit,
  neutraliseFormula,
} from '@thelamp/shared';
import ExcelJS from 'exceljs';
import { type Access, moduleDisabled } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import type { TargetField } from './targets';
import { ImportTargets } from './targets';

/**
 * A plausible target or plan for a metric by its unit, the first person's and the second's, so an
 * example never sets a percentage in lakhs (D111).
 */
export function exampleFigure(unit: MetricUnit, second = false): string {
  const figures: Record<MetricUnit, [string, string]> = {
    count: ['40', '60'],
    currency: ['250000', '400000'],
    quantity: ['120', '200'],
    percent: ['80', '90'],
    duration: ['30', '45'],
  };
  return figures[unit][second ? 1 : 0];
}

/** A column's heading in the file: a field's own label, else the first name the reader matches. */
export function exampleHeading(field: TargetField, locale: Locale): string {
  return field.label ? field.label[locale] : field.names[0]!;
}

/**
 * An example file for each import target (phase 4 step A2, decision D111): an XLSX of three sheets.
 * The first, which an import reads, holds only the headings, so the file uploaded unchanged
 * imports nothing; the second shows the target's own example rows under the same headings; the
 * third names each column in the reader's language and says whether it must be filled.
 */
@Injectable()
export class ImportExamples {
  constructor(
    private readonly targets: ImportTargets,
    private readonly config: TenantConfigService,
  ) {}

  async workbook(
    tx: TenantTx,
    access: Access,
    target: ImportTarget,
    locale: Locale,
  ): Promise<Uint8Array> {
    const source = this.targets.get(target);
    // As starting an import of it: the target's own permission, with its module on.
    if (!access.permissions.has(source.permission)) {
      if (closedByModules([source.permission], access.modulesOff)) throw moduleDisabled();
      throw new AppError('FORBIDDEN', "You don't have access to this.");
    }
    const fields = await source.fields(tx, access.tenantId, target);
    const rows = await source.example(tx, access.tenantId, target);
    const terms = resolveTerminology(await this.config.terminology(tx, access.tenantId), locale);
    const text = (key: MessageKey) => translate(key, { locale, terms });
    const family = target.split(':')[0]!;
    /** What a column is, as the import screen names it (`fieldName` in the portal). */
    const meaning = (field: TargetField) => {
      if (field.label) return field.label[locale];
      const key = `import.field_${family}_${field.key}`;
      return key in MESSAGES.en ? text(key as MessageKey) : field.key;
    };
    const headings = fields.map((field) => neutraliseFormula(exampleHeading(field, locale)));

    const workbook = new ExcelJS.Workbook();
    const sheet = (name: MessageKey) => workbook.addWorksheet(text(name).slice(0, 31));
    const widths = (worksheet: ExcelJS.Worksheet, values: readonly string[]) => {
      worksheet.columns = values.map((value) => ({
        width: Math.min(40, Math.max(12, value.length + 2)),
      }));
    };
    const heading = (worksheet: ExcelJS.Worksheet, values: readonly string[]) => {
      worksheet.addRow([...values]).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      widths(worksheet, values);
    };

    heading(sheet('import.example_sheet_rows'), headings);
    const example = sheet('import.example_sheet_example');
    heading(example, headings);
    for (const row of rows) {
      // Every cell is text, as people type it, so codes such as 007 keep their zeros.
      example.addRow(fields.map((field) => neutraliseFormula(row[field.key] ?? '')));
    }
    const columns = sheet('import.example_sheet_columns');
    heading(columns, [
      text('import.example_col_column'),
      text('import.example_col_meaning'),
      text('import.example_col_required'),
    ]);
    for (const [index, field] of fields.entries()) {
      columns.addRow([
        headings[index]!,
        neutraliseFormula(meaning(field)),
        text(field.required ? 'common.yes' : 'common.no'),
      ]);
    }
    columns.getColumn(2).width = 40;
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }
}
