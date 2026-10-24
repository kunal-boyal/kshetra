import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import {
  CreateLeaveRequestBody,
  LeaveBalanceQuery,
  LeaveBalanceResult,
  LeaveRequestListQuery,
  LeaveRequestListResult,
  LeaveRequestResult,
  LeaveTypeListResult,
  LeaveTypesBody,
} from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, InModule, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';

/** Leave types, requests and balances (M13, spec 11.2, decision D81). */
@Controller('v1')
export class LeaveController {
  constructor(
    private readonly database: Database,
    private readonly types: LeaveTypesService,
    private readonly requests: LeaveRequestsService,
  ) {}

  @Get('leave-types')
  @Contract({
    tag: 'Leave',
    summary: 'The leave types, in order',
    response: LeaveTypeListResult,
  })
  @SignedIn()
  @InModule('leave_attendance')
  async listTypes(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.types.list(tx, access.tenantId),
      ),
    };
  }

  @Put('leave-types')
  @Contract({
    tag: 'Leave',
    summary: 'Replace the leave types; every type kept stays, switched off if no longer used',
    body: LeaveTypesBody,
    response: LeaveTypeListResult,
  })
  @Requires('leave_type.manage')
  replaceTypes(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = LeaveTypesBody.parse(body);
    return this.database.forTenant(access.tenantId, async (tx) => {
      await this.types.replace(tx, access.tenantId, userActor(access), input.items);
      return { items: await this.types.list(tx, access.tenantId) };
    });
  }

  @Post('leave-requests')
  @Contract({
    tag: 'Leave',
    summary: 'Ask for leave',
    body: CreateLeaveRequestBody,
    response: LeaveRequestResult,
  })
  @Requires('leave.request')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateLeaveRequestBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `leave_request:${input.id}`,
        { route: 'POST /v1/leave-requests', by: access.userId, input },
        async () => ({ status: 201, body: await this.requests.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get('leave-requests')
  @Contract({
    tag: 'Leave',
    summary: "A person's leave requests starting in a year",
    query: LeaveRequestListQuery,
    response: LeaveRequestListResult,
  })
  @SignedIn()
  @InModule('leave_attendance')
  listRequests(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = LeaveRequestListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.requests.list(tx, access, input));
  }

  @Get('leave-balances')
  @Contract({
    tag: 'Leave',
    summary: "A person's balance of each active leave type, in the quota year of a day",
    query: LeaveBalanceQuery,
    response: LeaveBalanceResult,
  })
  @SignedIn()
  @InModule('leave_attendance')
  balances(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = LeaveBalanceQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.requests.balances(tx, access, input),
    );
  }
}
