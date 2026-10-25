import { Injectable, Module } from '@nestjs/common';
import type { Config } from '../../config';
import { TokenKeys } from '../../platform/auth';
import { CONFIG } from '../../platform/tokens';
import {
  AnnouncementsConsoleController,
  AnnouncementsController,
  CellHealthController,
} from './announcements.controller';
import { CellHealthService } from './cell-health.service';
import { AnnouncementsService } from './announcements.service';
import { AuthController } from './auth.controller';
import { DirectoryDatabase } from './directory.database';
import { DirectoryMembers } from './members';
import { OtpService } from './otp.service';
import { msg91Settings } from '../../platform/msg91';
import {
  ConsoleOtpSender,
  MailpitOtpSender,
  MemoryOtpSender,
  Msg91OtpSender,
  NoOtpSender,
  OtpSender,
} from './otp-sender';
import { ColumnCipher } from '../../platform/column-cipher';
import { SecondFactorService } from './second-factor.service';
import { SessionsService } from './sessions.service';
import { WebCookie } from './web-cookie';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SsoSettingsController } from './sso-settings.controller';
import { SigningKey } from './signing-key';
import { SupportConsoleController } from './support-console.controller';
import { SupportEntryController } from './support-entry.controller';
import { SupportSettingsController } from './support-settings.controller';
import { SupportService } from './support.service';
import { PlatformAudit } from './platform-audit';
import { DirectoryTenants } from './tenants';

/** For readiness checks: the directory's database, without exposing the connection itself. */
@Injectable()
export class DirectoryHealth {
  constructor(private readonly database: DirectoryDatabase) {}

  ping(): Promise<boolean> {
    return this.database.ping();
  }
}

/**
 * The directory plane (spec 9.3, 9.6): identities, memberships, the tenant registry and cells,
 * one-time codes and sessions. It runs inside the API until a second cell exists; until then no
 * other module touches its schema. Cells reach it through the seams in `platform/planes.ts`, and
 * it asks a cell to admit each sign-in through the same seams.
 */
@Module({
  controllers: [
    AuthController,
    SsoController,
    SsoSettingsController,
    SupportConsoleController,
    SupportSettingsController,
    SupportEntryController,
    AnnouncementsConsoleController,
    AnnouncementsController,
    CellHealthController,
  ],
  providers: [
    DirectoryDatabase,
    DirectoryHealth,
    SigningKey,
    { provide: TokenKeys, useExisting: SigningKey },
    {
      provide: OtpSender,
      inject: [CONFIG],
      useFactory: (config: Config) => {
        if (config.OTP_PROVIDER === 'msg91') {
          return new Msg91OtpSender(
            msg91Settings(config),
            config.MSG91_OTP_TEMPLATE_ID!,
            config.MSG91_OTP_VARIABLE,
          );
        }
        if (config.OTP_PROVIDER === 'mailpit') return new MailpitOtpSender(config.SMTP_URL);
        if (config.OTP_PROVIDER === 'none') return new NoOtpSender();
        return config.OTP_PROVIDER === 'memory' ? new MemoryOtpSender() : new ConsoleOtpSender();
      },
    },
    OtpService,
    SessionsService,
    SecondFactorService,
    WebCookie,
    SsoService,
    // Seals each authenticator's secret in its column (decision D91).
    ColumnCipher,
    DirectoryMembers,
    DirectoryTenants,
    PlatformAudit,
    SupportService,
    AnnouncementsService,
    CellHealthService,
  ],
  // The console module reaches the directory schema too (decision D88): its staff and audit live
  // there, and it signs its staff's tokens with the directory's key.
  exports: [
    TokenKeys,
    DirectoryHealth,
    OtpSender,
    DirectoryMembers,
    DirectoryTenants,
    DirectoryDatabase,
    SigningKey,
    PlatformAudit,
    SecondFactorService,
    SupportService,
    CellHealthService,
  ],
})
export class DirectoryModule {}
