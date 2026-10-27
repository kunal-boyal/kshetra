import type { MessageKey } from './messages/en';

/**
 * The privacy notice (spec 13.3, decision D100): its sections in order, each a title and its
 * paragraphs, so the app's Privacy screen and the portal's public /privacy page show the same text.
 * Paragraphs take `{product}`; the contact paragraph is chosen by whether a privacy email is set.
 */
export const PRIVACY_NOTICE: readonly { title: MessageKey; paragraphs: readonly MessageKey[] }[] = [
  { title: 'privacy.who_title', paragraphs: ['privacy.who_1'] },
  {
    title: 'privacy.collect_title',
    paragraphs: [
      'privacy.collect_profile',
      'privacy.collect_location',
      'privacy.collect_photos',
      'privacy.collect_records',
      'privacy.collect_device',
    ],
  },
  { title: 'privacy.never_title', paragraphs: ['privacy.never_1'] },
  { title: 'privacy.use_title', paragraphs: ['privacy.use_1'] },
  {
    title: 'privacy.see_title',
    paragraphs: ['privacy.see_organisation', 'privacy.see_provider', 'privacy.see_services'],
  },
  { title: 'privacy.keep_title', paragraphs: ['privacy.keep_1'] },
  { title: 'privacy.rights_title', paragraphs: ['privacy.rights_1', 'privacy.rights_contact'] },
  { title: 'privacy.security_title', paragraphs: ['privacy.security_1'] },
];

/** When the notice last changed; raise it with any change to its text. */
export const PRIVACY_NOTICE_DATE = '2026-10-27';

/** The contact paragraph: the provider's privacy email where one is set, else its store page. */
export function privacyParagraph(key: MessageKey, email: string | undefined): MessageKey {
  return key === 'privacy.rights_contact' && !email ? 'privacy.rights_contact_store' : key;
}
