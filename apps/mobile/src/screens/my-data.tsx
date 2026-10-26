import { spacing } from '@thelamp/design-tokens';
import { formatDate } from '@thelamp/i18n';
import { DATA_REQUEST_KINDS, type DataRequestKindKey } from '@thelamp/shared';
import {
  Button,
  ChoiceGroup,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, FileText, RotateCw, Send } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMyDataRequests, useRaiseDataRequest } from '../data-requests';
import { errorMessage, useLanguage } from '../i18n';

/**
 * My data (module M21, decision D95): the person asks their organisation for a copy of their
 * personal data, a correction, or its erasure once they have left, and follows the answers.
 * Online only.
 */
export function MyDataScreen() {
  const { t, locale } = useLanguage();
  const requests = useMyDataRequests();
  const raise = useRaiseDataRequest();
  const [kind, setKind] = useState<DataRequestKindKey>('access');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const day = (date: string) => formatDate(date.slice(0, 10), { locale });

  async function send() {
    setBusy(true);
    setFailure(undefined);
    setSent(undefined);
    try {
      const made = await raise(kind, details);
      setSent(made.dueOn);
      setDetails('');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('my_data.title')}
      </Text>
      <Text tone="muted">{t('my_data.intro')}</Text>

      <ChoiceGroup
        title={t('my_data.ask_title')}
        choices={DATA_REQUEST_KINDS.map((value) => ({
          value,
          label: t(`my_data.kind_${value}`),
        }))}
        value={kind}
        onChange={(value) => setKind(value as DataRequestKindKey)}
      />
      <TextField
        label={t('my_data.details')}
        value={details}
        onChangeText={setDetails}
        maxLength={1000}
        multiline
      />
      {failure ? (
        <Text tone="danger" role="alert">
          {errorMessage(failure, t)}
        </Text>
      ) : null}
      {sent ? <Notice>{t('my_data.sent', { date: formatDate(sent, { locale }) })}</Notice> : null}
      <Button icon={Send} label={t('my_data.send')} busy={busy} onPress={() => void send()} />

      {requests.isError ? (
        <View style={styles.stack}>
          <Text tone="muted">{t('my_data.offline')}</Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void requests.refetch()}
          />
        </View>
      ) : !requests.data ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : requests.data.items.length === 0 ? (
        <Text tone="muted">{t('my_data.none')}</Text>
      ) : (
        <ListGroup title={t('my_data.mine')}>
          {requests.data.items.map((item) => (
            <ListRow
              key={item.id}
              icon={FileText}
              label={`${t(`my_data.kind_${item.kind}`)} · ${t(`data_requests.status_${item.status}`)}`}
              detail={
                item.status === 'received'
                  ? t('my_data.due', { date: day(item.dueOn) })
                  : t('my_data.answer', { response: item.response || '—' })
              }
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
