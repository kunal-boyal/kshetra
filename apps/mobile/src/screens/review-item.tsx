import { radius, spacing } from '@kshetra/design-tokens';
import { formatDateTime, formatNumber } from '@kshetra/i18n';
import { REVIEW_NOTE_MIN, type ReviewItem, type ReviewPhoto } from '@kshetra/shared';
import {
  Button,
  Card,
  Icon,
  ListGroup,
  ListRow,
  Screen,
  StatusBadge,
  Text,
  TextField,
} from '@kshetra/ui-mobile';
import { ApiError } from '@kshetra/api-client';
import { router } from 'expo-router';
import { ArrowLeft, Check, Image as ImageIcon, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useDecide, usePhotoLink, useQueuedItem } from '../review';

type Translate = ReturnType<typeof useLanguage>['t'];

/** A filled-in value as a reviewer reads it. */
function valueText(value: unknown, t: Translate): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'review.yes' : 'review.no');
  if (Array.isArray(value)) return t('review.items', { count: value.length });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

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
 * `/review/<id>`: one submission waiting for the manager's review (M7, spec 8.1): who sent it,
 * where and when, its values, photos and flags; approve, or reject with a reason.
 */
export function ReviewItemScreen({ id }: { id: string }) {
  const { t } = useLanguage();
  const { item, loading } = useQueuedItem(id);
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
        <Text tone="muted">{t('team.gone')}</Text>
      </Screen>
    );
  }
  return <Deciding item={item} />;
}

function Deciding({ item }: { item: ReviewItem }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const decide = useDecide();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const when = (iso: string) => formatDateTime(new Date(iso), { locale, timeZone });
  const metres = (value: number) => formatNumber(value, { locale });
  const form = config.data?.bundle.forms?.find((entry) => entry.key === item.form.key);
  const labels = new Map(
    (form?.fields ?? []).flatMap((field) =>
      'label' in field && field.label ? [[field.key, field.label[locale]] as const] : [],
    ),
  );

  async function send(decision: 'approved' | 'rejected') {
    setFailure(undefined);
    setNoteError(undefined);
    if (decision === 'rejected' && note.trim().length < REVIEW_NOTE_MIN) {
      setNoteError(t('review.why_help', { min: REVIEW_NOTE_MIN }));
      return;
    }
    setBusy(true);
    try {
      await decide(item.id, decision, decision === 'rejected' ? note : undefined);
      router.replace('/team');
    } catch (error) {
      const noteIssue =
        error instanceof ApiError && error.details?.some((detail) => detail.path === 'note');
      if (noteIssue) setNoteError(t('review.why_help', { min: REVIEW_NOTE_MIN }));
      else setFailure(errorMessage(error, t));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Back />
      <Text variant="headingXl" role="heading">
        {item.form.name[locale].one}
      </Text>
      <Text>{t('review.by', { name: item.user.name })}</Text>
      {item.account ? <Text tone="muted">{item.account.name}</Text> : null}
      <Text tone="muted">
        {t('review.captured', { when: when(item.capturedAt), received: when(item.receivedAt) })}
      </Text>

      <View style={styles.badges}>
        {item.geofence === 'inside' || item.geofence === 'outside' ? (
          <StatusBadge
            variant={item.geofence === 'inside' ? 'success' : 'danger'}
            label={t(item.geofence === 'inside' ? 'submissions.inside' : 'submissions.outside', {
              distance: metres(item.distanceM ?? 0),
            })}
          />
        ) : item.geofence === 'unknown' ? (
          <StatusBadge variant="neutral" label={t('submissions.unknown')} />
        ) : null}
        {item.flags.map((flag) => (
          <StatusBadge key={flag} variant="danger" label={t(`submissions.flag_${flag}`)} />
        ))}
        {item.integrityWarning ? (
          <StatusBadge variant="danger" label={t('review.integrity')} />
        ) : null}
      </View>
      {item.autoApproveAt ? (
        <Text tone="muted">{t('review.auto_at', { when: when(item.autoApproveAt) })}</Text>
      ) : null}

      <ListGroup title={t('review.values')}>
        {Object.entries(item.values).map(([key, value]) => (
          <ListRow key={key} label={valueText(value, t)} detail={labels.get(key) ?? key} />
        ))}
      </ListGroup>

      {item.photoDetails.length > 0 ? (
        <View style={styles.stack}>
          <Text variant="headingMd">{t('review.photos')}</Text>
          <View style={styles.photos}>
            {item.photoDetails.map((photo, index) => (
              <Photo key={photo.id} photo={photo} number={index + 1} />
            ))}
          </View>
        </View>
      ) : null}

      <Card style={styles.stack}>
        {rejecting ? (
          <TextField
            label={t('review.why')}
            required
            multiline
            value={note}
            onChangeText={setNote}
            {...(noteError
              ? { error: noteError }
              : { help: t('review.why_help', { min: REVIEW_NOTE_MIN }) })}
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
              label={t('review.reject')}
              busy={busy}
              onPress={() => void send('rejected')}
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
              label={t('review.approve')}
              busy={busy}
              onPress={() => void send('approved')}
            />
            <Button
              variant="secondary"
              icon={X}
              label={t('review.reject')}
              onPress={() => setRejecting(true)}
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}

/** A photo's thumbnail, with how it was taken and how far away. */
function Photo({ photo, number }: { photo: ReviewPhoto; number: number }) {
  const { t, locale } = useLanguage();
  const link = usePhotoLink(photo.id);
  const alt = t('review.photo_alt', { number });
  const caption = [
    photo.source ? t(`review.photo_source_${photo.source}`) : null,
    photo.distanceM !== null
      ? t('review.photo_far', { distance: formatNumber(photo.distanceM, { locale }) })
      : null,
    photo.duplicate ? t('review.photo_repeat') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.photo}>
      {link.data ? (
        <Image
          source={{ uri: link.data.url }}
          accessibilityLabel={alt}
          role="img"
          style={styles.thumbnail}
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholder]} role="img" aria-label={alt}>
          <Icon icon={ImageIcon} />
        </View>
      )}
      <Text variant="bodySm" tone={photo.duplicate ? 'danger' : 'muted'}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space1 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3 },
  photo: { width: 140, gap: spacing.space1 },
  thumbnail: { width: 140, height: 140, borderRadius: radius.radiusMd },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
