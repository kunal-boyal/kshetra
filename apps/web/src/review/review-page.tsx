import type { FormView } from '@kshetra/forms';
import { formatNumber } from '@kshetra/i18n';
import {
  BulkReviewResult,
  GEOFENCE_RESULTS,
  REVIEW_NOTE_MIN,
  ReviewItem,
  ReviewRulesResult,
  SUBMISSION_FLAGS,
  type ReviewPhoto,
} from '@kshetra/shared';
import {
  Button,
  Checkbox,
  Confirm,
  EmptyState,
  Icon,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@kshetra/ui-web';
import { Link } from '@tanstack/react-router';
import { Check, ClipboardCheck, Pencil, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, write } from '../people/data';
import { fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import {
  type QueueFilters,
  usePhotoLink,
  useRefreshReview,
  useReviewQueue,
  useReviewRules,
} from './data';

type Translate = ReturnType<typeof useLanguage>['t'];

const STATUS_VARIANT = { pending: 'pending', approved: 'success', rejected: 'danger' } as const;

/**
 * Evidence review (M7, spec 8.2): the submissions of the people the viewer looks after, filtered
 * as they choose, each with where and when it was filled, its photos and flags, and what was
 * decided. Approve, reject with a reason, change a decision, or approve many without flags at
 * once. Those who set the rules also set automatic approval here.
 */
export function ReviewPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const [filters, setFilters] = useState<QueueFilters>({ status: 'pending' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAsked, setBulkAsked] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkReviewResult>();
  const [bulkFailure, setBulkFailure] = useState<unknown>();
  const refresh = useRefreshReview();
  const queue = useReviewQueue(filters);
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const forms = config.data?.bundle.forms ?? [];
  const mayBulk = access.can('submission.review_bulk') && filters.status === 'pending';

  const filter = (patch: Partial<QueueFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSelected(new Set());
    setBulkResult(undefined);
  };

  async function approveSelected() {
    setBulkBusy(true);
    setBulkFailure(undefined);
    try {
      const result = await write(client, 'POST', '/v1/reviews/bulk', BulkReviewResult, {
        ids: [...selected],
      });
      setBulkResult(result);
      setSelected(new Set());
      setBulkAsked(false);
      await refresh();
    } catch (caught) {
      setBulkFailure(caught);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('review.title')} intro={t('review.intro')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label={t('review.filter_status')}
          value={filters.status}
          options={(['pending', 'approved', 'rejected'] as const).map((status) => ({
            value: status,
            label: t(`review.status_${status}`),
          }))}
          onChange={(event) => filter({ status: event.target.value as QueueFilters['status'] })}
        />
        <SelectField
          label={t('review.filter_form')}
          none={t('review.any')}
          value={filters.formKey ?? ''}
          options={forms.map((form) => ({ value: form.key, label: form.name[locale].one }))}
          onChange={(event) => filter({ formKey: event.target.value || undefined })}
        />
        <SelectField
          label={t('review.filter_flag')}
          none={t('review.any')}
          value={filters.flag ?? ''}
          options={SUBMISSION_FLAGS.map((flag) => ({
            value: flag,
            label: t(`submissions.flag_${flag}`),
          }))}
          onChange={(event) => filter({ flag: event.target.value || undefined })}
        />
        <SelectField
          label={t('review.filter_geofence')}
          none={t('review.any')}
          value={filters.geofence ?? ''}
          options={GEOFENCE_RESULTS.map((result) => ({
            value: result,
            label: t(`review.geofence_${result}`),
          }))}
          onChange={(event) => filter({ geofence: event.target.value || undefined })}
        />
        <TextField
          label={t('review.from')}
          type="date"
          value={filters.from ?? ''}
          onChange={(event) => filter({ from: event.target.value || undefined })}
        />
        <TextField
          label={t('review.to')}
          type="date"
          value={filters.to ?? ''}
          onChange={(event) => filter({ to: event.target.value || undefined })}
        />
      </div>

      {bulkResult ? (
        <p role="status">
          {t('review.bulk_done', { count: bulkResult.approved.length })}
          {bulkResult.skipped.length > 0
            ? ` ${t('review.bulk_skipped', { count: bulkResult.skipped.length })}`
            : ''}
        </p>
      ) : null}
      {mayBulk && selected.size > 0 ? (
        bulkAsked ? (
          <Confirm
            question={t('review.bulk_question', { count: selected.size })}
            action={
              <Button
                variant="primary"
                busy={bulkBusy}
                icon={<Icon icon={Check} />}
                onClick={() => void approveSelected()}
              >
                {t('review.bulk', { count: selected.size })}
              </Button>
            }
            cancel={
              <Button variant="secondary" onClick={() => setBulkAsked(false)}>
                {t('common.cancel')}
              </Button>
            }
          >
            <p>{t('review.bulk_note')}</p>
            {bulkFailure ? (
              <p className="ks-help error" role="alert">
                {errorMessage(bulkFailure, t)}
              </p>
            ) : null}
          </Confirm>
        ) : (
          <Button
            variant="primary"
            className="self-start"
            icon={<Icon icon={Check} />}
            onClick={() => setBulkAsked(true)}
          >
            {t('review.bulk', { count: selected.size })}
          </Button>
        )
      ) : null}

      {queue.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(queue.error, t)}
        </p>
      ) : queue.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Icon icon={ClipboardCheck} />} title={t('review.empty_title')}>
          {t('review.empty_body')}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t('review.title')}>
          {items.map((item) => (
            <li key={item.id}>
              <Card
                item={item}
                form={forms.find((form) => form.key === item.form.key)}
                {...(mayBulk && item.status === 'pending' && item.flags.length === 0
                  ? {
                      selected: selected.has(item.id),
                      onSelect: (on: boolean) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (on) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        }),
                    }
                  : {})}
              />
            </li>
          ))}
        </ul>
      )}
      {queue.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          busy={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          {t('common.load_more')}
        </Button>
      ) : null}

      {access.can('review_rules.manage') ? <Rules /> : null}
    </div>
  );
}

/** A filled-in value as a reviewer reads it. */
function valueText(value: unknown, t: Translate): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'review.yes' : 'review.no');
  if (Array.isArray(value)) return t('review.items', { count: value.length });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One submission to review: what it is, where and when, its evidence, and the decisions. */
function Card({
  item,
  form,
  selected,
  onSelect,
}: {
  item: ReviewItem;
  form: FormView | undefined;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const refresh = useRefreshReview();
  const [noting, setNoting] = useState<'rejected' | 'approved' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const name = item.form.name[locale].one;
  const metres = (value: number) => formatNumber(value, { locale });
  const labels = new Map(
    (form?.fields ?? []).flatMap((field) =>
      'label' in field && field.label ? [[field.key, field.label[locale]] as const] : [],
    ),
  );

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/submissions/${item.id}/review`, ReviewItem, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNoting(null);
      setNote('');
      await refresh();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  // A rejection, and any change of mind, needs a reason first.
  const ask = (decision: 'approved' | 'rejected') =>
    decision === 'rejected' || item.status !== 'pending'
      ? setNoting(decision)
      : void decide(decision);

  return (
    <article className="ks-card flex flex-col gap-4" aria-label={`${name}, ${item.user.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="heading-md">{name}</h2>
          <p>
            <Link to="/people/$userId" params={{ userId: item.user.id }}>
              {t('review.by', { name: item.user.name })}
            </Link>
            {item.account ? (
              <>
                {' · '}
                <Link to="/accounts/$accountId" params={{ accountId: item.account.id }}>
                  {item.account.name}
                </Link>
              </>
            ) : null}
          </p>
          <p className="ks-muted">
            {t('review.captured', {
              when: dates.dateTime(item.capturedAt),
              received: dates.dateTime(item.receivedAt),
            })}
          </p>
          <p className="ks-muted">
            {t('review.where', {
              lat: item.location.lat.toFixed(5),
              lng: item.location.lng.toFixed(5),
              accuracy: Math.round(item.accuracy),
            })}
          </p>
        </div>
        {onSelect ? (
          <Checkbox
            label={t('review.select')}
            checked={selected ?? false}
            onChange={(event) => onSelect(event.target.checked)}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        <StatusBadge variant={STATUS_VARIANT[item.status]}>
          {t(`review.status_${item.status}`)}
        </StatusBadge>
        {item.autoApproved ? (
          <StatusBadge variant="info">{t('review.auto_approved')}</StatusBadge>
        ) : null}
        {item.geofence === 'inside' || item.geofence === 'outside' ? (
          <StatusBadge variant={item.geofence === 'inside' ? 'success' : 'danger'}>
            {t(item.geofence === 'inside' ? 'submissions.inside' : 'submissions.outside', {
              distance: metres(item.distanceM ?? 0),
            })}
          </StatusBadge>
        ) : item.geofence === 'unknown' ? (
          <StatusBadge variant="neutral">{t('submissions.unknown')}</StatusBadge>
        ) : null}
        {item.flags.map((flag) => (
          <StatusBadge key={flag} variant="danger">
            {t(`submissions.flag_${flag}`)}
          </StatusBadge>
        ))}
        {item.integrityWarning ? (
          <StatusBadge variant="danger">{t('review.integrity')}</StatusBadge>
        ) : null}
      </div>
      {item.autoApproveAt ? (
        <p className="ks-muted">
          {t('review.auto_at', { when: dates.dateTime(item.autoApproveAt) })}
        </p>
      ) : null}

      <dl
        className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]"
        aria-label={t('review.values')}
      >
        {Object.entries(item.values).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="ks-muted">{labels.get(key) ?? key}</dt>
            <dd>{valueText(value, t)}</dd>
          </div>
        ))}
      </dl>

      {item.photoDetails.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t('review.photos')}>
          <h3 className="font-semibold">{t('review.photos')}</h3>
          <ul className="flex flex-wrap gap-3">
            {item.photoDetails.map((photo, index) => (
              <li key={photo.id}>
                <Photo photo={photo} number={index + 1} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.reviews.length > 0 ? (
        <section className="flex flex-col gap-1" aria-label={t('review.history')}>
          <h3 className="font-semibold">{t('review.history')}</h3>
          <ol className="flex flex-col gap-1">
            {item.reviews.map((review) => (
              <li key={review.at}>
                {review.reviewer
                  ? t('review.decided_by', {
                      decision: t(`review.status_${review.decision}`),
                      name: review.reviewer.name,
                      when: dates.dateTime(review.at),
                    })
                  : t('review.decided_auto', {
                      decision: t(`review.status_${review.decision}`),
                      when: dates.dateTime(review.at),
                    })}
                {review.note ? <span className="ks-muted"> · {review.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {failure && !fieldErrors(failure).note ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {noting ? (
        <TextAreaField
          label={t('review.why')}
          help={t('review.why_help', { min: REVIEW_NOTE_MIN })}
          required
          rows={2}
          value={note}
          {...(fieldErrors(failure).note ? { error: fieldErrors(failure).note } : {})}
          onChange={(event) => setNote(event.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {noting ? (
          <>
            <Button
              variant={noting === 'rejected' ? 'danger' : 'primary'}
              busy={busy}
              icon={<Icon icon={noting === 'rejected' ? X : Check} />}
              onClick={() => void decide(noting)}
            >
              {t(noting === 'rejected' ? 'review.reject' : 'review.approve')}
            </Button>
            <Button variant="secondary" onClick={() => setNoting(null)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : item.status === 'pending' ? (
          <>
            <Button
              variant="primary"
              busy={busy}
              icon={<Icon icon={Check} />}
              onClick={() => ask('approved')}
            >
              {t('review.approve')}
            </Button>
            <Button variant="secondary" icon={<Icon icon={X} />} onClick={() => ask('rejected')}>
              {t('review.reject')}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            icon={<Icon icon={Pencil} />}
            onClick={() => ask(item.status === 'approved' ? 'rejected' : 'approved')}
          >
            {t('review.change')}
          </Button>
        )}
      </div>
    </article>
  );
}

/** A photo's thumbnail, with how it was taken, when, and how far away. */
function Photo({ photo, number }: { photo: ReviewPhoto; number: number }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const link = usePhotoLink(photo.id);
  const alt = t('review.photo_alt', { number });
  return (
    <figure className="flex w-40 flex-col gap-1">
      {link.data ? (
        <img
          src={link.data.url}
          alt={alt}
          className="aspect-square w-40 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <div className="ks-muted flex aspect-square w-40 items-center justify-center rounded-md border">
          {alt}
        </div>
      )}
      <figcaption className="ks-help">
        {[
          photo.source ? t(`review.photo_source_${photo.source}`) : null,
          photo.capturedAt ? dates.dateTime(photo.capturedAt) : null,
          photo.distanceM !== null
            ? t('review.photo_far', { distance: formatNumber(photo.distanceM, { locale }) })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        {photo.duplicate ? (
          <>
            {' '}
            <StatusBadge variant="danger">{t('review.photo_repeat')}</StatusBadge>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Automatic approval: the switch and how long it waits (M7). */
function Rules() {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const rules = useReviewRules(true);
  const [draft, setDraft] = useState<{ autoApproval: boolean; delayHours: string }>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const shown =
    draft ??
    (rules.data
      ? { autoApproval: rules.data.autoApproval, delayHours: String(rules.data.delayHours) }
      : undefined);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!shown) return;
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    try {
      const result = await write(client, 'PUT', '/v1/review-rules', ReviewRulesResult, {
        autoApproval: shown.autoApproval,
        delayHours: Number(shown.delayHours),
      });
      queryClient.setQueryData(['review-rules'], result);
      setDraft(undefined);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('review.rules')}>
      {rules.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(rules.error, t)}
        </p>
      ) : !shown ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
          <Checkbox
            label={t('review.rules_on')}
            detail={t('review.rules_on_help')}
            checked={shown.autoApproval}
            onChange={(event) => setDraft({ ...shown, autoApproval: event.target.checked })}
          />
          <TextField
            label={t('review.rules_delay')}
            type="number"
            min={1}
            max={168}
            numeric
            className="max-w-xs"
            value={shown.delayHours}
            {...(fieldErrors(failure).delayHours ? { error: fieldErrors(failure).delayHours } : {})}
            onChange={(event) => setDraft({ ...shown, delayHours: event.target.value })}
          />
          {failure && !fieldErrors(failure).delayHours ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
          {saved ? <p role="status">{t('review.rules_saved')}</p> : null}
          <Button type="submit" variant="primary" className="self-start" busy={busy}>
            {t('review.rules_save')}
          </Button>
        </form>
      )}
    </Section>
  );
}
