import {
  CalendarListResult,
  newId,
  OrganisationResult,
  TenantSettings,
  TerminologyResult,
  type TerminologyOverrides,
  type UpdateSettingsBody,
} from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/**
 * Tenant administration on the web (M2, decision D64): the organisation's name and logo, its
 * settings, and its words. Every change reads the config again, so screens follow at once.
 */

export function useOrganisation() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['organisation'],
    queryFn: () => read(client, '/v1/organisation', OrganisationResult),
    // The logo's link lasts five minutes; read again before it lapses.
    staleTime: 4 * 60_000,
  });
}

export function useTerminology(enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['terminology'],
    queryFn: () => read(client, '/v1/terminology', TerminologyResult),
    enabled,
  });
}

/** Changes after which the config and the organisation read again. */
export function useAdmin() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['config'] }),
      queryClient.invalidateQueries({ queryKey: ['organisation'] }),
      queryClient.invalidateQueries({ queryKey: ['terminology'] }),
    ]);
  const key = () => ({ idempotencyKey: newId() });
  return {
    async saveSettings(patch: UpdateSettingsBody) {
      const saved = await client.request('PATCH', '/v1/settings', TenantSettings, {
        body: patch,
        ...key(),
      });
      await refresh();
      return saved;
    },
    async rename(name: string) {
      await client.request('PATCH', '/v1/organisation', OrganisationResult, {
        body: { name },
        ...key(),
      });
      await refresh();
    },
    async setLogo(file: File) {
      await client.request('PUT', '/v1/organisation/logo', OrganisationResult, {
        file: { data: file, type: file.type },
        ...key(),
      });
      await refresh();
    },
    async removeLogo() {
      await client.request('DELETE', '/v1/organisation/logo', OrganisationResult, key());
      await refresh();
    },
    async saveTerminology(overrides: TerminologyOverrides) {
      await client.request('PUT', '/v1/terminology', TerminologyResult, {
        body: overrides,
        ...key(),
      });
      await refresh();
    },
  };
}

/** The holiday calendars with their holidays of a year (M13). */
export function useCalendars(year?: number) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['calendars', year ?? 'this'],
    queryFn: () => read(client, `/v1/calendars${year ? `?year=${year}` : ''}`, CalendarListResult),
  });
}
