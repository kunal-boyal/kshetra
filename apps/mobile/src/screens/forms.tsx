import type { FormEntry } from '@thelamp/api-client/sync';
import { spacing } from '@thelamp/design-tokens';
import { formatDateTime } from '@thelamp/i18n';
import {
  AppBar,
  EmptyState,
  IconChip,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
} from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { CircleCheck, ClipboardList, FilePen, Hourglass } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { standalone, startEntry } from '../forms/start';
import { useLanguage } from '../i18n';
import { useOutboxItems, useSync } from '../sync';

/** The person's form entries on this phone, read again whenever the screen shows. */
export function useEntries(): FormEntry[] | undefined {
  const { client } = useApp();
  const sync = useSync();
  const [entries, setEntries] = useState<FormEntry[]>();
  useFocusEffect(
    useCallback(() => {
      const owner = client.owner;
      if (!sync || !owner) {
        setEntries([]);
        return;
      }
      let live = true;
      void sync.entries.list(owner).then((found) => {
        if (live) setEntries(found);
      });
      return () => {
        live = false;
      };
    }, [sync, client]),
  );
  return entries;
}

/** Sent entries shown, newest first. */
const SENT_SHOWN = 20;

/**
 * Forms (spec 8.1): the forms the person may fill, their drafts, what they submitted on the
 * phone that waits to be sent, and what was sent. Forms filled inside a visit open from the visit.
 */
export function FormsScreen() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const entries = useEntries();
  const unsent = new Set(useOutboxItems().map((item) => item.id));
  const [failure, setFailure] = useState<string>();
  const bundle = config.data?.bundle;
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const forms = standalone(bundle?.forms ?? []);
  const drafts = (entries ?? []).filter((entry) => entry.state === 'draft');
  const submitted = (entries ?? []).filter((entry) => entry.state === 'queued');
  // A submitted entry waits while its upload is in the outbox; once that has gone, it was sent.
  const queued = submitted.filter((entry) => unsent.has(entry.id));
  const sent = submitted
    .filter((entry) => !unsent.has(entry.id))
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
    .slice(0, SENT_SHOWN);
  const when = (millis: number) => formatDateTime(new Date(millis), { locale, timeZone });

  async function start(key: string) {
    const form = forms.find((entry) => entry.key === key);
    if (!form || !sync || !client.owner) return;
    setFailure(undefined);
    try {
      await startEntry(sync, client.owner, form);
    } catch {
      setFailure(t('entry.not_saved'));
    }
  }

  return (
    <Screen>
      {/* Off the tab bar since D104: reached from Home and More, so it goes back there. */}
      <AppBar
        title={t('forms.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      {failure ? (
        <Text tone="danger" role="alert">
          {failure}
        </Text>
      ) : null}
      {drafts.length > 0 ? (
        <ListGroup title={t('entry.drafts')}>
          {drafts.map((entry) => (
            <ListRow
              key={entry.id}
              icon={FilePen}
              label={entry.definition.name[locale].one}
              detail={t('entry.saved_at', { when: when(entry.updatedAt) })}
              onPress={() => router.push({ pathname: '/forms/[id]', params: { id: entry.id } })}
            />
          ))}
        </ListGroup>
      ) : null}
      {forms.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('entry.no_forms_title')}>
          {t('entry.no_forms_body')}
        </EmptyState>
      ) : (
        <ListGroup title={t('entry.start')}>
          {forms.map((form) => (
            <ListRow
              key={form.key}
              testID="form-start"
              lead={<IconChip icon={ClipboardList} hue="sky" />}
              label={form.name[locale].one}
              onPress={() => void start(form.key)}
            />
          ))}
        </ListGroup>
      )}
      {queued.length > 0 ? (
        <View style={styles.stack}>
          <ListGroup title={t('entry.waiting')}>
            {queued.map((entry) => (
              <ListRow
                key={entry.id}
                icon={Hourglass}
                label={entry.definition.name[locale].one}
                detail={t('entry.submitted_at', {
                  when: when(entry.submittedAt ?? entry.updatedAt),
                })}
                onPress={() => router.push({ pathname: '/forms/[id]', params: { id: entry.id } })}
              />
            ))}
          </ListGroup>
          <Notice>{t('entry.waiting_note')}</Notice>
        </View>
      ) : null}
      {sent.length > 0 ? (
        <ListGroup title={t('entry.sent')}>
          {sent.map((entry) => (
            <ListRow
              key={entry.id}
              icon={CircleCheck}
              label={entry.definition.name[locale].one}
              detail={t('entry.submitted_at', {
                when: when(entry.submittedAt ?? entry.updatedAt),
              })}
              onPress={() => router.push({ pathname: '/forms/[id]', params: { id: entry.id } })}
            />
          ))}
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
