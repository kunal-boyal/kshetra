import { type ChainView, type WorkflowStep, WorkflowsResult } from '@thelamp/forms';
import type { RequestType } from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

const ChainResult = WorkflowsResult.shape.chains.element;

/** Every request type's approval chain and the fallback role (spec 5.9, decision D74). */
export function useChains() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => read(client, '/v1/workflows', WorkflowsResult),
  });
}

/** Saves a chain as its next version, or the fallback role; the chains read again after. */
export function useSaveChains() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workflows'] });
  return {
    chain: async (
      type: RequestType,
      steps: WorkflowStep[],
      version: number,
    ): Promise<ChainView> => {
      const saved = await write(client, 'PUT', `/v1/workflows/${type}`, ChainResult, {
        steps,
        version,
      });
      await refresh();
      return saved!;
    },
    fallback: async (role: string) => {
      await write(client, 'PUT', '/v1/workflows/fallback', WorkflowsResult, { role });
      await refresh();
    },
  };
}
