import { Injectable } from '@nestjs/common';
import {
  AppError,
  REFERENCE_RATE_SETS,
  STATUTORY_RULES_VERSION,
  StatutoryRateSet,
  type StatutoryRatesResult,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { platformSettings } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { type StatutoryStanding, StatutoryRates } from '../../platform/planes';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';

const KEY = 'statutory_rates';

/** A chartered accountant's review of one rate set under one version of the rules. */
export interface StatutoryReview {
  rateSetId: string;
  rulesVersion: number;
  reviewer: string;
  reviewedOn: string;
  note: string;
}

interface Stored {
  sets: StatutoryRateSet[];
  reviews: StatutoryReview[];
}

/** The last day of a month (`YYYY-MM`). */
const lastDay = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

/**
 * Statutory rates as dated configuration (decision D128): the vendor's rate sets, each from a
 * date and only ever added, and the reviews a chartered accountant has given, kept in
 * `directory.platform_settings` and edited in the console. Until the vendor saves a set, the
 * reference sets in `@thelamp/shared` apply. Cells read them through the `StatutoryRates` seam.
 */
@Injectable()
export class StatutoryRatesService extends StatutoryRates {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
  ) {
    super();
  }

  async read(): Promise<Stored> {
    const [row] = await this.database.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, KEY));
    const stored = (row?.value ?? {}) as Partial<Stored>;
    return { sets: stored.sets ?? [], reviews: stored.reviews ?? [] };
  }

  /** The sets in force over time: the vendor's, else the reference ones, by date. */
  async sets(): Promise<StatutoryRateSet[]> {
    const { sets } = await this.read();
    return [...(sets.length > 0 ? sets : REFERENCE_RATE_SETS)].sort((a, b) =>
      a.from.localeCompare(b.from),
    );
  }

  async forMonth(period: string): Promise<StatutoryStanding> {
    const day = lastDay(period);
    const set = (await this.sets()).filter((entry) => entry.from <= day).at(-1) ?? null;
    return { set, reviewed: set ? await this.reviewed(set.id) : false };
  }

  async byId(id: string): Promise<StatutoryRateSet | null> {
    return (await this.sets()).find((entry) => entry.id === id) ?? null;
  }

  /** Whether a review covers a set under the rules' current version. */
  async reviewed(rateSetId: string): Promise<boolean> {
    const { reviews } = await this.read();
    return reviews.some(
      (review) => review.rateSetId === rateSetId && review.rulesVersion === STATUTORY_RULES_VERSION,
    );
  }

  /** The console's view: every set in force over time, with its reviews. */
  async result(): Promise<StatutoryRatesResult> {
    const stored = await this.read();
    return {
      rulesVersion: STATUTORY_RULES_VERSION,
      reference: stored.sets.length === 0,
      sets: (await this.sets()).map((set) => {
        const reviews = stored.reviews.filter((review) => review.rateSetId === set.id);
        return {
          ...set,
          reviews,
          reviewed: reviews.some((review) => review.rulesVersion === STATUTORY_RULES_VERSION),
        };
      }),
    };
  }

  /** Adds a rate set from a date; sets already used keep their figures, as sets never change. */
  async addSet(by: StaffAccess, set: StatutoryRateSet): Promise<StatutoryRateSet[]> {
    const parsed = StatutoryRateSet.parse(set);
    await this.database.db.transaction(async (tx) => {
      const stored = await this.read();
      const current = stored.sets.length > 0 ? stored.sets : [...REFERENCE_RATE_SETS];
      if (current.some((entry) => entry.id === parsed.id)) {
        throw new AppError('CONFLICT', 'A rate set has this ID.', [
          { path: 'id', issue: 'A rate set has this ID' },
        ]);
      }
      const value = { ...stored, sets: [...current, parsed] };
      await this.save(tx, by, value);
      await this.audit.record(tx, by, 'statutory.rates_added', 'platform', parsed.id, {
        from: parsed.from,
      });
    });
    return this.sets();
  }

  /** Records a chartered accountant's review of a set under the rules' current version. */
  async recordReview(
    by: StaffAccess | null,
    review: Omit<StatutoryReview, 'rulesVersion'>,
  ): Promise<void> {
    if (!(await this.byId(review.rateSetId))) {
      throw new AppError('NOT_FOUND', 'There is no rate set with this ID.');
    }
    await this.database.db.transaction(async (tx) => {
      const stored = await this.read();
      const value = {
        ...stored,
        reviews: [...stored.reviews, { ...review, rulesVersion: STATUTORY_RULES_VERSION }],
      };
      await this.save(tx, by, value);
      await this.audit.record(tx, by, 'statutory.reviewed', 'platform', review.rateSetId, {
        reviewer: review.reviewer,
        reviewedOn: review.reviewedOn,
      });
    });
  }

  private async save(
    tx: Parameters<Parameters<DirectoryDatabase['db']['transaction']>[0]>[0],
    by: StaffAccess | null,
    value: Stored,
  ) {
    await tx
      .insert(platformSettings)
      .values({
        key: KEY,
        value: value as unknown as Record<string, unknown>,
        updatedBy: by?.staffId ?? null,
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value: value as unknown as Record<string, unknown>,
          updatedAt: new Date(),
          updatedBy: by?.staffId ?? null,
        },
      });
  }
}
