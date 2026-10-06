import { Body, Controller, Get, Header, HttpCode, Ip, Post } from '@nestjs/common';
import {
  LogoutBody,
  OtpRequestBody,
  OtpVerifyBody,
  RefreshBody,
  SelectTenantBody,
  SwitchTenantBody,
} from '@kshetra/shared';
import { Public } from '../../platform/auth';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { SigningKey } from './signing-key';

/** Sign-in at the directory (spec 11.2, Auth group). Responses carrying tokens are never cached. */
@Public()
@Controller('auth/v1')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly keys: SigningKey,
  ) {}

  @Post('otp/request')
  @HttpCode(202)
  request(@Body() body: unknown, @Ip() address: string) {
    const { phone } = OtpRequestBody.parse(body);
    return this.otp.request(phone, address);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(@Body() body: unknown, @Ip() address: string) {
    const { phone, code, device } = OtpVerifyBody.parse(body);
    return this.otp.verify(phone, code, address, device);
  }

  @Post('select-tenant')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  selectTenant(@Body() body: unknown, @Ip() address: string) {
    const { ticket, tenantId, device } = SelectTenantBody.parse(body);
    return this.sessions.selectTenant(ticket, tenantId, device, address);
  }

  @Post('token/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  refresh(@Body() body: unknown) {
    const { refreshToken } = RefreshBody.parse(body);
    return this.sessions.refresh(refreshToken);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  switchTenant(@Body() body: unknown, @Ip() address: string) {
    const { refreshToken, tenantId, device } = SwitchTenantBody.parse(body);
    return this.sessions.switchTenant(refreshToken, tenantId, device, address);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown): Promise<void> {
    const { refreshToken } = LogoutBody.parse(body);
    await this.sessions.logout(refreshToken);
  }

  /** The public key cells verify access tokens with (spec 9.3). */
  @Get('jwks')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.keys.jwks();
  }
}
