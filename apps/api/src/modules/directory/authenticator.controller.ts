import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  AppError,
  AuthenticatorCodeBody,
  AuthenticatorConfirmResult,
  AuthenticatorStatus,
  needsSecondFactor,
  TotpSetupResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { SecondFactorService } from './second-factor.service';

/**
 * A person's own authenticator, from their account on the web (decision D101): anyone may set one
 * up, and the web then always asks for it; an admin's role needs one anyway and can't remove it.
 * Phones, vendor support and API clients have none to manage.
 */
@SignedIn()
@Controller('auth/v1/authenticator')
export class AuthenticatorController {
  constructor(private readonly secondFactors: SecondFactorService) {}

  private person(access: Access): string {
    if (access.support || access.apiClient || access.deviceId) {
      throw new AppError('FORBIDDEN', 'Manage your authenticator from the web portal.');
    }
    return access.userId;
  }

  @Get()
  @Contract({
    tag: 'Sign-in',
    summary: 'Whether you have an authenticator, and whether your role needs one',
    response: AuthenticatorStatus,
  })
  async status(@CurrentAccess() access: Access) {
    const userId = this.person(access);
    return {
      enrolled: await this.secondFactors.ownStatus(access.tenantId, userId),
      required: needsSecondFactor(access.permissions),
    };
  }

  @Post('setup')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Start setting up an authenticator: its secret, for a QR code',
    response: TotpSetupResult,
  })
  setup(@CurrentAccess() access: Access) {
    return this.secondFactors.ownSetup(access.tenantId, this.person(access));
  }

  @Post('confirm')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Confirm a new authenticator with its first code, for the recovery codes',
    body: AuthenticatorCodeBody,
    response: AuthenticatorConfirmResult,
  })
  async confirm(@CurrentAccess() access: Access, @Body() body: unknown) {
    const { code } = AuthenticatorCodeBody.parse(body);
    const recoveryCodes = await this.secondFactors.ownConfirm(
      access.tenantId,
      this.person(access),
      code,
    );
    return { recoveryCodes };
  }

  @Post('remove')
  @HttpCode(204)
  @Contract({
    tag: 'Sign-in',
    summary: 'Remove your authenticator, with a code from it, where your role doesn’t need one',
    body: AuthenticatorCodeBody,
  })
  async remove(@CurrentAccess() access: Access, @Body() body: unknown) {
    const userId = this.person(access);
    if (needsSecondFactor(access.permissions)) {
      throw new AppError('CONFLICT', 'Your role needs an authenticator, so it stays.');
    }
    const { code } = AuthenticatorCodeBody.parse(body);
    await this.secondFactors.ownRemove(access.tenantId, userId, code);
  }
}
