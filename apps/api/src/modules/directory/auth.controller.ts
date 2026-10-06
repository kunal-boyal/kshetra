import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  AppError,
  LogoutBody,
  OtpRequestBody,
  OtpVerifyBody,
  RefreshBody,
  SelectTenantBody,
  type Session,
  SwitchTenantBody,
  WEB_CLIENT,
  WEB_CLIENT_HEADER,
} from '@kshetra/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { Public } from '../../platform/auth';
import { CONFIG } from '../../platform/tokens';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { SigningKey } from './signing-key';

const COOKIE_PATH = '/auth/v1';

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
  /** The refresh cookie's name, from the product slug. */
  private readonly cookieName: string;

  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly keys: SigningKey,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    this.cookieName = `${config.PRODUCT_SLUG.replace(/-/g, '_')}_refresh`;
  }

  @Post('otp/request')
  @HttpCode(202)
  request(@Body() body: unknown, @Ip() address: string) {
    const { phone } = OtpRequestBody.parse(body);
    return this.otp.request(phone, address);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verify(
    @Body() body: unknown,
    @Ip() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { phone, code, device } = OtpVerifyBody.parse(body);
    const result = await this.otp.verify(phone, code, address, device);
    return result.status === 'signed_in'
      ? { ...result, session: this.handOver(request, reply, result.session) }
      : result;
  }

  @Post('select-tenant')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async selectTenant(
    @Body() body: unknown,
    @Ip() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { ticket, tenantId, device } = SelectTenantBody.parse(body);
    const result = await this.sessions.selectTenant(ticket, tenantId, device, address);
    return { ...result, session: this.handOver(request, reply, result.session) };
  }

  @Post('token/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { refreshToken } = RefreshBody.parse(body ?? {});
    const result = await this.sessions.refresh(this.refreshToken(request, refreshToken));
    return { ...result, session: this.handOver(request, reply, result.session) };
  }

  @Post('switch-tenant')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async switchTenant(
    @Body() body: unknown,
    @Ip() address: string,
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
    return { ...result, session: this.handOver(request, reply, result.session) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { refreshToken } = LogoutBody.parse(body ?? {});
    const token = refreshToken ?? (isWeb(request) ? this.cookie(request) : undefined);
    if (token) await this.sessions.logout(token);
    if (isWeb(request)) void reply.clearCookie(this.cookieName, this.cookieOptions());
  }

  /** The public key cells verify access tokens with (spec 9.3). */
  @Get('jwks')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.keys.jwks();
  }

  private cookie(request: FastifyRequest): string | undefined {
    return request.cookies[this.cookieName];
  }

  /** The cookie's attributes, the same when it is set and when it is cleared. */
  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.config.NODE_ENV === 'production',
      path: COOKIE_PATH,
    };
  }

  /** The refresh token from the body, or from the web's cookie when the request says it is the web. */
  private refreshToken(request: FastifyRequest, fromBody: string | undefined): string {
    const token = fromBody ?? (isWeb(request) ? this.cookie(request) : undefined);
    if (!token) throw new AppError('SESSION_REVOKED', 'Your session has ended. Sign in again.');
    return token;
  }

  /** For the web, moves the refresh token out of the body into the cookie. */
  private handOver(request: FastifyRequest, reply: FastifyReply, session: Session): Session {
    if (!isWeb(request) || !session.refreshToken) return session;
    void reply.setCookie(this.cookieName, session.refreshToken, {
      ...this.cookieOptions(),
      expires: new Date(session.refreshTokenExpiresAt),
    });
    return {
      tokenType: session.tokenType,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    };
  }
}

function isWeb(request: FastifyRequest): boolean {
  return request.headers[WEB_CLIENT_HEADER] === WEB_CLIENT;
}
