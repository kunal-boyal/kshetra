import { callsLeft, ZOHO_CALLS_PER_MINUTE } from '@thelamp/shared';

/**
 * What an ERP connection's calls share, whichever the provider (decision D129): the meter that
 * counts them against the books' day and paces them under its minute, and the ways a run stops.
 */

/** The books answered 429: a limit was met; the run stops and the next carries on. */
export class ErpRateLimited extends Error {}
/** The books refused the connection's agreement or user: it must be made again. */
export class ErpReconnect extends Error {}
/** The run's share of the day's calls is spent. */
export class ErpDailyLimit extends Error {}
/** Any other refusal, with the books' code and message (never a secret). */
export class ErpFailed extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Counts a run's calls against the books' day (BR-59) and paces them under a per-minute limit;
 * `used` is the day's count, saved with the run. Books without limits pass Infinity for both.
 */
export class CallMeter {
  private readonly recent: number[] = [];

  constructor(
    public used: number,
    private readonly dailyLimit: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly perMinute: number = ZOHO_CALLS_PER_MINUTE,
  ) {}

  /** Calls made in this run. */
  calls = 0;

  async take(): Promise<void> {
    if (Number.isFinite(this.dailyLimit) && callsLeft(this.used, this.dailyLimit) <= 0) {
      throw new ErpDailyLimit();
    }
    if (Number.isFinite(this.perMinute)) {
      const now = Date.now();
      while (this.recent.length > 0 && now - this.recent[0]! >= 60_000) this.recent.shift();
      if (this.recent.length >= this.perMinute) {
        await this.sleep(60_000 - (now - this.recent[0]!));
        this.recent.shift();
      }
      this.recent.push(Date.now());
    }
    this.used += 1;
    this.calls += 1;
  }
}
