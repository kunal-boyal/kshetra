import { ApiError } from '@thelamp/api-client';
import { spacing } from '@thelamp/design-tokens';
import { formatDate } from '@thelamp/i18n';
import {
  DATA_REQUEST_KINDS,
  type DataRequestKindKey,
  type DataRequestResult,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  Card,
  ChoiceGroup,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Download, FileText, RotateCw, Send } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import {
  copyKept,
  copySize,
  useMyDataRequests,
  useOpenMyCopy,
  useRaiseDataRequest,
} from '../data-requests';
import { errorMessage, useLanguage } from '../i18n';

/**
 * Why a request wasn't sent. The server names `kind` when one of that kind is open already, which
 * this screen says in words, as it highlights no fields.
 */
function failureText(error: unknown, t: ReturnType<typeof useLanguage>['t']): string {
  if (error instanceof ApiError && error.details.some((detail) => detail.path === 'kind')) {
    return t('my_data.already_open');
  }
  return errorMessage(error, t);
}

/**
 * The person's copy of their data, once their access request is done (decision D141): its size
 * and the day it is kept until, opened in the system browser through a day's link the server
 * gives only them.
 */
function MyCopy({ item }: { item: DataRequestResult }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const open = useOpenMyCopy();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [gone, setGone] = useState(false);
  const archive = item.archive!;

  async function download() {
    setBusy(true);
    setFailure(undefined);
    try {
      setGone(!(await open(item.id)));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.stack}>
      <Button
        icon={Download}
        label={t('my_data.download')}
        busy={busy}
        onPress={() => void download()}
      />
      <Text tone="muted">
        {t('my_data.copy_detail', {
          size: copySize(archive.bytes ?? 0, locale),
          date: formatDate(todayIn(timeZone, new Date(archive.expiresAt!)), { locale }),
        })}
      </Text>
      <Text variant="bodySm" tone="muted">
        {t('my_data.copy_hint')}
      </Text>
      {failure || gone ? (
        <Text tone="danger" role="alert">
          {gone ? t('my_data.copy_gone') : errorMessage(failure, t)}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * My data (module M21, decisions D95 and D141): the person asks their organisation for a copy of
 * their personal data, a correction, or its erasure once they have left, follows the answers, and
 * downloads their copy once their access request is done. Online only.
 */
export function MyDataScreen() {
  const { t, locale } = useLanguage();
  const requests = useMyDataRequests();
  const raise = useRaiseDataRequest();
  const items = requests.data?.items ?? [];
  const copies = items.filter((item) => copyKept(item));
  // The newest completed access request's copy, once removed, unless another is on its way.
  const lastAccess = items.find((item) => item.kind === 'access');
  const copyGone = lastAccess?.status === 'completed' && !copyKept(lastAccess);
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
      {copies.map((item) => (
        <MyCopy key={item.id} item={item} />
      ))}
      {copyGone ? <Notice>{t('my_data.copy_gone')}</Notice> : null}

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
          {failureText(failure, t)}
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
