import { formatDateTime } from '@thelamp/i18n';
import { useApp } from '../context';
import { useMe } from '../data';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

/**
 * Says so on every screen while vendor support is in the organisation under a grant (decision
 * D93): who, whether to look only, and until when; and offers the way out.
 */
export function SupportBanner({ onSignOut }: { onSignOut: () => void }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const support = useMe(client).data?.support;
  if (!support) return null;
  return (
    <p className="ks-banner pending" role="status">
      <span>
        {t(support.scope === 'write' ? 'support.banner_write' : 'support.banner_read', {
          organisation: client.session?.tenant.name ?? '',
          time: formatDateTime(support.endsAt, { locale, timeZone: access.timezone }),
        })}
      </span>
      <button type="button" className="ks-banner-act" onClick={onSignOut}>
        {t('shell.sign_out')}
      </button>
    </p>
  );
}
