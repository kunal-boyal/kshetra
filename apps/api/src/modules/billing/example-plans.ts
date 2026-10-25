import { Injectable } from '@nestjs/common';
import { newId, type PlanBody } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { plans } from '../../db/schema/directory';
import { DirectoryDatabase } from '../directory/directory.database';

/**
 * Example plans for a local database and the demo (decision D89), shaped as spec 5.13 suggests,
 * at prices that are plainly made up: the real ones (D3) are set in the console.
 */
export const EXAMPLE_PLANS: PlanBody[] = [
  {
    key: 'starter',
    name: { en: 'Starter (example)', hi: 'स्टार्टर (उदाहरण)' },
    priceMonth: '100',
    priceYear: '1000',
    modules: ['core', 'leave_attendance'],
    limits: { users: 25, storageGb: 20 },
    addons: [],
    active: true,
  },
  {
    key: 'growth',
    name: { en: 'Growth (example)', hi: 'ग्रोथ (उदाहरण)' },
    priceMonth: '200',
    priceYear: '2000',
    modules: ['core', 'leave_attendance', 'orders', 'account_finance', 'expenses'],
    limits: { users: 250, storageGb: 200 },
    addons: [{ key: 'sms_pack', name: { en: '1,000 SMS', hi: '1,000 SMS' }, price: '250' }],
    active: true,
  },
  {
    key: 'enterprise',
    name: { en: 'Enterprise (example)', hi: 'एंटरप्राइज़ (उदाहरण)' },
    priceMonth: '300',
    priceYear: '3000',
    modules: [
      'core',
      'leave_attendance',
      'orders',
      'account_finance',
      'expenses',
      'integrations',
      'sso',
    ],
    limits: { users: null, storageGb: null },
    addons: [],
    active: true,
  },
];

@Injectable()
export class ExamplePlans {
  constructor(private readonly database: DirectoryDatabase) {}

  /** Adds the example plans when there are no plans at all; returns them by key. */
  async ensure(): Promise<Map<string, string>> {
    const [existing] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(plans);
    if ((existing?.count ?? 0) === 0) {
      await this.database.db
        .insert(plans)
        .values(EXAMPLE_PLANS.map((plan) => ({ id: newId(), ...plan })))
        .onConflictDoNothing();
    }
    const rows = await this.database.db.select({ id: plans.id, key: plans.key }).from(plans);
    return new Map(rows.map((row) => [row.key, row.id]));
  }
}
