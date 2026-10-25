import { and, eq } from 'drizzle-orm';
import { externalMetricValues } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';

/** The values credited to a person on a day, for the metric engine. */
export async function externalValuesFor(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  date: string,
): Promise<{ metricKey: string; value: string }[]> {
  return tx
    .select({ metricKey: externalMetricValues.metricKey, value: externalMetricValues.value })
    .from(externalMetricValues)
    .where(
      and(
        eq(externalMetricValues.tenantId, tenantId),
        eq(externalMetricValues.creditedUserId, userId),
        eq(externalMetricValues.date, date),
      ),
    );
}
