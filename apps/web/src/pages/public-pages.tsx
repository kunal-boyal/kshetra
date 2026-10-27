import { formatDate, PRIVACY_NOTICE, PRIVACY_NOTICE_DATE, privacyParagraph } from '@thelamp/i18n';
import { Card } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';
import { useLanguage } from '../i18n';
import { PRODUCT_NAME } from '../layout/brand';
import { LanguageToggle } from '../layout/preferences-menu';

/** The provider's privacy address, set per build; without it the notice points to the store page. */
const PRIVACY_EMAIL = import.meta.env.VITE_PRIVACY_EMAIL || undefined;

/** The pages anyone may read without signing in (decision D100). */
export const PUBLIC_PATHS = ['/sign-in', '/privacy', '/delete-account'] as const;

/** A public page in the sign-in page's frame: the brand beside, the text in a card. */
function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main className="ks ks-auth">
      <aside className="ks-auth-brand" aria-label={PRODUCT_NAME}>
        <span className="ks-auth-name">
          <img src={markUrl} alt="" width={40} height={40} />
          {PRODUCT_NAME}
        </span>
        <img className="ks-auth-art" src={markUrl} alt="" aria-hidden="true" />
      </aside>
      <div className="ks-auth-form">
        <div className="flex flex-col gap-6">
          <div className="flex justify-end">
            <LanguageToggle />
          </div>
          <Card>
            <article className="flex flex-col gap-4">{children}</article>
          </Card>
        </div>
      </div>
    </main>
  );
}

/**
 * The privacy notice (spec 13.3, decision D100), the address the store listings give; the app
 * shows the same sections from `PRIVACY_NOTICE`.
 */
export function PrivacyPage() {
  const { t, locale } = useLanguage();
  const params = { product: PRODUCT_NAME, ...(PRIVACY_EMAIL ? { email: PRIVACY_EMAIL } : {}) };
  return (
    <PublicFrame>
      <h1 className="heading-xl">{t('privacy.title')}</h1>
      <p className="ks-muted">
        {t('privacy.changed', { date: formatDate(PRIVACY_NOTICE_DATE, { locale }) })}
      </p>
      {PRIVACY_NOTICE.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="heading-md">{t(section.title)}</h2>
          {section.paragraphs.map((key) => (
            <p key={key}>{t(privacyParagraph(key, PRIVACY_EMAIL), params)}</p>
          ))}
        </section>
      ))}
    </PublicFrame>
  );
}

/** How to have an account and its data deleted, as Google Play asks of every app (D100). */
export function DeleteAccountPage() {
  const { t } = useLanguage();
  const params = { product: PRODUCT_NAME, ...(PRIVACY_EMAIL ? { email: PRIVACY_EMAIL } : {}) };
  return (
    <PublicFrame>
      <h1 className="heading-xl">{t('deletion.title')}</h1>
      <p>{t('deletion.intro', params)}</p>
      <section className="flex flex-col gap-2">
        <h2 className="heading-md">{t('deletion.how_title')}</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>{t('deletion.how_app')}</li>
          <li>{t('deletion.how_organisation')}</li>
          {PRIVACY_EMAIL ? <li>{t('deletion.how_email', params)}</li> : null}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="heading-md">{t('deletion.what_title')}</h2>
        <p>{t('deletion.what_deleted')}</p>
        <p>{t('deletion.what_kept')}</p>
      </section>
      <p>
        <Link to="/privacy">{t('deletion.privacy_link')}</Link>
      </p>
    </PublicFrame>
  );
}
