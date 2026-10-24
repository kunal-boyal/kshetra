import { WhatsAppConsentResult } from '@thelamp/shared';
import { Button, Icon, Notice } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { Section, useDates } from '../people/shared';

/**
 * WhatsApp messages (spec 13.4, decision D85): the text people agree to, whether and when they
 * did, and agreeing or stopping. An agreement to an earlier text no longer counts.
 */
export function WhatsAppSection() {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const queryClient = useQueryClient();
  const consent = useQuery({
    queryKey: ['whatsapp-consent'],
    queryFn: () => read(client, '/v1/whatsapp-consent', WhatsAppConsentResult),
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const data = consent.data;
  const current = data?.optedIn === true && data.version === data.currentVersion;

  async function answer(optedIn: boolean) {
    if (!data) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await write(client, 'PUT', '/v1/whatsapp-consent', WhatsAppConsentResult, {
        optedIn,
        version: data.currentVersion,
      });
      queryClient.setQueryData(['whatsapp-consent'], result);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('whatsapp.title')}>
      {consent.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(consent.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p>{t('whatsapp.consent')}</p>
          {data.available ? null : <Notice>{t('whatsapp.unavailable')}</Notice>}
          <p className="ks-muted" role="status">
            {current && data.at
              ? t('whatsapp.agreed', { date: dates.dateTime(data.at) })
              : data.optedIn
                ? t('whatsapp.changed')
                : t('whatsapp.not_agreed')}
          </p>
          {failure !== undefined ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
          <Button
            className="self-start"
            icon={<Icon icon={MessageCircle} />}
            busy={busy}
            onClick={() => void answer(!current)}
          >
            {current ? t('whatsapp.stop') : t('whatsapp.agree')}
          </Button>
        </div>
      )}
    </Section>
  );
}
