import { FormListResult } from '@thelamp/forms';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** Every form, in use or not, at its current version (spec 5.6). */
export function useForms() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['forms'],
    queryFn: async () => (await read(client, '/v1/forms', FormListResult)).items,
  });
}

/** After a publish, the list and the config bundle read again. */
export function useRefreshForms() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['forms'] }),
      queryClient.invalidateQueries({ queryKey: ['config'] }),
    ]);
}
