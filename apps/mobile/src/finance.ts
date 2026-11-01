import { AccountInvoiceListResult, type SyncBalance, scaled, unscaled } from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';
import { useLocalRows } from './local-data';

/**
 * Account finance on the phone (M11, decision D79): each account's latest balance, kept offline
 * for people who may see finance, so a field user knows what to collect and when an order goes
 * over the credit limit.
 */

/** The account's latest balance on the phone; undefined while it loads, null without one. */
export function useBalance(accountId: string): SyncBalance | null | undefined {
  const balances = useLocalRows('balances');
  if (balances === undefined) return undefined;
  return balances.find((balance) => balance.accountId === accountId) ?? null;
}

/** What is left of the credit limit, or null without one; below zero when over it. */
export function creditLeft(balance: SyncBalance): string | null {
  if (balance.creditLimit === null) return null;
  const left = scaled(balance.creditLimit, 2) - scaled(balance.outstanding, 2);
  return left < 0n ? `-${unscaled(-left, 2)}` : unscaled(left, 2);
}

/** Whether an order of this total takes the account past its credit limit, as the server judges. */
export function overCredit(balance: SyncBalance | null | undefined, total: string): boolean {
  if (!balance || balance.creditLimit === null) return false;
  return scaled(balance.outstanding, 2) + scaled(total, 2) > scaled(balance.creditLimit, 2);
}

/**
 * An account's open invoices (BR-51, decision D121), read online, so a field user knows which
 * bills to collect; the phone keeps only the account's balance.
 */
export function useOpenInvoices(accountId: string, enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['open-invoices', accountId],
    queryFn: async () =>
      (await client.request(
        'GET',
        `/v1/accounts/${accountId}/invoices?status=open&limit=20`,
        AccountInvoiceListResult,
      ))!,
    enabled,
  });
}
