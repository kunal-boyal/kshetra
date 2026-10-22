import {
  type MetricDefinition,
  MetricDefinitionsResult,
  type ScoreDefinition,
} from '@kshetra/metrics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

/** Every metric, retired ones too, and the score, for those who change them (M2). */
export function useMetricDefinitions() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['metric-definitions'],
    queryFn: () => read(client, '/v1/metric-definitions', MetricDefinitionsResult),
  });
}

/**
 * Changes to metrics and the score. Each answers the whole set; targets, dashboards and the
 * config read again, as a metric's name or the score's weights show there.
 */
export function useSaveMetrics() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const settle = async (result: MetricDefinitionsResult | undefined) => {
    if (result) queryClient.setQueryData(['metric-definitions'], result);
    await Promise.all(
      ['config', 'targets', 'performance', 'dashboard'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
    return result;
  };
  return {
    create: async (definition: MetricDefinition) =>
      settle(await write(client, 'POST', '/v1/metrics', MetricDefinitionsResult, { definition })),
    update: async (
      key: string,
      change: { definition: MetricDefinition; active: boolean; from: string },
    ) =>
      settle(
        await write(
          client,
          'PUT',
          `/v1/metrics/${encodeURIComponent(key)}`,
          MetricDefinitionsResult,
          change,
        ),
      ),
    score: async (definition: ScoreDefinition) =>
      settle(await write(client, 'PUT', '/v1/score', MetricDefinitionsResult, { definition })),
  };
}
