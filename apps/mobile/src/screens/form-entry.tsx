import type { FormEntry } from '@thelamp/api-client/sync';
import { spacing } from '@thelamp/design-tokens';
import type { Values } from '@thelamp/forms';
import { formatDateTime, formatNumber } from '@thelamp/i18n';
import { punchFixIssue, timeIn, todayIn } from '@thelamp/shared';
import { Button, Card, Notice, Screen, StatusBadge, Text } from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Camera, Send, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import { useConfig } from '../data';
import { checkEntry, type EntryParts } from '../forms/check';
import { type EntryData, FieldList } from '../forms/fields';
import { PickList } from '../forms/pick-list';
import { SignaturePad } from '../forms/signature-pad';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix } from '../location';
import { useOutboxItems, useSync } from '../sync';
import { geofenceAt, submitEntry } from '../visits';

/** Changes are kept on the phone this long after the last keystroke. */
const SAVE_AFTER_MS = 400;

const NO_ISSUES: ReadonlyMap<string, string> = new Map();

/** The path the form's own photos are taken for, beside its fields' paths. */
const FORM_PHOTOS = '#photos';

/** `/forms/<entry>`: one form entry, a draft to fill or a submitted one to read. */
export function FormEntryScreen({ id }: { id: string }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const sync = useSync();
  const [entry, setEntry] = useState<FormEntry | null | undefined>();
  const owner = client.owner;

  useEffect(() => {
    if (!sync || !owner) return;
    let live = true;
    void sync.entries.get(owner, id).then((found) => {
      if (live) setEntry(found);
    });
    return () => {
      live = false;
    };
  }, [sync, owner, id]);

  if (entry === undefined) {
    return (
      <Screen>
        <Text tone="muted">{t('common.loading')}</Text>
      </Screen>
    );
  }
  if (entry === null) {
    return (
      <Screen>
        <Back />
        <Text tone="muted">{t('entry.gone')}</Text>
      </Screen>
    );
  }
  return <Filling key={entry.id} entry={entry} />;
}

function Back() {
  const { t } = useLanguage();
  return (
    <Button
      variant="ghost"
      icon={ArrowLeft}
      label={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/forms'))}
    />
  );
}

/**
 * Filling a form (spec 8.1 Form): its fields in order, shown as their conditions say, the
 * account it links to, its photos and signature. Every change is kept on the phone as a draft;
 * submitting checks it as the server will and then keeps it, read only, until it is sent.
 */
function Filling({ entry }: { entry: FormEntry }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const accounts = useLocalRows('accounts') ?? [];
  const contacts = useLocalRows('contacts') ?? [];
  const items = useLocalRows('items') ?? [];
  const bundle = config.data?.bundle;
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const form = entry.definition;
  const readOnly = entry.state !== 'draft';
  // A submitted entry waits while its upload is in the outbox.
  const waiting = useOutboxItems().some((item) => item.id === entry.id);

  const [parts, setParts] = useState<EntryParts>({
    values: entry.values,
    accountId: entry.accountId,
    photos: entry.photos,
    signature: entry.signature,
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(parts);

  const today = todayIn(timeZone);
  const lookups = { accounts, contacts, items, today };
  const data: EntryData = {
    ...lookups,
    units: bundle?.catalogue?.units ?? [],
    accountId: parts.accountId,
    now: timeIn(timeZone),
    capture: (what, path) => {
      const request = `${entry.id}|${path}`;
      pending.current.add(path);
      router.push(
        what === 'photo'
          ? { pathname: '/camera', params: { kind: 'evidence', request } }
          : { pathname: '/scan', params: { request } },
      );
    },
    readOnly,
  };

  /** Keeps a change on screen at once and on the phone shortly after. */
  const change = useCallback(
    (patch: Partial<EntryParts>) => {
      setParts((current) => {
        const next = { ...current, ...patch };
        latest.current = next;
        return next;
      });
      if (!sync || !client.owner) return;
      const owner = client.owner;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const { values, accountId, photos, signature } = latest.current;
        void sync.entries
          .save(owner, entry.id, {
            values,
            accountId,
            photos: [...photos],
            signature: signature ? [...signature] : null,
          })
          .catch(() => setFailure(t('entry.not_saved')));
      }, SAVE_AFTER_MS);
    },
    [sync, client, entry.id, t],
  );

  // A change waiting to be kept is kept before the screen goes.
  useEffect(
    () => () => {
      if (timer.current === undefined || !sync || !client.owner || readOnly) return;
      clearTimeout(timer.current);
      const { values, accountId, photos, signature } = latest.current;
      void sync.entries
        .save(client.owner, entry.id, {
          values,
          accountId,
          photos: [...photos],
          signature: signature ? [...signature] : null,
        })
        .catch(() => undefined);
    },
    [sync, client, entry.id, readOnly],
  );

  // Back from the camera or the scanner: what they took goes where it was asked for.
  useFocusEffect(
    useCallback(() => {
      for (const path of [...pending.current]) {
        const taken = takeResults(`${entry.id}|${path}`);
        if (taken.length === 0) continue;
        pending.current.delete(path);
        if (path === FORM_PHOTOS) {
          change({ photos: [...latest.current.photos, ...taken] });
        } else {
          change({ values: setAtPath(latest.current.values, path, taken.at(-1)) });
        }
      }
    }, [entry.id, change]),
  );

  // Once a submit has been tried, problems follow the changes.
  const issues = tried ? checkEntry(form, parts, lookups, t).issues : NO_ISSUES;

  /**
   * Submits the entry (M6): checked as the server will check it, then captured with a fresh fix
   * on the person's shift, inside the visit when the form needs one or the visit is at the same
   * account, and inside the geofence when the form or account type requires it. Saved on the
   * phone and queued to send in one go.
   */
  async function submit() {
    if (!sync || !client.owner || !bundle) return;
    const owner = client.owner;
    setTried(true);
    setFailure(undefined);
    const checked = checkEntry(form, parts, lookups, t);
    if (checked.issues.size > 0) return;
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = undefined;
    const fail = (text: string) => {
      setFailure(text);
      setBusy(false);
    };
    try {
      if (form.shift === 'required' && !(await sync.tracking.current(owner))) {
        fail(t('entry.need_shift'));
        return;
      }
      const visit = await sync.visits.current(owner);
      const inVisit = visit !== null && visit.accountId === parts.accountId;
      if (form.visitSession && !inVisit) {
        fail(t('entry.need_visit'));
        return;
      }
      const found = await currentFix();
      if (found.status !== 'ready') {
        fail(t(found.status === 'denied' ? 'shift.fix_denied' : 'shift.fix_unavailable'));
        return;
      }
      const issue = punchFixIssue(found.fix);
      if (issue) {
        fail(t(issue === 'GPS_MOCKED' ? 'shift.fix_mocked' : 'shift.fix_vague'));
        return;
      }
      const account = parts.accountId
        ? accounts.find((entry) => entry.id === parts.accountId)
        : undefined;
      if (account && form.accountLink.mode !== 'none') {
        const type = bundle.accountTypes?.find((entry) => entry.key === account.type);
        const fence = geofenceAt(account, type, bundle.settings, found.fix, form);
        if (fence.policy === 'required' && fence.result === 'outside') {
          fail(
            t('entry.too_far', {
              distance: formatNumber(fence.distanceM ?? 0, { locale }),
              radius: formatNumber(fence.radiusM, { locale }),
            }),
          );
          return;
        }
      }
      await submitEntry(sync, owner, {
        id: entry.id,
        changes: {
          values: checked.values,
          accountId: parts.accountId,
          photos: [...parts.photos],
          signature: parts.signature ? [...parts.signature] : null,
        },
        fix: found.fix,
        visitId: inVisit ? visit.visitId : null,
      });
      await sync.runner.refresh();
      void sync.runner.sync();
      if (inVisit) {
        router.replace({ pathname: '/accounts/[id]', params: { id: visit.accountId } });
      } else {
        router.replace('/forms');
      }
    } catch {
      fail(t('entry.not_saved'));
    }
  }

  async function discard() {
    if (!sync || !client.owner) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    await sync.entries.discard(client.owner, entry.id);
    router.replace('/forms');
  }

  const link = form.accountLink;
  const linkable =
    link.mode === 'none'
      ? []
      : accounts
          .filter((account) => link.accountTypes.includes(account.type))
          .filter((account) => account.status !== 'inactive' || account.id === parts.accountId)
          .map((account) => ({ value: account.id, label: account.name, detail: account.code }));

  return (
    <Screen>
      <Back />
      <Text variant="headingXl" role="heading">
        {form.name[locale].one}
      </Text>
      {readOnly && !waiting ? (
        <StatusBadge variant="success" label={t('entry.state_sent')} />
      ) : readOnly ? (
        <View style={styles.stack}>
          <StatusBadge variant="waiting" label={t('entry.state_queued')} />
          <Notice>
            {t('entry.queued_note', {
              when: formatDateTime(new Date(entry.submittedAt ?? entry.updatedAt), {
                locale,
                timeZone,
              }),
            })}
          </Notice>
        </View>
      ) : (
        <Text tone="muted">{t('entry.saved_on_phone')}</Text>
      )}
      {tried && issues.size > 0 ? (
        <Text tone="danger" role="alert">
          {t('entry.check_fields', { count: issues.size })}
        </Text>
      ) : null}

      {link.mode !== 'none' ? (
        <View style={styles.stack}>
          <PickList
            title={`${t('entry.account')}${link.mode === 'required' ? ' *' : ''}`}
            entries={linkable}
            value={parts.accountId ?? ''}
            onChange={(accountId) => !readOnly && change({ accountId })}
            empty={t('entry.no_accounts')}
          />
          {issues.get('accountId') ? (
            <Text variant="bodySm" tone="danger" role="alert">
              {issues.get('accountId')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <FieldList
        fields={form.fields}
        values={parts.values}
        onChange={(values) => change({ values })}
        issues={issues}
        data={data}
      />

      {form.photos ? (
        <Card style={styles.stack}>
          <Text variant="labelMd">
            {t('entry.photos')}
            {form.photos.min > 0 ? (
              <Text variant="labelMd" tone="danger">
                {' *'}
              </Text>
            ) : null}
          </Text>
          <Text tone="muted">
            {t('entry.photos_count', {
              count: parts.photos.length,
              min: form.photos.min,
              max: form.photos.max,
            })}
          </Text>
          {parts.photos.map((photo, index) => (
            <View key={photo} style={styles.row}>
              <Text style={styles.grow}>{t('entry.photo_number', { count: index + 1 })}</Text>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  icon={X}
                  label={t('entry.remove_photo', { count: index + 1 })}
                  onPress={() => change({ photos: parts.photos.filter((kept) => kept !== photo) })}
                />
              )}
            </View>
          ))}
          {issues.get('photos') ? (
            <Text variant="bodySm" tone="danger" role="alert">
              {issues.get('photos')}
            </Text>
          ) : null}
          {readOnly || parts.photos.length >= form.photos.max ? null : (
            <Button
              variant="secondary"
              icon={Camera}
              label={t('entry.photo_take')}
              onPress={() => data.capture('photo', FORM_PHOTOS)}
            />
          )}
        </Card>
      ) : null}

      {form.signature !== 'none' ? (
        <SignaturePad
          label={t('entry.signature')}
          required={form.signature === 'required'}
          strokes={parts.signature ?? []}
          onChange={(signature) => change({ signature: signature.length > 0 ? signature : null })}
          readOnly={readOnly}
          {...(issues.get('signature') ? { error: issues.get('signature')! } : {})}
        />
      ) : null}

      {failure ? (
        <Text tone="danger" role="alert">
          {failure}
        </Text>
      ) : null}
      {readOnly ? null : (
        <View style={styles.stack}>
          <Button
            variant="primary"
            icon={Send}
            label={t('entry.submit')}
            busy={busy}
            onPress={() => void submit()}
          />
          {discarding ? (
            <Card style={styles.stack} role="group" aria-label={t('entry.discard_question')}>
              <Text>{t('entry.discard_question')}</Text>
              <View style={styles.row}>
                <Button
                  variant="danger"
                  icon={Trash2}
                  label={t('entry.discard')}
                  onPress={() => void discard()}
                />
                <Button
                  variant="ghost"
                  label={t('common.cancel')}
                  onPress={() => setDiscarding(false)}
                />
              </View>
            </Card>
          ) : (
            <Button
              variant="ghost"
              icon={Trash2}
              label={t('entry.discard')}
              onPress={() => setDiscarding(true)}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

/** A value set at a path such as `notes` or `visits[1].photo`, leaving the rest as it was. */
export function setAtPath(values: Values, path: string, value: unknown): Values {
  const match = /^([a-z][a-z0-9_]*)\[(\d+)\]\.(.+)$/.exec(path);
  if (!match) return { ...values, [path]: value };
  const [, key, index, rest] = match;
  const list = Array.isArray(values[key!]) ? [...(values[key!] as Values[])] : [];
  list[Number(index)] = setAtPath(list[Number(index)] ?? {}, rest!, value);
  return { ...values, [key!]: list };
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
});
