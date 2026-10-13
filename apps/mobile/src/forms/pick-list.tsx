import { spacing } from '@kshetra/design-tokens';
import { ChoiceGroup, Text, TextField } from '@kshetra/ui-mobile';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';

export interface PickEntry {
  value: string;
  label: string;
  detail?: string;
}

/** Long lists show this many matches at a time; the search narrows them. */
const SHOWN = 20;

/**
 * One choice from a list that can be long, such as accounts or catalogue items: a search above
 * the matches once there are more than a handful, and the chosen entry kept in view.
 */
export function PickList({
  title,
  entries,
  value,
  onChange,
  empty,
}: {
  title: string;
  entries: readonly PickEntry[];
  value: string;
  onChange: (value: string) => void;
  /** Said when there is nothing to choose from. */
  empty: string;
}) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const long = entries.length > 8;
  const matches = entries.filter(
    (entry) =>
      !needle ||
      entry.label.toLowerCase().includes(needle) ||
      (entry.detail ?? '').toLowerCase().includes(needle),
  );
  const chosen = entries.find((entry) => entry.value === value);
  const shown = matches.slice(0, SHOWN);
  if (chosen && !shown.includes(chosen)) shown.unshift(chosen);
  return (
    <View style={styles.stack}>
      {long ? (
        <TextField
          label={t('entry.search', { what: title })}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      ) : null}
      {entries.length === 0 ? (
        <>
          <Text variant="labelSm" tone="muted">
            {title}
          </Text>
          <Text tone="muted">{empty}</Text>
        </>
      ) : (
        <ChoiceGroup title={title} choices={shown} value={value} onChange={onChange} />
      )}
      {long && matches.length > SHOWN ? (
        <Text variant="bodySm" tone="muted">
          {t('entry.more_matches', { count: matches.length - SHOWN })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
