import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditListResult, IdParams, UserHistoryQuery } from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { AuditService } from './audit.service';

/** A person's history (spec 8.2, user detail), from the audit log. */
@Controller('v1/users')
export class UserHistoryController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @Get(':id/history')
  @Contract({
    tag: 'People',
    summary: 'What changed about a user, newest first',
    params: IdParams,
    query: UserHistoryQuery,
    response: AuditListResult,
  })
  @Requires('user.view')
  history(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const userId = pathId(id);
    const input = UserHistoryQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.audit.history(tx, access, userId, input),
    );
  }
}
