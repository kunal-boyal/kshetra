/**
 * The words that vary by industry (spec 5.2). The UI never prints these directly: it resolves each
 * key, and a template or the tenant may override the product default. A noun has a singular and a
 * plural in each language; a label is one phrase. The i18n package holds the product defaults.
 */
export const TERMINOLOGY_KEYS = {
  'term.account': 'noun',
  'term.field_user': 'noun',
  'term.activity': 'noun',
  'term.journey_plan': 'noun',
  'term.plan_item': 'noun',
  'term.target': 'noun',
  'term.order': 'noun',
  'term.punch_in': 'label',
  'term.punch_out': 'label',
} as const satisfies Record<string, 'noun' | 'label'>;

export type TerminologyKey = keyof typeof TERMINOLOGY_KEYS;
