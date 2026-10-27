import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/**
 * A phone number in E.164 form (`+919876543210`), the form identities store and imports produce
 * (spec 5.1, B.1). A number without a country code takes `defaultCountry`, India unless the tenant
 * says otherwise. Anything that isn't a valid number gives null.
 */
export function normalisePhone(raw: string, defaultCountry: CountryCode = 'IN'): string | null {
  const phone = parsePhoneNumberFromString(raw.trim(), { defaultCountry });
  return phone?.isValid() ? phone.number : null;
}

/** An Indian mobile number's national part: ten digits, the first 6, 7, 8 or 9 (decision D102). */
export const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * A person's number, which signs them in and receives their codes: a valid number, and in India a
 * mobile, ten digits starting 6 to 9, never a landline (decision D102). Spaces, dashes and a +91 or
 * 0 prefix are forgiven, as people and spreadsheets write them. Anything else gives null.
 */
export function normaliseMobile(raw: string, defaultCountry: CountryCode = 'IN'): string | null {
  const phone = parsePhoneNumberFromString(raw.trim(), { defaultCountry });
  if (!phone?.isValid()) return null;
  if (phone.countryCallingCode === '91' && !INDIAN_MOBILE.test(phone.nationalNumber)) return null;
  return phone.number;
}

/**
 * Why a number can't be given to a person: it signs in to another organisation, and a person
 * belongs to one at a time (decision D103). It never says which organisation.
 */
export const NUMBER_IN_USE =
  'This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first.';

/** What is wrong with the digits typed in a 10-digit mobile field, or null when they will do. */
export function mobileDigitsIssue(digits: string): 'required' | 'length' | 'start' | null {
  if (digits === '') return 'required';
  if (!/^\d{10}$/.test(digits)) return 'length';
  return INDIAN_MOBILE.test(digits) ? null : 'start';
}

/**
 * What a 10-digit mobile field keeps of what is typed or pasted: digits only, a pasted +91 or 0
 * dropped, at most ten.
 */
export function mobileDigitsFrom(typed: string): string {
  const digits = typed.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(0, 10);
}

/** The ten digits a mobile field shows for a stored Indian number; other numbers as stored. */
export function mobileDigits(e164: string | null | undefined): string {
  if (!e164) return '';
  return e164.startsWith('+91') ? e164.slice(3) : e164;
}

/** An email address as every form and route takes it (decision D102). */
export const EmailAddress = z.email().max(254);

/** Whether a typed email address will do, by the same rule the API applies. */
export function isEmail(value: string): boolean {
  return EmailAddress.safeParse(value.trim()).success;
}

/** `+919876543210` → `+91•••••43210`: enough to recognise a number, never enough to use it. */
export function maskPhone(e164: string): string {
  return e164.length <= 8
    ? '•••'
    : `${e164.slice(0, 3)}${'•'.repeat(e164.length - 8)}${e164.slice(-5)}`;
}

/** `meera@vendor.example` → `m…@vendor.example`: an address as logs may show it. */
export function maskEmail(address: string): string {
  const [name = '', domain = ''] = address.split('@');
  return `${name.slice(0, 1)}…@${domain}`;
}
