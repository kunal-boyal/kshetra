import { type AccountType, AccountTypeListResult, AccountTypeView } from '@thelamp/forms';
import { newId } from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** Every account type at its current version, with its ID, for those who edit them (M2). */
export function useTypeList() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-types'],
    queryFn: async () => (await read(client, '/v1/account-types', AccountTypeListResult)).items,
  });
}

/** Adds a type, or publishes the next version of one; the config reads again after. */
export function useSaveType() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (definition: AccountType, id?: string) => {
    const saved = id
      ? await client.request('POST', `/v1/account-types/${id}/versions`, AccountTypeView, {
          body: { definition },
          idempotencyKey: newId(),
        })
      : await client.request('POST', '/v1/account-types', AccountTypeView, {
          body: { id: newId(), definition },
          idempotencyKey: newId(),
        });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['account-types'] }),
      queryClient.invalidateQueries({ queryKey: ['config'] }),
    ]);
    return saved!;
  };
}
