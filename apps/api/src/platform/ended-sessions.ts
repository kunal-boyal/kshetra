import { Injectable, Logger } from '@nestjs/common';
import { RedisClient } from './redis';

/**
 * Sessions ended before their access tokens run out (ASVS V7.4.1, decision D101): signing out,
 * ending a session from the list of one's own, or a spent refresh token coming back ends the
 * session's refresh-token family, and its access tokens, which last 15 minutes, are refused from
 * then on. Kept for 16 minutes, past the last token any ended session could hold.
 */
export const ENDED_SESSION_SECONDS = 16 * 60;

@Injectable()
export class EndedSessions {
  private readonly logger = new Logger(EndedSessions.name);

  constructor(private readonly client: RedisClient) {}

  /** Marks sessions ended; a failure is logged, as the refresh tokens are ended anyway. */
  async end(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    try {
      const pipeline = this.client.redis.pipeline();
      for (const id of sessionIds)
        pipeline.set(`ended-session:${id}`, '1', 'EX', ENDED_SESSION_SECONDS);
      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Could not mark sessions ended: ${(error as Error).message}`);
    }
  }

  async ended(sessionId: string): Promise<boolean> {
    return (await this.client.redis.exists(`ended-session:${sessionId}`)) === 1;
  }
}
