import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AppError, OwnSessionsResult, SessionIdParams } from '@thelamp/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { SessionsService } from './sessions.service';

/**
 * Where a person is signed in to this organisation, and ending those sessions (ASVS V7.5.2,
 * decision D101): on the web and on phones, ending one refuses its access tokens at once. Vendor
 * support and API clients have no sessions of a person's to see.
 */
@SignedIn()
@Controller('auth/v1/sessions')
export class OwnSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  private person(access: Access): string {
    if (access.support || access.apiClient) {
      throw new AppError('FORBIDDEN', 'Only a person has sessions of their own.');
    }
    return access.userId;
  }

  @Get()
  @Contract({
    tag: 'Sign-in',
    summary: 'Where you are signed in to this organisation',
    response: OwnSessionsResult,
  })
  async list(@CurrentAccess() access: Access) {
    const userId = this.person(access);
    return { items: await this.sessions.own(access.tenantId, userId, access.sessionId) };
  }

  @Post(':id/end')
  @HttpCode(204)
  @Contract({ tag: 'Sign-in', summary: 'End one of your sessions', params: SessionIdParams })
  async end(@CurrentAccess() access: Access, @Param() params: unknown): Promise<void> {
    const userId = this.person(access);
    await this.sessions.endOwn(access.tenantId, userId, SessionIdParams.parse(params).id);
  }

  @Post('end-others')
  @HttpCode(204)
  @Contract({ tag: 'Sign-in', summary: 'End every one of your sessions but this one' })
  async endOthers(@CurrentAccess() access: Access): Promise<void> {
    await this.sessions.endOthers(access.tenantId, this.person(access), access.sessionId);
  }
}
