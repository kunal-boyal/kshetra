import { spacing } from '@thelamp/design-tokens';
import { checkValues, type Values } from '@thelamp/forms';
import {
  AccountCode,
  type CreateAccountBody,
  newId,
  type SyncAccount,
  timeIn,
  todayIn,
} from '@thelamp/shared';
import { Button, ChoiceGroup, Notice, Screen, Text, TextField } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Crosshair, Send } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { proposeAccount } from '../captures';
import { useConfig } from '../data';
import { FieldList } from '../forms/fields';
import { issueText } from '../forms/issues';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix, type Fix } from '../location';
import { useSync } from '../sync';
import { proposableTypes } from './accounts';

/**
 * Proposing a new account from the field (M4, decision D38): saved on the phone and sent when
 * there is signal; the person's manager decides it. Where it is can be added from a fix, and
 * stays unverified until a location is approved. The type's own fields are filled here too.
 */
export function NewAccountScreen({ typeKey }: { typeKey: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const territories = useLocalRows('territories');
  const bundle = config.data?.bundle;
  const type = proposableTypes(
    bundle?.accountTypes ?? [],
    new Set<string>(bundle?.access.permissions ?? []),
  ).find((entry) => entry.key === typeKey);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [territoryId, setTerritoryId] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [custom, setCustom] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!type) {
    return (
      <Screen>
        <Text tone="muted">{t('common.loading')}</Text>
      </Screen>
    );
  }
  const manual = type.code.mode === 'manual';
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const fieldIssues = new Map(
    Object.entries(errors)
      .filter(([key]) => key.startsWith('custom.'))
      .map(([key, issue]) => [key.slice('custom.'.length), issue]),
  );
  const places = (territories ?? []).filter((node) => node.active);

  async function locate() {
    setLocating(true);
    const state = await currentFix();
    setLocating(false);
    if (state.status === 'ready') setFix(state.fix);
    else
      setErrors({
        ...errors,
        location: t(state.status === 'denied' ? 'account.fix_denied' : 'account.fix_unavailable'),
      });
  }

  async function save() {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = t('account.name_needed');
    if (manual && !AccountCode.safeParse(code.trim()).success)
      found.code = t('account.code_needed');
    if (!territoryId) found.territoryId = t('account.territory_needed');
    const checked = checkValues(type!.fields, custom, { today: todayIn(timeZone) });
    for (const issue of checked.issues) found[`custom.${issue.path}`] = issueText(issue.issue, t);
    setErrors(found);
    if (Object.keys(found).length > 0 || !sync || !client.owner || !type) return;
    setBusy(true);
    const id = newId();
    const body: CreateAccountBody = {
      id,
      type: type.key,
      ...(manual ? { code: code.trim() } : {}),
      name: name.trim(),
      territoryId,
      ...(fix ? { location: { lat: fix.lat, lng: fix.lng } } : {}),
      ...(Object.keys(checked.values).length > 0 ? { custom: checked.values } : {}),
    };
    const preview: SyncAccount = {
      id,
      type: type.key,
      code: manual ? code.trim() : '',
      name: name.trim(),
      territoryId,
      parentId: null,
      address: {},
      location: fix ? { lat: fix.lat, lng: fix.lng } : null,
      geofenceRadiusM: null,
      locationStatus: 'unverified',
      status: 'pending',
      segments: [],
      custom: checked.values,
      slots: [],
    };
    try {
      await proposeAccount(sync, client.owner, body, preview);
      router.replace({ pathname: '/accounts/[id]', params: { id } });
    } catch {
      setErrors({ form: t('account.not_saved') });
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
      />
      <Text variant="headingXl" role="heading">
        {t('accounts.propose', { type: type.name[locale].one })}
      </Text>
      <Text tone="muted">{t('account.propose_intro')}</Text>
      <TextField
        label={t('account.name')}
        required
        value={name}
        onChangeText={setName}
        {...(errors.name ? { error: errors.name } : {})}
      />
      {manual ? (
        <TextField
          label={t('account.code')}
          required
          value={code}
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setCode}
          {...(errors.code ? { error: errors.code } : {})}
        />
      ) : null}
      <ChoiceGroup
        title={t('account.territory')}
        value={territoryId}
        choices={places.map((node) => ({ value: node.id, label: node.name, detail: node.code }))}
        onChange={setTerritoryId}
      />
      {errors.territoryId ? (
        <Text tone="danger" role="alert">
          {errors.territoryId}
        </Text>
      ) : null}
      {type.fields.length > 0 ? (
        <FieldList
          fields={type.fields}
          values={custom}
          onChange={setCustom}
          issues={fieldIssues}
          data={{
            accounts: [],
            contacts: [],
            items: [],
            units: [],
            accountId: null,
            today: todayIn(timeZone),
            now: timeIn(timeZone),
            capture: () => undefined,
            readOnly: false,
          }}
        />
      ) : null}
      <View style={styles.stack}>
        <Text variant="labelSm" tone="muted">
          {t('account.location')}
        </Text>
        {fix ? (
          <Notice>{t('account.fix_taken', { accuracy: Math.round(fix.accuracy) })}</Notice>
        ) : (
          <Button
            variant="secondary"
            icon={Crosshair}
            label={t('account.add_where')}
            busy={locating}
            onPress={() => void locate()}
          />
        )}
        {errors.location ? <Text tone="muted">{errors.location}</Text> : null}
      </View>
      {errors.form ? (
        <Text tone="danger" role="alert">
          {errors.form}
        </Text>
      ) : null}
      <Button
        variant="primary"
        icon={Send}
        label={t('account.send_proposal')}
        busy={busy}
        onPress={() => void save()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
