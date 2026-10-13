import type { MessageKey } from '@kshetra/i18n';

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** The value checks' own problems (`checkFormValues`), in the reader's language. */
const EXACT: Readonly<Record<string, MessageKey>> = {
  'Fill this in': 'entry.issue_fill_in',
  'Add at least one': 'entry.issue_add_one',
  'Add items': 'entry.issue_add_one',
  'Add items from the list': 'entry.issue_choose_item',
  'Choose an item': 'entry.issue_choose_item',
  'This item is listed already': 'entry.issue_item_listed',
  'This item is not in the catalogue': 'entry.issue_item_gone',
  'Choose from the catalogue': 'entry.issue_item_gone',
  'Enter a quantity of 0 or more': 'entry.issue_quantity',
  'Use at most 3 decimal places': 'entry.issue_quantity_decimals',
  'Enter an amount such as 1250 or 1250.50': 'entry.issue_amount',
  'Choose a contact': 'entry.issue_choose',
  'Choose a contact at the linked place': 'entry.issue_contact_elsewhere',
  'Choose from the list': 'entry.issue_choose',
  'Choose one option': 'entry.issue_choose',
  'Choose options from the list': 'entry.issue_choose',
  'Choose one you can see': 'entry.issue_choose',
  'Choose one of the listed types': 'entry.issue_choose',
  'Choose from 1 to 5': 'entry.issue_rating',
  'Choose yes or no': 'entry.issue_yes_no',
  'Enter a date as YYYY-MM-DD': 'entry.issue_date',
  'This date is too early': 'entry.issue_date_early',
  'This date is too late': 'entry.issue_date_late',
  'Enter a time as HH:MM': 'entry.issue_time',
  'Enter a number': 'entry.issue_number',
  'Enter a whole number': 'entry.issue_whole',
  'Enter it in the expected form': 'entry.issue_pattern',
  'Enter text': 'entry.issue_fill_in',
  'Scan a code': 'entry.issue_scan',
  'This code is too long': 'entry.issue_code_long',
  'Take a photo': 'entry.issue_photo',
};

const PATTERNS: readonly [RegExp, MessageKey, string][] = [
  [/^There is no option (.+)$/, 'entry.issue_choose', 'option'],
  [/^Enter at least (\d+) characters$/, 'entry.issue_min_length', 'count'],
  [/^Enter at most (\d+) characters$/, 'entry.issue_max_length', 'count'],
  [/^Enter (.+) or more$/, 'entry.issue_min', 'value'],
  [/^Enter (.+) or less$/, 'entry.issue_max', 'value'],
  [/^Use at most (\d+) decimal places$/, 'entry.issue_decimals', 'count'],
  [/^Choose at least (\d+)$/, 'entry.issue_min_selected', 'count'],
  [/^Choose at most (\d+)$/, 'entry.issue_max_selected', 'count'],
  [/^Add at most (\d+)(?: lines)?$/, 'entry.issue_max_items', 'count'],
];

/** A problem as the person should read it; one the app doesn't know asks them to check. */
export function issueText(issue: string, t: Translate): string {
  const key = EXACT[issue];
  if (key) return t(key);
  for (const [pattern, message, name] of PATTERNS) {
    const match = pattern.exec(issue);
    if (match) return t(message, { [name]: match[1]! });
  }
  return t('entry.issue_check');
}
