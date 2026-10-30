import { Injectable } from '@nestjs/common';
import {
  AccountListQuery,
  OrderListQuery,
  SEARCH_LIMIT,
  type SearchResult,
  UserListQuery,
} from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { FormsService } from '../forms/forms.service';
import { UsersService } from '../iam/users.service';
import { OrdersService } from '../orders/orders.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** An order's number as people write it: `1042` or `#1042`. */
const ORDER_NUMBER = /^#?\s*(\d{1,9})$/;

/**
 * Search across the product (phase 4 step A1, decision D110): people, accounts, orders and forms,
 * each through its own module's list, which narrows it to the caller's scope as the list does. A
 * kind the caller may not list is null; each holds at most `SEARCH_LIMIT` matches.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly orders: OrdersService,
    private readonly forms: FormsService,
    private readonly config: TenantConfigService,
  ) {}

  async search(tx: TenantTx, access: Access, q: string): Promise<SearchResult> {
    const can = (permission: Parameters<typeof access.permissions.has>[0]) =>
      access.permissions.has(permission);
    const { modulesOff } = await this.config.settings(tx, access.tenantId);
    return {
      people: can('user.view') ? await this.people(tx, access, q) : null,
      accounts: can('account.view') ? await this.places(tx, access, q) : null,
      orders: modulesOff.includes('orders') ? null : await this.ordersNumbered(tx, access, q),
      forms: can('form.manage') ? await this.formsNamed(tx, access.tenantId, q) : null,
    };
  }

  /** People by part of a name, code or mobile number; the answer never carries the number. */
  private async people(tx: TenantTx, access: Access, q: string) {
    const found = await this.users.list(
      tx,
      access,
      UserListQuery.parse({ q, limit: SEARCH_LIMIT }),
    );
    return found.items.map(({ id, code, name, designation, status }) => ({
      id,
      code,
      name,
      designation,
      status,
    }));
  }

  private async places(tx: TenantTx, access: Access, q: string) {
    const found = await this.accounts.list(
      tx,
      access,
      AccountListQuery.parse({ q, limit: SEARCH_LIMIT }),
    );
    return found.items.map(({ id, code, name, type, status }) => ({
      id,
      code,
      name,
      type,
      status,
    }));
  }

  /** The order with that number, if the caller sees it; nothing for words. */
  private async ordersNumbered(tx: TenantTx, access: Access, q: string) {
    const number = ORDER_NUMBER.exec(q)?.[1];
    if (!number) return [];
    const found = await this.orders.list(
      tx,
      access,
      OrderListQuery.parse({ number, limit: SEARCH_LIMIT }),
    );
    return found.items.map(({ id, number: n, account, status, placedAt }) => ({
      id,
      number: n,
      account: { id: account.id, name: account.name },
      status,
      placedAt,
    }));
  }

  /** Forms by part of their name in either language. */
  private async formsNamed(tx: TenantTx, tenantId: string, q: string) {
    const wanted = q.toLocaleLowerCase();
    return (await this.forms.list(tx, tenantId))
      .filter((form) =>
        [form.name.en.one, form.name.en.other, form.name.hi.one, form.name.hi.other].some((name) =>
          name.toLocaleLowerCase().includes(wanted),
        ),
      )
      .slice(0, SEARCH_LIMIT)
      .map((form) => ({ id: form.id, key: form.key, name: form.name }));
  }
}
