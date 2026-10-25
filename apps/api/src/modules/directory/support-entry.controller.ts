import { Controller, Get, Header, HttpCode, Inject, Query, Req, Res } from '@nestjs/common';
import { SupportEntryQuery } from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { Public } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { CONFIG } from '../../platform/tokens';
import { SupportService } from './support.service';
import { WebCookie } from './web-cookie';

/**
 * Where an entry link from the console lands (decision D93): a browser navigation on the portal's
 * own address, which spends the link's code, starts the support session in the portal's cookie and
 * goes into the portal. A link that expired or was used comes back to sign-in, saying so.
 */
@Public()
@Controller('auth/v1/support')
export class SupportEntryController {
  constructor(
    private readonly support: SupportService,
    private readonly cookie: WebCookie,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('enter')
  @HttpCode(302)
  @Contract({
    tag: 'Sign-in',
    summary: 'Enter the portal as vendor support under a grant',
    query: SupportEntryQuery,
    redirect: 'into the portal',
  })
  @Header('Cache-Control', 'no-store')
  async enter(@Query() query: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      const signedIn = await this.support.enter(SupportEntryQuery.parse(query).code);
      this.cookie.handOver(request, reply, signedIn.session, true);
      return reply.redirect(`${this.config.WEB_URL}/`, 302);
    } catch {
      return reply.redirect(`${this.config.WEB_URL}/sign-in?support=expired`, 302);
    }
  }
}
