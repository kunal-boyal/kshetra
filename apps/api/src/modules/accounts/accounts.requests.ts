import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalSubject } from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { RequestTypes } from '../workflow/request-types';
import { AccountsService } from './accounts.service';

/**
 * The requests accounts send for approval (spec 5.9, decision D38): a field user's new account,
 * and a location proposed for an account without a verified one. Without a manager, they go to
 * whoever may approve accounts across the tenant.
 */
@Injectable()
export class AccountRequests implements OnModuleInit {
  constructor(
    private readonly types: RequestTypes,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.types.register({
      type: 'new_account',
      fallbackPermission: 'account.approve',
      subjects: (tx, tenantId, ids) => this.accounts.subjects(tx, tenantId, ids),
      decided: (tx: TenantTx, by: Access, id: string, outcome) =>
        this.accounts.decideAccount(tx, by, id, outcome),
    });
    this.types.register({
      type: 'account_location_change',
      fallbackPermission: 'account.approve',
      subjects: async (tx, tenantId, ids) => {
        const proposals = await this.accounts.proposalsOf(tx, tenantId, { ids });
        const accounts = await this.accounts.subjects(
          tx,
          tenantId,
          proposals.map((proposal) => proposal.accountId),
        );
        return new Map<string, ApprovalSubject>(
          proposals.flatMap((proposal) => {
            const account = accounts.get(proposal.accountId);
            return account ? [[proposal.id, account]] : [];
          }),
        );
      },
      decided: (tx, by, id, outcome) => this.accounts.decideLocation(tx, by, id, outcome),
    });
  }
}
