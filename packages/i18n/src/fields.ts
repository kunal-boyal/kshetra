import { isEmail, mobileDigitsIssue } from '@thelamp/shared';
import type { MessageKey } from './messages/en';

/**
 * The message for the digits typed in a 10-digit mobile field, or null when they will do
 * (decision D102). An empty optional field is fine; `required` says whether it may be empty.
 */
export function mobileMessage(
  digits: string,
  required = true,
  landline = false,
): MessageKey | null {
  const issue = mobileDigitsIssue(digits);
  if (issue === 'required') return required ? 'common.mobile_required' : null;
  // A business's number may be a landline, ten digits with its area code (decision D102).
  if (issue === 'start' && landline) return null;
  return issue ? (`common.mobile_${issue}` as const) : null;
}

/** The message for a typed email address, or null when it will do or may be left empty. */
export function emailMessage(value: string, required = false): MessageKey | null {
  if (value.trim() === '') return required ? 'common.email_invalid' : null;
  return isEmail(value) ? null : 'common.email_invalid';
}
