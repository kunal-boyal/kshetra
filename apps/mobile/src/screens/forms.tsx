import type { FormEntry } from '@kshetra/api-client/sync';
import { spacing } from '@kshetra/design-tokens';
import { formatDateTime } from '@kshetra/i18n';
import { EmptyState, ListGroup, ListRow, Notice, Screen, Text } from '@kshetra/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { ClipboardList, FilePen, Hourglass } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { standalone, startEntry } from '../forms/start';
import { useLanguage } from '../i18n';
import { useSync } from '../sync';

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

/**
 * Forms (spec 8.1): the forms the person may fill, their drafts, and what they submitted on the
 * phone that waits to be sent. Forms filled inside a visit open from the visit.
 */
export function FormsScreen() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const entries = useEntries();
  const [failure, setFailure] = useState<string>();
  const bundle = config.data?.bundle;
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const forms = standalone(bundle?.forms ?? []);
  const drafts = (entries ?? []).filter((entry) => entry.state === 'draft');
  const queued = (entries ?? []).filter((entry) => entry.state === 'queued');
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
      <Text variant="headingXl" role="heading">
        {t('forms.title')}
      </Text>
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
              icon={ClipboardList}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
