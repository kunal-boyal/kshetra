import { Notice } from '@thelamp/ui-mobile';
import { Lock, Truck } from 'lucide-react-native';
import { useMe } from '../data';
import { useLanguage } from '../i18n';

/**
 * Says so while the organisation can't save changes (decision D140): read only after an unpaid
 * invoice or a lapsed licence (BR-48, BR-49), or moving to another cell (decision D95). What is
 * recorded stays on the phone and uploads once it can, so Home and the upload queue explain why
 * it waits.
 */
export function StandingNotice() {
  const { t } = useLanguage();
  const me = useMe().data;
  if (me?.moving) {
    return (
      <Notice tone="info" icon={Truck}>
        {t('banner.moving')}
      </Notice>
    );
  }
  if (me?.readOnly) {
    return (
      <Notice tone="danger" icon={Lock}>
        {t('banner.read_only')}
      </Notice>
    );
  }
  return null;
}
