import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  type DeviceInfo,
  maskPhone,
  newId,
  normalisePhone,
  type OtpRequestResult,
  type OtpVerifyResult,
} from '@thelamp/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Config } from '../../config';
import { identities, otpChallenges, tenants } from '../../db/schema/directory';
import { type RateLimit, RateLimiter } from '../../platform/rate-limit';
import { SecurityLog } from '../../platform/security-log';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase } from './directory.database';
import { activeMemberships } from './memberships';
import { OtpSender } from './otp-sender';
import { codeHmac, newCode, OTP, sameDigest } from './secrets';
import { SessionsService } from './sessions.service';

/** Sign-in limits (M1, rule 3). Unknown numbers count exactly like known ones. */
export const OTP_LIMITS = {
  requestsPerNumber: { name: 'otp-request-number', max: 3, windowSeconds: 600 },
  requestsPerAddress: { name: 'otp-request-ip', max: 20, windowSeconds: 3600 },
  verificationsPerAddress: { name: 'otp-verify-ip', max: 30, windowSeconds: 3600 },
  // Wrong codes for one number, across its challenges and from any address (decision D101):
  // without these, a number's three challenges every ten minutes allow over 2,000 guesses a day.
  wrongCodesPerNumberHour: { name: 'otp-wrong-number-hour', max: 10, windowSeconds: 3600 },
  wrongCodesPerNumberDay: { name: 'otp-wrong-number-day', max: 20, windowSeconds: 86_400 },
} as const satisfies Record<string, RateLimit>;

function parsePhone(raw: string): string {
  const phone = normalisePhone(raw);
  if (!phone) {
    throw new AppError('VALIDATION', 'Enter a valid mobile number.', [
      { path: 'phone', issue: 'Not a valid mobile number' },
    ]);
  }
  return phone;
}

/**
 * One-time codes by phone (module M1). Every request leaves a challenge, but only registered
 * numbers get a code: an unknown number gets a decoy challenge nobody can read, so both answer the
 * same way, verify the same way and take about as long (M1, rule 2).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly limiter: RateLimiter,
    private readonly sender: OtpSender,
    private readonly sessions: SessionsService,
    private readonly security: SecurityLog,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async request(rawPhone: string, address: string): Promise<OtpRequestResult> {
    const phone = parsePhone(rawPhone);
    await this.limiter.hit(OTP_LIMITS.requestsPerAddress, address);
    await this.limiter.hit(OTP_LIMITS.requestsPerNumber, phone);

    const [registered] = await activeMemberships(
      this.database.db,
      eq(identities.phoneE164, phone),
    ).limit(1);
    const demoCode = registered ? await this.demoCode(phone) : undefined;
    const id = newId();
    const code = demoCode ?? newCode();
    await this.database.db.insert(otpChallenges).values({
      id,
      identityKey: phone,
      codeHmac: codeHmac(this.config.OTP_PEPPER, id, code),
      channel: !registered ? 'none' : demoCode ? 'demo' : 'sms',
      expiresAt: new Date(Date.now() + OTP.ttlSeconds * 1000),
      ip: address,
    });
    if (registered && !demoCode) {
      // Not awaited, so a known number answers no slower than an unknown one.
      this.sender
        .send({ phone, code })
        .catch((error: Error) => this.logger.error(`Sending a code failed: ${error.message}`));
    }
    return { expiresInSeconds: OTP.ttlSeconds };
  }

  /**
   * A number's fixed demo code (decision D70), when DEMO_CODES names it and every tenant the number
   * signs in to is a demo tenant; otherwise a real code is sent as usual.
   */
  private async demoCode(phone: string): Promise<string | undefined> {
    const code = this.config.DEMO_CODES.get(phone);
    if (!code) return undefined;
    const [real] = await activeMemberships(
      this.database.db,
      and(eq(identities.phoneE164, phone), eq(tenants.demo, false)),
    ).limit(1);
    return real ? undefined : code;
  }

  async verify(
    rawPhone: string,
    code: string,
    address: string,
    device?: DeviceInfo,
  ): Promise<OtpVerifyResult> {
    const phone = parsePhone(rawPhone);
    await this.limiter.hit(OTP_LIMITS.verificationsPerAddress, address);
    const failed = (reason: string) =>
      this.security.record({
        event: 'sign_in_failed',
        plane: 'directory',
        method: 'sms_code',
        subject: maskPhone(phone),
        reason,
      });
    try {
      await this.limiter.check(OTP_LIMITS.wrongCodesPerNumberHour, phone);
      await this.limiter.check(OTP_LIMITS.wrongCodesPerNumberDay, phone);
    } catch (error) {
      failed('wrong_codes_capped');
      throw error;
    }

    // The outcome is decided inside the transaction and thrown after it commits, so a wrong
    // attempt is counted even though the request fails.
    const outcome = await this.database.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.identityKey, phone))
        .orderBy(desc(otpChallenges.createdAt), desc(otpChallenges.id))
        .limit(1)
        .for('update');
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt.getTime() <= Date.now() ||
        challenge.attempts >= OTP.maxAttempts
      ) {
        return 'expired';
      }
      if (!sameDigest(challenge.codeHmac, codeHmac(this.config.OTP_PEPPER, challenge.id, code))) {
        const attempts = challenge.attempts + 1;
        await tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id));
        return attempts >= OTP.maxAttempts ? 'wrong-expired' : 'invalid';
      }
      await tx
        .update(otpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenges.id, challenge.id));
      // A decoy's code was never sent, so matching it is a lucky guess, not a sign-in.
      return challenge.channel === 'none' ? 'invalid' : 'verified';
    });

    if (outcome === 'wrong-expired' || outcome === 'invalid') {
      // Only wrong codes count towards the number's own limits, so its owner isn't locked out by
      // signing in (decision D101).
      await this.limiter.hit(OTP_LIMITS.wrongCodesPerNumberHour, phone).catch(() => undefined);
      await this.limiter.hit(OTP_LIMITS.wrongCodesPerNumberDay, phone).catch(() => undefined);
    }
    if (outcome !== 'verified') {
      failed(
        outcome === 'invalid'
          ? 'wrong_code'
          : outcome === 'wrong-expired'
            ? 'wrong_code_last_try'
            : 'no_live_code',
      );
    }
    if (outcome === 'expired' || outcome === 'wrong-expired') {
      throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
    }
    if (outcome === 'invalid') {
      throw new AppError('OTP_INVALID', 'That code is not right. Check it and try again.');
    }
    return this.sessions.signIn(phone, device, address);
  }
}
