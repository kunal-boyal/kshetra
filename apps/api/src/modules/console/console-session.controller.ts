import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ClientIp } from '../../platform/client-address';
import {
  AppError,
  CONSOLE_CLIENT,
  InviteStaffBody,
  InviteStaffResult,
  StaffConfirmBody,
  StaffIdParams,
  StaffListResult,
  StaffResult,
  StaffSession,
  StaffSetupBody,
  StaffSetupResult,
  StaffSignInBody,
  WEB_CLIENT_HEADER,
} from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { CurrentStaff, ForStaff, Public, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { sessionCookie } from '../../platform/session-cookie';
import { CONFIG } from '../../platform/tokens';
import { STAFF_SESSION_HOURS, StaffService } from './staff.service';

/**
 * Vendor staff in the platform console (module M22, decision D88): setting up from an
 * invitation, signing in with email, password and an authenticator code, the session, and the
 * staff list. As on the web, the refresh token lives in an httpOnly, SameSite=Strict cookie,
 * `__Host-` in production (decision D101), and a request relying on it must carry the console's client header.
 */
@Controller('platform/v1')
export class ConsoleSessionController {
  private readonly cookieName: string;

  constructor(
    private readonly staff: StaffService,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    this.cookieName = sessionCookie(config, 'console').name;
  }

  @Public()
  @Post('setup')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Set a password from an invitation, and get the authenticator secret',
    body: StaffSetupBody,
    response: StaffSetupResult,
  })
  @Header('Cache-Control', 'no-store')
  setUp(@Body() body: unknown, @ClientIp() ip: string) {
    const { token, password } = StaffSetupBody.parse(body);
    return this.staff.setUp(token, password, ip);
  }

  @Public()
  @Post('setup/confirm')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Confirm the authenticator with a first code',
    body: StaffConfirmBody,
    response: StaffResult,
  })
  confirm(@Body() body: unknown, @ClientIp() ip: string) {
    const { token, code } = StaffConfirmBody.parse(body);
    return this.staff.confirm(token, code, ip);
  }

  @Public()
  @Post('session')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Sign in with email, password and an authenticator code',
    body: StaffSignInBody,
    response: StaffSession,
  })
  @Header('Cache-Control', 'no-store')
  async signIn(
    @Body() body: unknown,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { email, password, code } = StaffSignInBody.parse(body);
    const { session, refreshToken } = await this.staff.signIn(email, password, code, ip);
    void reply.setCookie(this.cookieName, refreshToken, this.cookieOptions());
    return session;
  }

  @Public()
  @Post('session/refresh')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Spend the session cookie for a new access token',
    response: StaffSession,
  })
  @Header('Cache-Control', 'no-store')
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { session, refreshToken } = await this.staff.refresh(this.cookie(request));
    void reply.setCookie(this.cookieName, refreshToken, this.cookieOptions());
    return session;
  }

  @Public()
  @Post('session/logout')
  @HttpCode(204)
  @Contract({ tag: 'Platform console', summary: 'End the console session' })
  async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies[this.cookieName];
    if (token && isConsole(request)) await this.staff.signOut(token);
    void reply.clearCookie(this.cookieName, this.cookieOptions());
  }

  @ForStaff()
  @Get('me')
  @Contract({ tag: 'Platform console', summary: 'Who is signed in', response: StaffResult })
  me(@CurrentStaff() staff: StaffAccess) {
    return this.staff.me(staff);
  }

  @ForStaff('platform.staff.manage')
  @Get('staff')
  @Contract({ tag: 'Platform console', summary: 'List vendor staff', response: StaffListResult })
  async list() {
    return { items: await this.staff.list() };
  }

  @ForStaff('platform.staff.manage')
  @Post('staff')
  @HttpCode(201)
  @Contract({
    tag: 'Platform console',
    summary: 'Invite a staff member; the setup link is shown once',
    body: InviteStaffBody,
    response: InviteStaffResult,
  })
  @Header('Cache-Control', 'no-store')
  invite(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.staff.invite(InviteStaffBody.parse(body), staff);
  }

  @ForStaff('platform.staff.manage')
  @Post('staff/:id/disable')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Disable a staff member for good, ending their sessions',
    params: StaffIdParams,
    response: StaffResult,
  })
  disable(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.staff.disable(staff, StaffIdParams.parse(params).id);
  }

  /** The session cookie, only for the console's own requests (see the class comment). */
  private cookie(request: FastifyRequest): string {
    const token = request.cookies[this.cookieName];
    if (!token || !isConsole(request)) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return token;
  }

  private cookieOptions() {
    return { ...sessionCookie(this.config, 'console').options, maxAge: STAFF_SESSION_HOURS * 3600 };
  }
}

function isConsole(request: FastifyRequest): boolean {
  return request.headers[WEB_CLIENT_HEADER] === CONSOLE_CLIENT;
}
