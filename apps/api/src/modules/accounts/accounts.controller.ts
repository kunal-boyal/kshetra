import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AccountListQuery,
  AccountListResult,
  AccountOverview,
  AccountResult,
  ContactResult,
  CreateAccountBody,
  CreateContactBody,
  CreateLocationProposalBody,
  IdParams,
  LocationProposalResult,
  UpdateAccountBody,
  UpdateContactBody,
} from '@kshetra/shared';
import { z } from 'zod';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { AccountsService } from './accounts.service';

const ContactParams = z.strictObject({ id: z.uuid(), contactId: z.uuid() });

/**
 * Accounts (spec 11.2, M4). Records made on a phone carry their own IDs, so a resend with the same
 * content returns what the first one made, and different content is refused (BR-46).
 */
@Controller('v1/accounts')
export class AccountsController {
  constructor(
    private readonly database: Database,
    private readonly accounts: AccountsService,
  ) {}

  @Get()
  @Contract({
    tag: 'Accounts',
    summary: 'The accounts the caller sees, a page at a time',
    query: AccountListQuery,
    response: AccountListResult,
  })
  @Requires('account.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = AccountListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.accounts.list(tx, access, input));
  }

  @Post()
  @Contract({
    tag: 'Accounts',
    summary: 'Add an account, or propose one from the field',
    body: CreateAccountBody,
    response: AccountResult,
  })
  @RequiresAny('account.manage', 'account.propose')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateAccountBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `account:${input.id}`,
        { route: 'POST /v1/accounts', by: access.userId, input },
        async () => ({ status: 201, body: await this.accounts.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get(':id/overview')
  @Contract({
    tag: 'Accounts',
    summary: 'An account with its contacts, assignments and proposals',
    params: IdParams,
    response: AccountOverview,
  })
  @Requires('account.view')
  overview(@CurrentAccess() access: Access, @Param('id') id: string) {
    const accountId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.accounts.overview(tx, access, accountId),
    );
  }

  @Patch(':id')
  @Contract({
    tag: 'Accounts',
    summary: 'Change an account: its details, location, status, or who fills its slots from a day',
    params: IdParams,
    body: UpdateAccountBody,
    response: AccountResult,
  })
  @Requires('account.manage')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const accountId = pathId(id);
    const input = UpdateAccountBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.accounts.update(tx, access, accountId, input),
    );
  }

  @Post(':id/contacts')
  @Contract({
    tag: 'Accounts',
    summary: 'Add a contact person to an account',
    params: IdParams,
    body: CreateContactBody,
    response: ContactResult,
  })
  @Requires('account.manage')
  @HttpCode(201)
  async addContact(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const accountId = pathId(id);
    const input = CreateContactBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `contact:${input.id}`,
        { route: 'POST /v1/accounts/:id/contacts', by: access.userId, accountId, input },
        async () => ({
          status: 201,
          body: await this.accounts.addContact(tx, access, accountId, input),
        }),
      ),
    );
    return result.body;
  }

  @Patch(':id/contacts/:contactId')
  @Contract({
    tag: 'Accounts',
    summary: 'Change a contact, or switch it off',
    params: ContactParams,
    body: UpdateContactBody,
    response: ContactResult,
  })
  @Requires('account.manage')
  changeContact(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    const accountId = pathId(id);
    const contact = pathId(contactId);
    const input = UpdateContactBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.accounts.changeContact(tx, access, accountId, contact, input),
    );
  }

  @Post(':id/location-proposals')
  @Contract({
    tag: 'Accounts',
    summary: "Propose an account's location, standing at it",
    params: IdParams,
    body: CreateLocationProposalBody,
    response: LocationProposalResult,
  })
  @Requires('account.propose_location')
  @HttpCode(201)
  async proposeLocation(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const accountId = pathId(id);
    const input = CreateLocationProposalBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `location-proposal:${input.id}`,
        { route: 'POST /v1/accounts/:id/location-proposals', by: access.userId, accountId, input },
        async () => ({
          status: 201,
          body: await this.accounts.proposeLocation(tx, access, accountId, input),
        }),
      ),
    );
    return result.body;
  }
}
