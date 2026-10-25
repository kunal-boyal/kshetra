import { describe, expect, it } from 'vitest';
import type { Config } from '../../config';
import type { DirectoryDatabase } from '../directory/directory.database';
import type { PlatformAudit } from '../directory/platform-audit';
import { BillingSettings, EXAMPLE_BILLING } from './billing-settings.service';

const settings = (config: Partial<Config>) =>
  new BillingSettings({} as DirectoryDatabase, {} as PlatformAudit, config as Config);

describe('billing settings (decision D90)', () => {
  it('invoices on the example locally and on the demo, never on a live production cell', () => {
    const local = settings({ NODE_ENV: 'development', CELL_PURPOSE: 'live' });
    expect(local.readiness(EXAMPLE_BILLING)).toBeNull();
    const demo = settings({ NODE_ENV: 'production', CELL_PURPOSE: 'demo' });
    expect(demo.readiness(EXAMPLE_BILLING)).toBeNull();
    const live = settings({ NODE_ENV: 'production', CELL_PURPOSE: 'live' });
    expect(live.readiness(EXAMPLE_BILLING)).toMatch(/not the example/);
    expect(live.readiness({ ...EXAMPLE_BILLING, example: false })).toBeNull();
    expect(
      live.readiness({
        ...EXAMPLE_BILLING,
        example: false,
        seller: { ...EXAMPLE_BILLING.seller, gstin: null },
      }),
    ).toMatch(/GSTIN/);
    expect(
      local.readiness({ ...EXAMPLE_BILLING, seller: { ...EXAMPLE_BILLING.seller, legalName: '' } }),
    ).toMatch(/seller’s details/);
  });
});
