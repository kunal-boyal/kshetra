import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const required = {
  DATABASE_URL: 'postgres://cell_app:x@localhost:5433/kshetra',
  DIRECTORY_DATABASE_URL: 'postgres://directory_app:x@localhost:5433/kshetra',
  REDIS_URL: 'redis://localhost:6380',
  OTP_PEPPER: 'a-local-pepper-of-16+',
  S3_BUCKET: 'kshetra-local',
};

describe('loadConfig', () => {
  it('fills defaults around the required settings', () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: 'development',
      PRODUCT_SLUG: 'thelamp',
      HOST: '127.0.0.1',
      PORT: 3000,
      TRUST_PROXY: false,
      CELL_ID: 'local',
      DB_POOL_MAX: 10,
      LOG_LEVEL: 'info',
      OTP_PROVIDER: 'console',
      // The worker process turns the relay on for itself.
      OUTBOX_RELAY: false,
      OUTBOX_POLL_MS: 1000,
      SCHEDULER_TICK_MS: 300_000,
      SYNC_EPOCH: '1',
    });
  });

  it('reads numbers and switches from environment strings', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      DB_POOL_MAX: '25',
      TRUST_PROXY: 'true',
    });
    expect(config.PORT).toBe(8080);
    expect(config.DB_POOL_MAX).toBe(25);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('reads the CORS allowlist as a list of origins', () => {
    expect(loadConfig(required).CORS_ORIGINS).toEqual([]);
    expect(
      loadConfig({ ...required, CORS_ORIGINS: 'https://app.example.com, http://localhost:5173' })
        .CORS_ORIGINS,
    ).toEqual(['https://app.example.com', 'http://localhost:5173']);
    expect(() => loadConfig({ ...required, CORS_ORIGINS: 'https://app.example.com/path' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('reads an empty signing key as none, as .env.example leaves it', () => {
    expect(loadConfig({ ...required, JWT_SIGNING_KEY: '' }).JWT_SIGNING_KEY).toBeUndefined();
  });

  it('reads the minimum app versions, with an empty one as none', () => {
    const config = loadConfig({ ...required, MIN_APP_VERSION_ANDROID: '1.4.0' });
    expect(config.MIN_APP_VERSION_ANDROID).toBe('1.4.0');
    expect(config.MIN_APP_VERSION_IOS).toBeUndefined();
    expect(
      loadConfig({ ...required, MIN_APP_VERSION_IOS: '' }).MIN_APP_VERSION_IOS,
    ).toBeUndefined();
    expect(() => loadConfig({ ...required, MIN_APP_VERSION_ANDROID: 'v1.4' })).toThrow(
      /MIN_APP_VERSION_ANDROID/,
    );
  });

  it('turns escaped newlines in the signing key back into a PEM', () => {
    const config = loadConfig({ ...required, JWT_SIGNING_KEY: 'line one\\nline two' });
    expect(config.JWT_SIGNING_KEY).toBe('line one\nline two');
  });

  it('names what is wrong instead of starting half-configured', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...required, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...required, OTP_PEPPER: 'short' })).toThrow(/OTP_PEPPER/);
  });

  it('refuses development shortcuts in production', () => {
    const production = { ...required, NODE_ENV: 'production' };
    expect(() => loadConfig(production)).toThrow(/OTP_PROVIDER/);
    expect(() => loadConfig(production)).toThrow(/JWT_SIGNING_KEY/);
    expect(() => loadConfig(production)).toThrow(/OTP_PEPPER/);
    expect(() => loadConfig(production)).toThrow(/CELL_API_URL/);
    expect(() => loadConfig({ ...production, OTP_PROVIDER: 'mailpit' })).toThrow(
      /mailpit provider never sends a real code/,
    );
  });

  it('takes MSG91 with its key, its OTP template and the templates of notifications', () => {
    const msg91 = { ...required, OTP_PROVIDER: 'msg91', SMS_PROVIDER: 'msg91' };
    expect(() => loadConfig(msg91)).toThrow(/MSG91_AUTH_KEY/);
    expect(() => loadConfig({ ...msg91, MSG91_AUTH_KEY: 'key' })).toThrow(/MSG91_OTP_TEMPLATE_ID/);
    const config = loadConfig({
      ...msg91,
      MSG91_AUTH_KEY: 'key',
      MSG91_OTP_TEMPLATE_ID: 'otp-tpl',
      MSG91_SMS_TEMPLATES: '{"visit.missed": {"en": "sms-en"}}',
    });
    expect(config).toMatchObject({
      MSG91_BASE_URL: 'https://control.msg91.com',
      MSG91_OTP_VARIABLE: 'otp',
      MSG91_SMS_TEMPLATES: { 'visit.missed': { en: 'sms-en' } },
    });
    expect(() =>
      loadConfig({
        ...msg91,
        MSG91_AUTH_KEY: 'key',
        MSG91_OTP_TEMPLATE_ID: 'x',
        MSG91_SMS_TEMPLATES: '[',
      }),
    ).toThrow(/MSG91_SMS_TEMPLATES/);
  });

  it('reads demo codes, and lets only a demo cell run without real senders (decision D70)', () => {
    const codes = loadConfig({
      ...required,
      DEMO_CODES: JSON.stringify({ '98000 00001': '482913' }),
    }).DEMO_CODES;
    expect([...codes]).toEqual([['+919800000001', '482913']]);
    expect(() => loadConfig({ ...required, DEMO_CODES: '{"+919800000001": "48291"}' })).toThrow(
      /six digits/,
    );
    expect(() => loadConfig({ ...required, DEMO_CODES: '{"12": "482913"}' })).toThrow(
      /not a valid mobile number/,
    );
    expect(() => loadConfig({ ...required, DEMO_CODES: '["+919800000001"]' })).toThrow(/JSON/);
    expect(() => loadConfig({ ...required, OTP_PROVIDER: 'none' })).toThrow(/demo cell/);

    const demo = {
      ...required,
      NODE_ENV: 'production',
      CELL_PURPOSE: 'demo',
      CELL_API_URL: 'https://api.demo.example.com',
      OTP_PEPPER: 'a-production-pepper-of-32-characters',
      JWT_SIGNING_KEY: 'a key',
      OTP_PROVIDER: 'none',
      PUSH_PROVIDER: 'console',
      SMS_PROVIDER: 'console',
      EMAIL_PROVIDER: 'console',
    };
    expect(loadConfig(demo)).toMatchObject({ CELL_PURPOSE: 'demo', OTP_PROVIDER: 'none' });
    // A live cell still needs real senders, and no cell prints codes in production.
    expect(() => loadConfig({ ...demo, CELL_PURPOSE: 'live' })).toThrow(/OTP_PROVIDER/);
    expect(() => loadConfig({ ...demo, OTP_PROVIDER: 'console' })).toThrow(/OTP_PROVIDER/);
  });

  it('keeps WhatsApp off until a provider exists, and reads its templates (decision D85)', () => {
    expect(loadConfig(required)).toMatchObject({
      WHATSAPP_PROVIDER: 'off',
      WHATSAPP_TEMPLATES: {},
    });
    expect(
      loadConfig({ ...required, WHATSAPP_TEMPLATES: '{"plan.today": {"en": "plan_en"}}' })
        .WHATSAPP_TEMPLATES,
    ).toEqual({ 'plan.today': { en: 'plan_en' } });
    expect(() => loadConfig({ ...required, WHATSAPP_TEMPLATES: '[' })).toThrow(
      /WHATSAPP_TEMPLATES/,
    );
    expect(() => loadConfig({ ...required, WHATSAPP_PROVIDER: 'memory' })).toThrow(/tests only/);
    const production = {
      ...required,
      NODE_ENV: 'production',
      CELL_API_URL: 'https://api.example.test',
      JWT_SIGNING_KEY: 'a key',
      OTP_PEPPER: 'a-production-pepper-of-32-characters',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'key',
      MSG91_OTP_TEMPLATE_ID: 'otp',
      PUSH_PROVIDER: 'expo',
      SMS_PROVIDER: 'msg91',
      EMAIL_PROVIDER: 'smtp',
    };
    // Off is a real answer in production; printing to the console isn't.
    expect(loadConfig(production).WHATSAPP_PROVIDER).toBe('off');
    expect(() => loadConfig({ ...production, WHATSAPP_PROVIDER: 'console' })).toThrow(
      /WHATSAPP_PROVIDER/,
    );
  });

  it('keeps the memory code sender to tests', () => {
    expect(() => loadConfig({ ...required, OTP_PROVIDER: 'memory' })).toThrow(/tests only/);
    expect(() => loadConfig({ ...required, OBJECT_STORE: 'memory' })).toThrow(/tests only/);
    expect(() => loadConfig({ ...required, S3_BUCKET: undefined })).toThrow(/bucket/);
    expect(loadConfig({ ...required, NODE_ENV: 'test', OTP_PROVIDER: 'memory' }).OTP_PROVIDER).toBe(
      'memory',
    );
  });
});
