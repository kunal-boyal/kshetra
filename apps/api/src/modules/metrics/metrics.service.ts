import { Injectable } from '@nestjs/common';
import type { MetricDefinition, MetricEntry, ScoreDefinition } from '@thelamp/metrics';
import type { MetricView } from '@thelamp/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { metricDefinitions, scoreDefinitions } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';

/**
 * The tenant's metrics (spec 5.7) and score definition (5.8): from its template at first, then as
 * its admins change them (decision D65), metrics by key. The metric engine computes from them
 * (decision D56). The writes here store what the performance module has checked.
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

  /** Every metric, retired ones too, with its version, for those who edit them. */
  async entries(tx: TenantTx, tenantId: string): Promise<MetricEntry[]> {
    const rows = await tx
      .select({
        definition: metricDefinitions.definition,
        active: metricDefinitions.active,
        version: metricDefinitions.version,
      })
      .from(metricDefinitions)
      .where(eq(metricDefinitions.tenantId, tenantId))
      .orderBy(asc(metricDefinitions.key));
    return rows;
  }

  async insert(tx: TenantTx, tenantId: string, definition: MetricDefinition): Promise<void> {
    await tx.insert(metricDefinitions).values({
      tenantId,
      key: definition.key,
      definition,
      targetable: definition.targetable,
    });
  }

  /** A metric's next version: its definition, and whether it is still in use. */
  async replace(
    tx: TenantTx,
    tenantId: string,
    definition: MetricDefinition,
    active: boolean,
  ): Promise<void> {
    await tx
      .update(metricDefinitions)
      .set({
        definition,
        active,
        targetable: definition.targetable,
        version: sql`${metricDefinitions.version} + 1`,
      })
      .where(
        and(eq(metricDefinitions.tenantId, tenantId), eq(metricDefinitions.key, definition.key)),
      );
  }

  /** The score's next version, or its first. */
  async saveScore(tx: TenantTx, tenantId: string, definition: ScoreDefinition): Promise<void> {
    await tx
      .insert(scoreDefinitions)
      .values({ tenantId, definition })
      .onConflictDoUpdate({
        target: scoreDefinitions.tenantId,
        set: { definition, version: sql`${scoreDefinitions.version} + 1` },
      });
  }
}
