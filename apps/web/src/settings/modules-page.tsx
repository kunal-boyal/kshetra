import { AVAILABLE_MODULES, MODULE_KEYS, type SwitchableModule } from '@thelamp/shared';
import { Button, Checkbox, Icon, StatusBadge } from '@thelamp/ui-web';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { useAdmin } from './data';

/**
 * Modules (M2, spec 5.13): what the organisation uses. Switching one off hides its screens, takes
 * its permissions from every role, and closes its routes. Core is always on; modules of later
 * phases show as coming.
 */
export function ModulesPage() {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const admin = useAdmin();
  const saved = config.data?.bundle.settings.modulesOff;
  const [off, setOff] = useState<SwitchableModule[]>();
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!saved) return <p className="ks-muted">{t('common.loading')}</p>;
  const current = off ?? saved;
  const editable = access.can('module.manage');

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await admin.saveSettings({ modulesOff: current });
      setOff(undefined);
      setDone(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.modules')} intro={t('admin.modules_intro')} />
      <ul className="flex flex-col gap-3" aria-label={t('admin.modules')}>
        {MODULE_KEYS.map((key) => {
          const available = AVAILABLE_MODULES.includes(key);
          return (
            <li key={key} className="ks-card flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="heading-md">{t(`admin.module_${key}`)}</span>
                {key === 'core' ? (
                  <StatusBadge variant="info">{t('admin.module_always_on')}</StatusBadge>
                ) : !available ? (
                  <StatusBadge variant="neutral">{t('admin.module_coming')}</StatusBadge>
                ) : (
                  <Checkbox
                    label={t('admin.module_on')}
                    checked={!current.includes(key)}
                    disabled={!editable}
                    onChange={(event) => {
                      setDone(false);
                      setOff(
                        event.target.checked
                          ? current.filter((entry) => entry !== key)
                          : [...current, key],
                      );
                    }}
                  />
                )}
              </div>
              <p className="ks-muted text-sm">{t(`admin.module_${key}_about`)}</p>
            </li>
          );
        })}
      </ul>
      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            busy={busy}
            disabled={off === undefined}
            icon={<Icon icon={Save} />}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
          {done ? (
            <span className="ks-help" role="status">
              {t('admin.saved')}
            </span>
          ) : null}
          {error !== undefined ? (
            <span className="ks-help error" role="alert">
              {errorMessage(error, t)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
