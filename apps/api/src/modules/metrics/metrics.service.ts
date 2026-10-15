import { Injectable } from '@nestjs/common';
import type { MetricDefinition, ScoreDefinition } from '@kshetra/metrics';
import type { MetricView } from '@kshetra/shared';
import { and, asc, eq } from 'drizzle-orm';
import { metricDefinitions, scoreDefinitions } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';

/**
 * The tenant's metrics (spec 5.7) and score definition (5.8): each as the tenant's template gave
 * it, metrics by key. The metric engine computes from them (decision D56); changing them comes with
 * tenant administration (step 16, decision D55).
 */
@Injectable()
export class MetricsService {
  /**
   * Stores a template's metrics and score definition for a tenant; what it holds already stays
   * as it is.
   */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    definitions: readonly MetricDefinition[],
    score?: ScoreDefinition,
  ): Promise<void> {
    if (score) {
      await tx
        .insert(scoreDefinitions)
        .values({ tenantId, definition: score })
        .onConflictDoNothing();
    }
    if (definitions.length === 0) return;
    await tx
      .insert(metricDefinitions)
      .values(
        definitions.map((definition) => ({
          tenantId,
          key: definition.key,
          definition,
          targetable: definition.targetable,
        })),
      )
      .onConflictDoNothing();
  }

  /** The whole definitions of the tenant's metrics in use, by key. */
  async definitions(tx: TenantTx, tenantId: string): Promise<MetricDefinition[]> {
    const rows = await tx
      .select({ definition: metricDefinitions.definition })
      .from(metricDefinitions)
      .where(and(eq(metricDefinitions.tenantId, tenantId), eq(metricDefinitions.active, true)))
      .orderBy(asc(metricDefinitions.key));
    return rows.map((row) => row.definition);
  }

  /** The tenant's score definition, if it has one. */
  async score(tx: TenantTx, tenantId: string): Promise<ScoreDefinition | null> {
    const [row] = await tx
      .select({ definition: scoreDefinitions.definition })
      .from(scoreDefinitions)
      .where(eq(scoreDefinitions.tenantId, tenantId));
    return row?.definition ?? null;
  }

  /** The tenant's metrics in use, by key. */
  async list(tx: TenantTx, tenantId: string): Promise<MetricView[]> {
    return (await this.definitions(tx, tenantId)).map((definition) => ({
      key: definition.key,
      name: definition.name,
      unit: definition.unit,
      direction: definition.direction,
      targetable: definition.targetable,
    }));
  }

  /** The metrics that carry targets and account plans. */
  async targetable(tx: TenantTx, tenantId: string): Promise<MetricView[]> {
    return (await this.list(tx, tenantId)).filter((metric) => metric.targetable);
  }
}
