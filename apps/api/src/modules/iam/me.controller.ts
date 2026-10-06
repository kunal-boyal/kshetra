import { Controller, Get } from '@nestjs/common';
import type { MeResult } from '@kshetra/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { UsersService } from './users.service';

/** `GET /v1/me` (spec 11.2): who is signed in, and what they may do. */
@Controller('v1')
export class MeController {
  constructor(
    private readonly database: Database,
    private readonly users: UsersService,
  ) {}

  @Get('me')
  @SignedIn()
  me(@CurrentAccess() access: Access): Promise<MeResult> {
    return this.database.forTenant(access.tenantId, (tx) => this.users.me(tx, access));
  }
}
