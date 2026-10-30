import { Injectable } from '@nestjs/common';
import type { FormDefinition } from '@thelamp/forms';
import {
  checkMetrics,
  checkScore,
  type MetricContext,
  type MetricDefinition,
  type MetricDefinitionsResult,
  RECOMPUTE_MAX_DAYS,
  type ScoreDefinition,
  type UpdateMetricBody,
} from '@thelamp/metrics';
import {
  AppError,
  type ErrorDetail,
  issueAt,
  periodKindOn,
  periodSwitchIssue,
  todayIn,
} from '@thelamp/shared';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { AccountTypesService } from '../accounts/account-types.service';
import { notFound } from '../iam/actor';
import { RolesService } from '../iam/roles.service';
import { FormsService } from '../forms/forms.service';
import { MetricsService } from '../metrics/metrics.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'This could not be saved.', issues);

/** The date `days` before a `YYYY-MM-DD` date. */
function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/**
 * Changing metrics and the score (M2, spec 5.7, 5.8, decision D65). Each change is checked as a
 * template's metrics are, against the tenant's forms, account types and roles. A metric keeps its
 * key and unit, as targets and facts are in it; one the score or a ratio uses can't retire. A
 * changed metric publishes `metrics.changed`, and people's facts from the chosen date are worked
 * out again. The score's period is the tenant's target period: a month, or a quarter or year of
 * the financial year from a period still to come (D108).
 */
@Injectable()
export class MetricsAdmin {
  constructor(
    private readonly metrics: MetricsService,
    private readonly forms: FormsService,
    private readonly accountTypes: AccountTypesService,
    private readonly roles: RolesService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  async read(tx: TenantTx, tenantId: string): Promise<MetricDefinitionsResult> {
    return {
      metrics: await this.metrics.entries(tx, tenantId),
      score: await this.metrics.score(tx, tenantId),
    };
  }

  private async context(tx: TenantTx, tenantId: string): Promise<MetricContext> {
    const forms = await this.forms.list(tx, tenantId);
    const types = await this.accountTypes.list(tx, tenantId);
    const roles = await this.roles.list(tx, tenantId);
    return {
      forms: new Map(forms.map((form) => [form.key, form as FormDefinition])),
      accountTypes: new Map(
        types.map((type) => [
          type.key,
          { segments: new Set(type.definition.segmentRules.map((rule) => rule.segment)) },
        ]),
      ),
      roles: new Set(roles.map((role) => role.key)),
    };
  }

  /** The issues of one metric among the active set it would join, with paths under `definition`. */
  private async issuesOf(
    tx: TenantTx,
    tenantId: string,
    active: readonly MetricDefinition[],
    key: string,
  ): Promise<ErrorDetail[]> {
    const index = active.findIndex((metric) => metric.key === key);
    return checkMetrics(active, await this.context(tx, tenantId), ['metrics']).flatMap((issue) =>
      issue.path.startsWith(`metrics[${index}]`)
        ? [{ ...issue, path: issue.path.replace(`metrics[${index}]`, 'definition') }]
        : [],
    );
  }

  /** A date to work facts out again from: not after today, nor too far back. */
  private async from(tx: TenantTx, tenantId: string, date: string): Promise<ErrorDetail[]> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    if (date > today) return [issueAt(['from'], 'Choose today or an earlier day')];
    if (date < daysBefore(today, RECOMPUTE_MAX_DAYS)) {
      return [issueAt(['from'], `Choose a day within the last ${RECOMPUTE_MAX_DAYS} days`)];
    }
    return [];
  }

  /** A new metric, worked out from the first of this month so the month shows it whole. */
  async create(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    actorId: string | null,
    definition: MetricDefinition,
  ): Promise<MetricDefinitionsResult> {
    const entries = await this.metrics.entries(tx, tenantId);
    if (entries.some((entry) => entry.definition.key === definition.key)) {
      throw invalid([
        issueAt(['definition', 'key'], `There is a metric \`${definition.key}\` already`),
      ]);
    }
    const active = [
      ...entries.filter((entry) => entry.active).map((entry) => entry.definition),
      definition,
    ];
    const issues = await this.issuesOf(tx, tenantId, active, definition.key);
    if (issues.length > 0) throw invalid(issues);
    await this.metrics.insert(tx, tenantId, definition);
    await this.config.touch(tx, tenantId, actorId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'metric.created',
      target: { type: 'metric', id: null },
      after: definition,
    });
    const { timezone } = await this.config.settings(tx, tenantId);
    // The tenant's metric set is the aggregate.
    await this.outbox.publish(tx, tenantId, 'metrics.changed', tenantId, {
      from: `${todayIn(timezone).slice(0, 7)}-01`,
      keys: [definition.key],
    });
    return this.read(tx, tenantId);
  }

  async update(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    actorId: string | null,
    key: string,
    change: UpdateMetricBody,
  ): Promise<MetricDefinitionsResult> {
    const entries = await this.metrics.entries(tx, tenantId);
    const current = entries.find((entry) => entry.definition.key === key);
    if (!current) throw notFound();
    const { definition, active } = change;
    const issues: ErrorDetail[] = [...(await this.from(tx, tenantId, change.from))];
    if (definition.key !== key)
      issues.push(issueAt(['definition', 'key'], 'A metric keeps its key'));
    if (definition.unit !== current.definition.unit) {
      issues.push(
        issueAt(
          ['definition', 'unit'],
          'A metric keeps its unit, as its targets and facts are in it',
        ),
      );
    }
    const others = entries
      .filter((entry) => entry.active && entry.definition.key !== key)
      .map((entry) => entry.definition);
    const after = active ? [...others, definition] : others;
    if (active) {
      issues.push(...(await this.issuesOf(tx, tenantId, after, key)));
    } else {
      for (const other of others) {
        if (
          other.source.type === 'ratio' &&
          (other.source.numerator === key || other.source.denominator === key)
        ) {
          issues.push(
            issueAt(['active'], `\`${other.key}\` divides by this metric; change it first`),
          );
        }
      }
    }
    const score = await this.metrics.score(tx, tenantId);
    if (score) {
      const scoreIssues = checkScore(score, new Map(after.map((metric) => [metric.key, metric])));
      if (scoreIssues.length > 0) {
        issues.push(
          issueAt(['active'], 'The score uses this metric; take it out of the score first'),
        );
      }
    }
    if (issues.length > 0) throw invalid(issues);
    await this.metrics.replace(tx, tenantId, definition, active);
    await this.config.touch(tx, tenantId, actorId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'metric.updated',
      target: { type: 'metric', id: null },
      before: { definition: current.definition, active: current.active },
      after: { definition, active, from: change.from },
    });
    await this.outbox.publish(tx, tenantId, 'metrics.changed', tenantId, {
      from: change.from,
      keys: [key],
    });
    return this.read(tx, tenantId);
  }

  /**
   * The score's next definition; scores are worked out on reading, so nothing is recomputed. A
   * new kind of period (D108) starts at `periodFrom`, a period still to come where the kind in
   * force ends; the server keeps the kind before it as `earlierPeriodType`.
   */
  async updateScore(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    actorId: string | null,
    definition: ScoreDefinition,
  ): Promise<MetricDefinitionsResult> {
    const entries = await this.metrics.entries(tx, tenantId);
    const active = new Map(
      entries
        .filter((entry) => entry.active)
        .map((entry) => [entry.definition.key, entry.definition]),
    );
    const issues = checkScore(definition, active, ['definition']);
    const before = await this.metrics.score(tx, tenantId);
    const settings = await this.config.settings(tx, tenantId);
    const today = todayIn(settings.timezone);
    const startMonth = settings.financialYearStartMonth;
    const inForce = periodKindOn(before, today, startMonth);
    const switchIssue = periodSwitchIssue(before, definition, today, startMonth);
    if (switchIssue) issues.push(issueAt(['definition', 'periodFrom'], switchIssue));
    if (issues.length > 0) throw invalid(issues);
    // The kind before the switch, so periods already counted keep theirs; none without a switch.
    const switching = definition.periodType !== inForce;
    const saved = {
      ...definition,
      periodFrom: switching ? definition.periodFrom : undefined,
      earlierPeriodType: switching ? inForce : undefined,
    };
    if (!switching && before?.periodFrom && before.periodType === definition.periodType) {
      // A switch already under way stays as it was, unless the kind changed back.
      saved.periodFrom = before.periodFrom;
      saved.earlierPeriodType = before.earlierPeriodType;
    }
    await this.metrics.saveScore(tx, tenantId, saved);
    await this.config.touch(tx, tenantId, actorId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'score.updated',
      target: { type: 'tenant', id: tenantId },
      before,
      after: saved,
    });
    return this.read(tx, tenantId);
  }
}
