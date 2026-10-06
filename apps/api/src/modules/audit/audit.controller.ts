import { Controller, Get, Query } from '@nestjs/common';
import { AuditListQuery, type AuditListResult } from '@kshetra/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { AuditService } from './audit.service';

/** `GET /v1/audit` (spec 11.2): the audit log, newest first. */
@Controller('v1/audit')
export class AuditController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Requires('audit.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown): Promise<AuditListResult> {
    const input = AuditListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.audit.list(tx, access, input));
  }
}
