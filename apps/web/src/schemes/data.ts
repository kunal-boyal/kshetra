import {
  AccountSchemesResult,
  type SchemeBody,
  SchemeListResult,
  SchemeResult,
} from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

/** Every scheme, in use first, for those who manage them (BR-55, decision D127). */
export function useSchemes(enabled = true) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['schemes'],
    queryFn: async () => (await read(client, '/v1/schemes', SchemeListResult)).items,
    enabled,
  });
}

/** The schemes that may reach an account's orders today, for the order desk. */
export function useAccountSchemes(accountId: string | undefined) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-schemes', accountId],
    queryFn: () => read(client, `/v1/accounts/${accountId}/schemes`, AccountSchemesResult),
    enabled: accountId !== undefined,
  });
}

/** Adds or changes a scheme; the list and the order desk's schemes read again after. */
export function useSaveScheme() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (
    id: string,
    body: Partial<SchemeBody> & Pick<SchemeBody, 'key' | 'name' | 'kind' | 'rule' | 'validFrom'>,
  ) => {
    const scheme = await write(client, 'PUT', `/v1/schemes/${id}`, SchemeResult, body);
    await Promise.all(
      ['schemes', 'account-schemes'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
    return scheme;
  };
}
