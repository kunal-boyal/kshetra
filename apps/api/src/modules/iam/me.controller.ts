import { Controller, Get } from '@nestjs/common';
import type { MeResult } from '@kshetra/shared';
import { type AuthContext, CurrentAuth } from '../../platform/auth';

/** `GET /v1/me` (spec 11.2): who the token belongs to. The user's profile joins with IAM. */
@Controller('v1')
export class MeController {
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): MeResult {
    return { userId: auth.userId, tenantId: auth.tenantId, cell: auth.cell };
  }
}
