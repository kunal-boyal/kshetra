import { describe, expect, it } from 'vitest';
import { BundleSettings, SETTING_DEFAULTS, UpdateSettingsBody } from './schemas/tenant-config';

describe('settings as an app already on a phone reads them (spec 14.3)', () => {
  it('drops a setting a newer server added, and fills one it lacks with its default', () => {
    // An older server's settings lack the Maps key; a newer one's carry a setting this app lacks.
    const older: Record<string, unknown> = { ...SETTING_DEFAULTS };
    delete older.mapsWebKey;
    const read = BundleSettings.parse({
      ...older,
      settingFromTheFuture: true,
      gpsIntervalSeconds: 90,
    });
    expect(read).toEqual({ ...SETTING_DEFAULTS, gpsIntervalSeconds: 90 });
    expect(read).not.toHaveProperty('settingFromTheFuture');
  });

  it('still refuses what breaks a rule', () => {
    expect(BundleSettings.safeParse({ gpsIntervalSeconds: 5 }).success).toBe(false);
  });

  it('keeps changes strict: an unknown setting is an error', () => {
    expect(UpdateSettingsBody.safeParse({ settingFromTheFuture: true }).success).toBe(false);
  });
});

describe("the organisation's privacy policy link (decision D100)", () => {
  const link = (privacyPolicyUrl: string) =>
    UpdateSettingsBody.safeParse({ privacyPolicyUrl }).success;

  it('takes an https:// address, with a port, path or query', () => {
    expect(link('https://sunrise.example/privacy')).toBe(true);
    expect(link('https://sunrise.example:8443/legal?lang=hi')).toBe(true);
  });

  it('refuses plain HTTP, other schemes, bare names and spaces', () => {
    expect(link('http://sunrise.example/privacy')).toBe(false);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('https://intranet/privacy')).toBe(false);
    expect(link('https://sunrise.example/our policy')).toBe(false);
  });
});
