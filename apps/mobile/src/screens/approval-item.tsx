import { spacing } from '@thelamp/design-tokens';
import { formatDateTime } from '@thelamp/i18n';
import type { ApprovalResult, ApprovalStep } from '@thelamp/shared';
import {
  Button,
  Card,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { ApiError } from '@thelamp/api-client';
import { router } from 'expo-router';
import { ArrowLeft, Check, Circle, Clock, Redo2, Send, X } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDecideRequest, useWaitingRequest } from '../approvals';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';

/** Reasons need at least this many characters, as the server checks (M15). */
const NOTE_MIN = 3;

function Back() {
  const { t } = useLanguage();
  return (
    <Button
      variant="ghost"
      icon={ArrowLeft}
      label={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/team'))}
    />
  );
}

/**
 * `/approvals/<id>`: one request waiting for the person's decision (M15): what it is, who asked
 * and when, its chain so far; approve, or reject with a reason.
 */
export function ApprovalItemScreen({ id }: { id: string }) {
  const { t } = useLanguage();
  const { item, loading } = useWaitingRequest(id);
  if (loading) {
    return (
      <Screen>
        <Text tone="muted">{t('common.loading')}</Text>
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <Back />
        <Text tone="muted">{t('team.request_gone')}</Text>
      </Screen>
    );
  }
  return <Deciding item={item} />;
}

function Deciding({ item }: { item: ApprovalResult }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const decide = useDecideRequest();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const when = (iso: string) => formatDateTime(new Date(iso), { locale, timeZone });
  const type = t(`approval.type_${item.requestType}`);

  async function send(decision: 'approve' | 'reject') {
    setFailure(undefined);
    setNoteError(undefined);
    if (decision === 'reject' && note.trim().length < NOTE_MIN) {
      setNoteError(t('approvals.why_help'));
      return;
    }
    setBusy(true);
    try {
      await decide(item, decision, decision === 'reject' ? note : undefined);
      router.replace('/team');
    } catch (error) {
      const noteIssue =
        error instanceof ApiError && error.details?.some((detail) => detail.path === 'note');
      if (noteIssue) setNoteError(t('approvals.why_help'));
      else setFailure(errorMessage(error, t));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Back />
      <Text tone="muted">{type}</Text>
      <Text variant="headingXl" role="heading">
        {item.subject.title || type}
      </Text>
      <Text>{t('approvals.asked', { name: item.requester.name, when: when(item.createdAt) })}</Text>

      {item.steps.length > 0 ? (
        <ListGroup title={t('approvals.chain')}>
          {item.steps.map((step) => (
            <StepRow key={step.index} step={step} when={when} />
          ))}
        </ListGroup>
      ) : null}

      {item.page ? (
        // Decided on its own screen, which asks for more than a note (decision D78).
        <Notice>{t('approvals.decide_in_portal')}</Notice>
      ) : (
        <Card style={styles.stack}>
          {rejecting ? (
            <TextField
              label={t('approvals.why')}
              required
              multiline
              value={note}
              onChangeText={setNote}
              {...(noteError ? { error: noteError } : { help: t('approvals.why_help') })}
            />
          ) : null}
          {failure ? (
            <Text tone="danger" role="alert">
              {failure}
            </Text>
          ) : null}
          {rejecting ? (
            <View style={styles.row}>
              <Button
                variant="danger"
                icon={X}
                label={t('approvals.reject')}
                busy={busy}
                onPress={() => void send('reject')}
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setRejecting(false)}
              />
            </View>
          ) : (
            <View style={styles.row}>
              <Button
                variant="primary"
                icon={Check}
                label={t('approvals.approve')}
                busy={busy}
                onPress={() => void send('approve')}
              />
              <Button
                variant="secondary"
                icon={X}
                label={t('approvals.reject')}
                onPress={() => setRejecting(true)}
              />
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}

/** One step of the chain (components/ApprovalSteps), its state in words. */
function StepRow({ step, when }: { step: ApprovalStep; when: (iso: string) => string }) {
  const { t } = useLanguage();
  const names = step.approvers.length
    ? step.approvers.map((person) => person.name).join(', ')
    : t('approvals.nobody');
  const acted = [
    ...(step.note ? [t('approvals.note', { note: step.note })] : []),
    ...(step.actedAt ? [when(step.actedAt)] : []),
  ].join(' · ');
  switch (step.status) {
    case 'approved':
      return (
        <ListRow
          icon={Check}
          label={t('approvals.step_approved', { name: step.actedBy?.name ?? names })}
          detail={acted}
        />
      );
    case 'rejected':
      return (
        <ListRow
          icon={X}
          tone="danger"
          label={t('approvals.step_rejected', { name: step.actedBy?.name ?? names })}
          detail={acted}
        />
      );
    case 'skipped':
      return (
        <ListRow
          icon={Redo2}
          label={t('approvals.step_skipped')}
          {...(step.skipReason ? { detail: t(`approvals.skip_${step.skipReason}`) } : {})}
        />
      );
    case 'pending':
      return (
        <ListRow
          icon={Clock}
          label={t('approvals.step_pending', { names })}
          detail={[
            step.escalated ? t('approvals.step_escalated') : null,
            step.fallback ? t('approvals.step_fallback') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      );
    case 'waiting':
      return <ListRow icon={Circle} label={names} detail={t('approvals.step_not_reached')} />;
  }
}

/** Requests waiting for the person's decision, for the Team tab (M15). */
export function ApprovalRows({ items }: { items: readonly ApprovalResult[] }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  return items.map((item) => (
    <ListRow
      key={item.id}
      icon={Send}
      label={`${t(`approval.type_${item.requestType}`)} · ${item.requester.name}`}
      detail={[item.subject.title, formatDateTime(new Date(item.createdAt), { locale, timeZone })]
        .filter(Boolean)
        .join(' · ')}
      onPress={() => router.push({ pathname: '/approvals/[id]', params: { id: item.id } })}
    />
  ));
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
