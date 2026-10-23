import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalSubject } from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { RequestTypes } from '../workflow/request-types';
import { AccountTypesService } from './account-types.service';
import { AccountsService } from './accounts.service';

/**
 * The requests accounts send for approval (spec 5.9, decisions D38 and D74): a field user's new
 * account, and a location proposed for an account without a verified one. Accounts also tell the
 * workflow module who fills each account's slots, for chains that route to a slot.
 */
@Injectable()
export class AccountRequests implements OnModuleInit {
  constructor(
    private readonly types: RequestTypes,
    private readonly accounts: AccountsService,
    private readonly accountTypes: AccountTypesService,
  ) {}

  onModuleInit(): void {
    this.types.provideSlots({
      keys: async (tx, tenantId) =>
        new Set(
          (await this.accountTypes.list(tx, tenantId)).flatMap((type) =>
            type.definition.slots.map((slot) => slot.key),
          ),
        ),
      holder: (tx, tenantId, accountId, slot) =>
        this.accounts.slotHolder(tx, tenantId, accountId, slot),
    });
    this.types.register({
      type: 'new_account',
      fallbackPermission: 'account.approve',
      bulk: true,
      subjects: (tx, tenantId, ids) => this.accounts.subjects(tx, tenantId, ids),
      // A withdrawn proposal ends as a rejected one.
      decided: (tx: TenantTx, by: Access, id: string, outcome) =>
        this.accounts.decideAccount(tx, by, id, outcome === 'approved' ? 'approved' : 'rejected'),
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
      decided: (tx, by, id, outcome) =>
        this.accounts.decideLocation(tx, by, id, outcome === 'approved' ? 'approved' : 'rejected'),
    });
  }
}
