import { Injectable } from '@nestjs/common';
import type { MetricDefinition } from '@kshetra/metrics';
import type { MetricView } from '@kshetra/shared';
import { and, asc, eq } from 'drizzle-orm';
import { metricDefinitions } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';

/**
 * The tenant's metrics (spec 5.7): each definition as the tenant's template gave it, by key. The
 * metric engine computes from them (step 12); changing them comes with tenant administration
 * (step 16, decision D55).
 */
@Injectable()
export class MetricsService {
  /** Stores a template's metrics for a tenant; those it holds already stay as they are. */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    definitions: readonly MetricDefinition[],
  ): Promise<void> {
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

  /** The tenant's metrics in use, by key. */
  async list(tx: TenantTx, tenantId: string): Promise<MetricView[]> {
    const rows = await tx
      .select({ definition: metricDefinitions.definition })
      .from(metricDefinitions)
      .where(and(eq(metricDefinitions.tenantId, tenantId), eq(metricDefinitions.active, true)))
      .orderBy(asc(metricDefinitions.key));
    return rows.map(({ definition }) => ({
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
