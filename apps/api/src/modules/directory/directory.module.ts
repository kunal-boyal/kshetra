import { Injectable, Module } from '@nestjs/common';
import type { Config } from '../../config';
import { TokenKeys } from '../../platform/auth';
import { CONFIG } from '../../platform/tokens';
import { AuthController } from './auth.controller';
import { DirectoryDatabase } from './directory.database';
import { OtpService } from './otp.service';
import { ConsoleOtpSender, MemoryOtpSender, OtpSender } from './otp-sender';
import { SessionsService } from './sessions.service';
import { SigningKey } from './signing-key';

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
 * other module touches its schema.
 */
@Module({
  controllers: [AuthController],
  providers: [
    DirectoryDatabase,
    DirectoryHealth,
    SigningKey,
    { provide: TokenKeys, useExisting: SigningKey },
    {
      provide: OtpSender,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        config.OTP_PROVIDER === 'memory' ? new MemoryOtpSender() : new ConsoleOtpSender(),
    },
    OtpService,
    SessionsService,
  ],
  exports: [TokenKeys, DirectoryHealth, OtpSender],
})
export class DirectoryModule {}
