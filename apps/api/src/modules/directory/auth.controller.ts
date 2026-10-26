import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ClientIp } from '../../platform/client-address';
import {
  AppError,
  JwksResult,
  LogoutBody,
  OtpRequestBody,
  OtpRequestResult,
  OtpVerifyBody,
  OtpVerifyResult,
  RefreshBody,
  RefreshResult,
  SelectTenantBody,
  SelectTenantResult,
  SignedIn,
  SwitchTenantBody,
  TotpSetupBody,
  TotpSetupResult,
  TotpVerifyBody,
  TotpVerifyResult,
} from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { OtpService } from './otp.service';
import { SecondFactorService } from './second-factor.service';
import { SessionsService } from './sessions.service';
import { SigningKey } from './signing-key';
import { isWeb, WebCookie } from './web-cookie';

/**
 * Sign-in at the directory (spec 11.2, Auth group). Responses carrying tokens are never cached.
 *
 * The mobile app keeps its refresh token in the phone's secure store, so it travels in bodies. The
 * web never sees its refresh token (spec 13.1): it lives in an httpOnly, SameSite=Strict cookie
 * scoped to these routes. A request that relies on the cookie must carry the web client header,
 * which a page on another site can't send without passing the CORS allowlist, so the cookie can't
 * be ridden by a forged request.
 */
@Public()
@Controller('auth/v1')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly secondFactor: SecondFactorService,
    private readonly keys: SigningKey,
    private readonly cookie: WebCookie,
  ) {}

  @Post('otp/request')
  @HttpCode(202)
  @Contract({
    tag: 'Sign-in',
    summary: 'Send a one-time code to a mobile number',
    body: OtpRequestBody,
    response: OtpRequestResult,
  })
  request(@Body() body: unknown, @ClientIp() address: string) {
    const { phone } = OtpRequestBody.parse(body);
    return this.otp.request(phone, address);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Sign in with the code, or get a ticket to choose a tenant',
    body: OtpVerifyBody,
    response: OtpVerifyResult,
  })
  @Header('Cache-Control', 'no-store')
  async verify(
    @Body() body: unknown,
    @ClientIp() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { phone, code, device } = OtpVerifyBody.parse(body);
    const result = await this.otp.verify(phone, code, address, device);
    return result.status === 'signed_in'
      ? { ...result, session: await this.cookie.handOver(request, reply, result.session) }
      : result;
  }

  @Post('select-tenant')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Choose a tenant with the ticket from the code',
    body: SelectTenantBody,
    response: SelectTenantResult,
  })
  @Header('Cache-Control', 'no-store')
  async selectTenant(
    @Body() body: unknown,
    @ClientIp() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { ticket, tenantId, device } = SelectTenantBody.parse(body);
    const result = await this.sessions.selectTenant(ticket, tenantId, device, address);
    return result.status === 'signed_in'
      ? { ...result, session: await this.cookie.handOver(request, reply, result.session) }
      : result;
  }

  @Post('totp/setup')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'A new authenticator secret, at the first sign-in that needs one',
    body: TotpSetupBody,
    response: TotpSetupResult,
  })
  @Header('Cache-Control', 'no-store')
  totpSetup(@Body() body: unknown) {
    return this.secondFactor.setup(TotpSetupBody.parse(body).ticket);
  }

  @Post('totp/verify')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Sign in with the authenticator code, or a recovery code',
    body: TotpVerifyBody,
    response: TotpVerifyResult,
  })
  @Header('Cache-Control', 'no-store')
  async totpVerify(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { ticket, code, recoveryCode } = TotpVerifyBody.parse(body);
    const result = await this.secondFactor.verify(ticket, { code, recoveryCode });
    return { ...result, session: await this.cookie.handOver(request, reply, result.session) };
  }

  @Post('token/refresh')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Spend a refresh token for a new pair',
    body: RefreshBody,
    response: RefreshResult,
  })
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { refreshToken } = RefreshBody.parse(body ?? {});
    const result = await this.sessions.refresh(this.refreshToken(request, refreshToken));
    return {
      ...result,
      session: await this.cookie.handOver(request, reply, result.session, { endPrevious: false }),
    };
  }

  @Post('switch-tenant')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: "Switch to another of the person's tenants",
    body: SwitchTenantBody,
    response: SignedIn,
  })
  @Header('Cache-Control', 'no-store')
  async switchTenant(
    @Body() body: unknown,
    @ClientIp() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { refreshToken, tenantId, device } = SwitchTenantBody.parse(body);
    const result = await this.sessions.switchTenant(
      this.refreshToken(request, refreshToken),
      tenantId,
      device,
      address,
    );
    return { ...result, session: await this.cookie.handOver(request, reply, result.session) };
  }

  @Post('logout')
  @HttpCode(204)
  @Contract({ tag: 'Sign-in', summary: 'End the session', body: LogoutBody })
  async logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { refreshToken } = LogoutBody.parse(body ?? {});
    const token = refreshToken ?? (isWeb(request) ? this.cookie.read(request) : undefined);
    if (token) await this.sessions.logout(token);
    if (isWeb(request)) this.cookie.clear(reply);
  }

  /** The public key cells verify access tokens with (spec 9.3). */
  @Get('jwks')
  @Contract({
    tag: 'Sign-in',
    summary: 'The public keys access tokens are signed with',
    response: JwksResult,
  })
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.keys.jwks();
  }

  /** The refresh token from the body, or from the web's cookie when the request says it is the web. */
  private refreshToken(request: FastifyRequest, fromBody: string | undefined): string {
    const token = fromBody ?? (isWeb(request) ? this.cookie.read(request) : undefined);
    if (!token) throw new AppError('SESSION_REVOKED', 'Your session has ended. Sign in again.');
    return token;
  }
}
