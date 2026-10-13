import { Injectable } from '@nestjs/common';
import {
  checkFields,
  checkValueChanges,
  type CustomField,
  type UpdateUserFieldsBody,
  type UserFieldsResult,
} from '@kshetra/forms';
import { AppError, type ErrorDetail, issueAt, todayIn } from '@kshetra/shared';
import { eq } from 'drizzle-orm';
import { userFields } from '../../db/schema/iam';
import { AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { type Actor, actorId, auditActor } from './actor';

const NONE: UserFieldsResult = { fields: [], retired: [] };

/** What user fields can't use, with why (decision D41); patterns run in linear time (D45). */
function unsupported(field: CustomField, path: readonly PropertyKey[]): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if ((field.type === 'single_select' || field.type === 'multi_select') && field.optionsFrom) {
    issues.push(issueAt([...path, 'optionsFrom'], 'User fields offer their own options'));
  }
  return issues;
}

/**
 * The tenant's custom user fields (spec 5.3). Replacing the list retires what it leaves out: a
 * retired key stays taken with its type, so values already stored keep their meaning, and it may
 * come back as the same type.
 */
@Injectable()
export class UserFieldsService {
  constructor(
    private readonly audit: AuditLog,
    private readonly config: TenantConfigService,
  ) {}

  async get(tx: TenantTx, tenantId: string): Promise<UserFieldsResult> {
    const [row] = await tx
      .select({ fields: userFields.fields, retired: userFields.retired })
      .from(userFields)
      .where(eq(userFields.tenantId, tenantId));
    return row ?? NONE;
  }

  /** Checks a list of fields: its own rules, and that no key changes type. */
  private async check(
    tx: TenantTx,
    tenantId: string,
    fields: readonly CustomField[],
  ): Promise<{ before: UserFieldsResult; retired: CustomField[] }> {
    const before = await this.get(tx, tenantId);
    const known = new Map([...before.retired, ...before.fields].map((field) => [field.key, field]));
    const issues = [
      ...checkFields(fields, { accountTypes: new Map(), linkedAccountTypes: [] }, ['fields']),
      ...fields.flatMap((field, index) => unsupported(field, ['fields', index])),
      ...fields.flatMap((field, index) => {
        const earlier = known.get(field.key);
        return earlier && earlier.type !== field.type
          ? [
              issueAt(
                ['fields', index, 'type'],
                `\`${field.key}\` was a ${earlier.type} field, and a key keeps its type`,
              ),
            ]
          : [];
      }),
    ];
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    }
    const kept = new Set(fields.map((field) => field.key));
    const retired = [...known.values()].filter((field) => !kept.has(field.key));
    return { before, retired };
  }

  async replace(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    input: UpdateUserFieldsBody,
  ): Promise<UserFieldsResult> {
    const { before, retired } = await this.check(tx, tenantId, input.fields);
    const after: UserFieldsResult = { fields: input.fields, retired };
    const by = actorId(actor);
    await tx
      .insert(userFields)
      .values({ tenantId, ...after, updatedBy: by })
      .onConflictDoUpdate({
        target: userFields.tenantId,
        set: { ...after, updatedAt: new Date(), updatedBy: by },
      });
    await this.audit.record(tx, tenantId, auditActor(actor), {
      action: 'user_fields.replaced',
      target: { type: 'user_fields', id: null },
      before,
      after,
    });
    return after;
  }

  /**
   * Values for a new user, or changed values for an existing one, checked against the fields in
   * use. A change checks only the keys it sends, so a field made required later doesn't block an
   * unrelated edit; the stored values it leaves alone stay as they are. Returns the values to store.
   */
  async values(
    tx: TenantTx,
    tenantId: string,
    current: Record<string, unknown> | null,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { fields } = await this.get(tx, tenantId);
    const { timezone } = await this.config.settings(tx, tenantId);
    const { values, issues } = checkValueChanges(fields, todayIn(timezone), current, input);
    if (issues.length > 0)
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    return values;
  }
}
