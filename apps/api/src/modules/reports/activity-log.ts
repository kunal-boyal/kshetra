import { Injectable } from '@nestjs/common';
import type { AnyField, FormDefinition } from '@kshetra/forms';
import type { Locale, ReportCell, ReportColumnKind } from '@kshetra/shared';
import type { TenantTx } from '../../platform/database';
import { SubmissionsService } from '../field/submissions.service';
import { FormsService } from '../forms/forms.service';
import {
  type ColumnSpec,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** Fields that hold no value of their own. */
const LAYOUT = new Set(['section', 'info_text']);

type ValueField = Extract<FormDefinition['fields'][number], { label: unknown }>;

/** How a field's values read in a spreadsheet. */
function kindOf(field: AnyField): ReportColumnKind {
  switch (field.type) {
    case 'number':
    case 'rating':
      return 'number';
    case 'currency':
      return 'decimal';
    case 'date':
      return 'date';
    case 'yes_no':
      return 'boolean';
    default:
      return 'text';
  }
}

/**
 * A field's value as one cell: options by their label in the reader's language, lists joined, and
 * anything larger, such as product lines, as JSON.
 */
export function fieldCell(field: AnyField, value: unknown, locale: Locale): ReportCell {
  if (value === undefined || value === null || value === '') return null;
  const options = 'options' in field && field.options ? field.options : [];
  const label = (key: unknown) =>
    options.find((option) => option.key === key)?.label[locale] ?? String(key);
  if (field.type === 'single_select') return label(value);
  if (field.type === 'multi_select' && Array.isArray(value)) return value.map(label).join(', ');
  if (field.type === 'photo' && Array.isArray(value)) return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry !== 'object')) {
    return value.join(', ');
  }
  return JSON.stringify(value);
}

/** Every field with a value, at the top level, in form order. */
const valueFields = (definition: Pick<FormDefinition, 'fields'>): ValueField[] =>
  definition.fields.filter(
    (field): field is ValueField => !LAYOUT.has(field.type) && 'label' in field,
  );

/**
 * The activity log (M18): every submission in the month, with where it was filled, the geofence
 * result, flags and review status. With one form chosen its fields become columns; otherwise the
 * values go into one column, each with its label.
 */
@Injectable()
export class ActivityLogReport extends ReportSource {
  readonly key = 'activity_log' as const;

  constructor(
    private readonly submissions: SubmissionsService,
    private readonly forms: FormsService,
  ) {
    super();
  }

  private async chosenForm(tx: TenantTx, context: ReportContext) {
    if (!context.filters.form) return null;
    const forms = await this.forms.list(tx, context.tenantId);
    return forms.find((form) => form.key === context.filters.form) ?? null;
  }

  async columns(tx: TenantTx, context: ReportContext): Promise<ColumnSpec[]> {
    const form = await this.chosenForm(tx, context);
    return [
      { key: 'captured_at', label: 'report.col_captured_at', kind: 'datetime' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'form', label: 'report.col_form', kind: 'text' },
      { key: 'form_version', label: 'report.col_form_version', kind: 'number' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'latitude', label: 'report.col_latitude', kind: 'number' },
      { key: 'longitude', label: 'report.col_longitude', kind: 'number' },
      { key: 'accuracy', label: 'report.col_accuracy', kind: 'number' },
      { key: 'distance', label: 'report.col_distance', kind: 'number' },
      { key: 'geofence', label: 'report.col_geofence', kind: 'text' },
      { key: 'flags', label: 'report.col_flags', kind: 'text' },
      { key: 'status', label: 'report.col_status', kind: 'text' },
      ...(form
        ? valueFields(form).map((field) => ({
            key: `field_${field.key}`,
            label: field.label,
            kind: kindOf(field),
          }))
        : [{ key: 'values', label: 'report.col_values' as const, kind: 'text' as const }]),
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const { locale, text } = context;
    const form = await this.chosenForm(tx, context);
    const found = await this.submissions.forReport(
      tx,
      context.tenantId,
      {
        userIds: context.people,
        period: context.filters.period,
        ...(context.filters.accountType ? { accountType: context.filters.accountType } : {}),
        ...(context.filters.form ? { formKey: context.filters.form } : {}),
      },
      cursor,
      limit,
    );
    return {
      rows: found.rows.map((row) => {
        const values = row.values as Record<string, unknown>;
        const cells: ReportRow = {
          captured_at: row.capturedAt,
          user_code: row.user.code,
          user_name: row.user.name,
          form: row.form.name[locale].one,
          form_version: row.form.version,
          account_code: row.account?.code ?? null,
          account_name: row.account?.name ?? null,
          latitude: row.location.lat,
          longitude: row.location.lng,
          accuracy: Math.round(row.accuracy),
          distance: row.distanceM,
          geofence: text(`review.geofence_${row.geofence ?? 'unknown'}`),
          flags: row.flags.map((flag) => text(`submissions.flag_${flag}`)).join(', ') || null,
          status: text(`review.status_${row.status}`),
        };
        if (form) {
          // The chosen form's current fields; an older version's values fill those it shares.
          for (const field of valueFields(form)) {
            cells[`field_${field.key}`] = fieldCell(field, values[field.key], locale);
          }
        } else {
          cells.values =
            valueFields(row.definition)
              .flatMap((field) => {
                const cell = fieldCell(field, values[field.key], locale);
                return cell === null ? [] : [`${field.label[locale]}: ${String(cell)}`];
              })
              .join('; ') || null;
        }
        return cells;
      }),
      nextCursor: found.nextCursor,
    };
  }
}
