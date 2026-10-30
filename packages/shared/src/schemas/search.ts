import { z } from 'zod';
import { AccountStatus } from './accounts';
import { Key, LocalizedNoun } from './config';
import { UserStatus } from './iam';
import { OrderStatus } from './orders';

/** The most matches of each kind a search returns (D110). */
export const SEARCH_LIMIT = 5;

/** `GET /v1/search`: part of a name, code or mobile number, or an order's number. */
export const SearchQuery = z.strictObject({
  q: z.string().trim().min(2).max(100),
});

/**
 * What a search finds, each kind within the caller's scope (D110). A kind the caller may not list
 * (a permission they lack, or a module switched off) is null rather than empty. People carry no
 * contact details, though a mobile number finds them.
 */
export const SearchResult = z
  .object({
    people: z
      .array(
        z.object({
          id: z.uuid(),
          code: z.string(),
          name: z.string(),
          designation: Key,
          status: UserStatus,
        }),
      )
      .nullable(),
    accounts: z
      .array(
        z.object({
          id: z.uuid(),
          code: z.string(),
          name: z.string(),
          type: Key,
          status: AccountStatus,
        }),
      )
      .nullable(),
    orders: z
      .array(
        z.object({
          id: z.uuid(),
          number: z.int(),
          account: z.object({ id: z.uuid(), name: z.string() }),
          status: OrderStatus,
          placedAt: z.iso.datetime({ offset: true }),
        }),
      )
      .nullable(),
    forms: z.array(z.object({ id: z.uuid(), key: Key, name: LocalizedNoun })).nullable(),
  })
  .meta({ id: 'SearchResult' });

export type SearchQuery = z.output<typeof SearchQuery>;
export type SearchResult = z.output<typeof SearchResult>;
