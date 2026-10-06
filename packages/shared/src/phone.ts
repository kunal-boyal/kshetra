import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * A phone number in E.164 form (`+919876543210`), the form identities store and imports produce
 * (spec 5.1, B.1). A number without a country code takes `defaultCountry`, India unless the tenant
 * says otherwise. Anything that isn't a valid number gives null.
 */
export function normalisePhone(raw: string, defaultCountry: CountryCode = 'IN'): string | null {
  const phone = parsePhoneNumberFromString(raw.trim(), { defaultCountry });
  return phone?.isValid() ? phone.number : null;
}

/** `+919876543210` → `+91•••••43210`: enough to recognise a number, never enough to use it. */
export function maskPhone(e164: string): string {
  return e164.length <= 8
    ? '•••'
    : `${e164.slice(0, 3)}${'•'.repeat(e164.length - 8)}${e164.slice(-5)}`;
}
