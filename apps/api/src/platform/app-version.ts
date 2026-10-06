import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import {
  APP_PLATFORM_HEADER,
  APP_VERSION_HEADER,
  AppError,
  type AppPlatform,
  isBelowMinimum,
} from '@kshetra/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/**
 * Turns away app versions older than their platform's minimum (M1, rule 8), on every route and
 * before the access token is checked, so an outdated app shows its update screen rather than
 * another error. Requests without the app's headers, such as the web's, pass.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  private readonly minimums: Record<AppPlatform, string | undefined>;

  constructor(@Inject(CONFIG) config: Config) {
    this.minimums = { android: config.MIN_APP_VERSION_ANDROID, ios: config.MIN_APP_VERSION_IOS };
  }

  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<FastifyRequest>();
    const platform = headers[APP_PLATFORM_HEADER];
    const version = headers[APP_VERSION_HEADER];
    if (typeof version !== 'string' || (platform !== 'android' && platform !== 'ios')) return true;
    if (isBelowMinimum(version, this.minimums[platform])) {
      throw new AppError('UPGRADE_REQUIRED', 'This version of the app is no longer supported.');
    }
    return true;
  }
}
