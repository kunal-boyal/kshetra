import { formatNumber } from '@thelamp/i18n';
import {
  BULK_REVIEW_MAX,
  BulkReviewResult,
  GEOFENCE_RESULTS,
  type ReviewItem,
  ReviewQueueResult,
  ReviewRulesResult,
  SUBMISSION_FLAGS,
} from '@thelamp/shared';
import {
  Avatar,
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  PageHeader,
  SelectField,
  SplitDetail,
  TextField,
} from '@thelamp/ui-web';
import { Check, ClipboardCheck, SlidersHorizontal } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors, Section, useDates } from '../people/shared';
import { type QueueFilters, useRefreshReview, useReviewQueue, useReviewRules } from './data';
import { DANGER_FLAGS, ReviewDetail } from './review-detail';

/** The queue's views: its chips, each a status, with "with flags" the waiting ones that have one. */
type View = 'pending' | 'flagged' | 'approved' | 'rejected';

/** The narrowing beside the view, behind More filters. */
type Narrowing = Omit<QueueFilters, 'status' | 'flagged'>;

/** When a submission was filled: the time today, else the date. */
function useWhen() {
  const access = useAccess();
  const dates = useDates(access.timezone);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: access.timezone }).format(new Date());
  return (at: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: access.timezone }).format(new Date(at)) === today
      ? dates.time(at)
      : dates.date(at.slice(0, 10));
}

/**
 * Evidence review (M7, spec 8.2, decision D104): the submissions of the people the viewer looks
 * after as a compact queue beside the chosen one's detail. Chips choose waiting, with flags,
 * approved or rejected, with their counts; more filters narrow by form, flag, place and dates.
 * Approve, reject with a reason, change a decision, or approve every clean one at once. Those who
 * set the rules also set automatic approval here.
 */
export function ReviewPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const when = useWhen();
  const refresh = useRefreshReview();
  const [view, setView] = useState<View>('pending');
  const [narrowing, setNarrowing] = useState<Narrowing>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [cleanAsked, setCleanAsked] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanResult, setCleanResult] = useState<BulkReviewResult>();
  const [cleanFailure, setCleanFailure] = useState<unknown>();
  const filters: QueueFilters = {
    ...narrowing,
    status: view === 'flagged' ? 'pending' : view,
    ...(view === 'flagged' ? { flagged: 'yes' as const } : {}),
  };
  const queue = useReviewQueue(filters);
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = queue.data?.pages[0]?.summary ?? null;
  const forms = config.data?.bundle.forms ?? [];
  const chosen = items.find((item) => item.id === chosenId) ?? items[0] ?? null;
  const count = (n: number) => formatNumber(n, { locale });
  const clean = summary?.counts.clean ?? 0;
  const mayClean = access.can('submission.review_bulk') && clean > 0;

  const choose = (next: View) => {
    setView(next);
    setChosenId(null);
    setCleanResult(undefined);
  };
  const narrow = (patch: Partial<Narrowing>) => {
    setNarrowing((current) => ({ ...current, ...patch }));
    setChosenId(null);
  };

  /** Chooses a row; where the detail stacks under the queue (1024 px and less), goes to it. */
  const show = (id: string) => {
    setChosenId(id);
    if (window.matchMedia?.('(max-width: 1024px)').matches) {
      requestAnimationFrame(() => document.getElementById('review-detail')?.scrollIntoView());
    }
  };

  /** After a decision, the next one in the queue is chosen. */
  const decided = () => {
    if (!chosen) return;
    const at = items.findIndex((item) => item.id === chosen.id);
    setChosenId(items[at + 1]?.id ?? items[at - 1]?.id ?? null);
  };

  /** Approves every clean waiting submission, up to the bulk limit, after asking. */
  async function approveClean() {
    setCleanBusy(true);
    setCleanFailure(undefined);
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({
          status: 'pending',
          flagged: 'no',
          limit: '100',
          ...Object.fromEntries(
            Object.entries(narrowing).filter((entry): entry is [string, string] => !!entry[1]),
          ),
          ...(cursor ? { cursor } : {}),
        });
        const page = await read(client, `/v1/reviews/queue?${query}`, ReviewQueueResult);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor && ids.length < BULK_REVIEW_MAX);
      if (ids.length > 0) {
        setCleanResult(
          await write(client, 'POST', '/v1/reviews/bulk', BulkReviewResult, {
            ids: ids.slice(0, BULK_REVIEW_MAX),
          }),
        );
      }
      setCleanAsked(false);
      await refresh();
    } catch (caught) {
      setCleanFailure(caught);
    } finally {
      setCleanBusy(false);
    }
  }

  const columns: Column<ReviewItem>[] = [
    {
      key: 'person',
      header: t('review.col_person'),
      render: (item) => (
        <button
          type="button"
          className="ks-cell-link flex items-center gap-2 font-semibold whitespace-nowrap"
          aria-pressed={item.id === chosen?.id}
          onClick={() => show(item.id)}
        >
          <Avatar name={item.user.name} id={item.user.id} size="sm" />
          {item.user.name}
        </button>
      ),
    },
    { key: 'form', header: t('review.col_form'), render: (item) => item.form.name[locale].one },
    {
      key: 'account',
      header: t('review.col_account'),
      render: (item) => item.account?.name ?? '—',
    },
    {
      key: 'when',
      header: t('review.col_when'),
      align: 'num',
      render: (item) => <span className="whitespace-nowrap">{when(item.capturedAt)}</span>,
    },
    {
      key: 'flags',
      header: t('review.col_flags'),
      render: (item) => {
        // Danger first, as the detail draws them, so the one the row shows is the worst.
        const flags = [
          ...item.flags
            .filter((flag) => DANGER_FLAGS.has(flag))
            .map((flag) => ({ text: t(`submissions.flag_${flag}`), danger: true })),
          ...(item.integrityWarning ? [{ text: t('review.integrity'), danger: true }] : []),
          ...item.flags
            .filter((flag) => !DANGER_FLAGS.has(flag))
            .map((flag) => ({ text: t(`submissions.flag_${flag}`), danger: false })),
        ];
        if (flags.length === 0) return null;
        return (
          <span className="flex flex-wrap items-center gap-1">
            <span
              className={
                flags[0]!.danger ? 'ks-flag danger whitespace-nowrap' : 'ks-flag whitespace-nowrap'
              }
            >
              {flags[0]!.text}
            </span>
            {flags.length > 1 ? (
              <span
                className="ks-meta"
                title={flags
                  .slice(1)
                  .map((flag) => flag.text)
                  .join(', ')}
              >
                {t('review.more_flags', { count: flags.length - 1 })}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];

  const meta = summary
    ? summary.autoApproval
      ? t('review.meta_auto', {
          count: summary.counts.pending,
          n: count(summary.counts.pending),
          hours: count(summary.delayHours),
        })
      : t('review.meta', { count: summary.counts.pending, n: count(summary.counts.pending) })
    : undefined;
  const narrowed = Object.values(narrowing).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('review.title')}
        meta={meta}
        actions={
          mayClean && !cleanAsked ? (
            <Button
              variant="tonal"
              size="sm"
              icon={<Icon icon={Check} />}
              onClick={() => setCleanAsked(true)}
            >
              {t('review.approve_clean', { count: clean, n: count(clean) })}
            </Button>
          ) : null
        }
        toolbar={
          <FilterChips<View>
            label={t('review.filter_status')}
            value={view}
            onChange={(next) => next && choose(next)}
            formatCount={count}
            choices={[
              {
                value: 'pending',
                label: t('review.view_pending'),
                ...(summary ? { count: summary.counts.pending } : {}),
              },
              {
                value: 'flagged',
                label: t('review.view_flagged'),
                ...(summary ? { count: summary.counts.flagged } : {}),
              },
              {
                value: 'approved',
                label: t('review.status_approved'),
                ...(summary ? { count: summary.counts.approved } : {}),
              },
              {
                value: 'rejected',
                label: t('review.status_rejected'),
                ...(summary ? { count: summary.counts.rejected } : {}),
              },
            ]}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon icon={SlidersHorizontal} />}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {narrowed > 0
                ? t('review.more_filters_on', { count: narrowed })
                : t('review.more_filters')}
            </Button>
          </FilterChips>
        }
      />

      {filtersOpen ? (
        <div className="ks-card grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField
            label={t('review.filter_form')}
            none={t('review.any')}
            value={narrowing.formKey ?? ''}
            options={forms.map((form) => ({ value: form.key, label: form.name[locale].one }))}
            onChange={(event) => narrow({ formKey: event.target.value || undefined })}
          />
          <SelectField
            label={t('review.filter_flag')}
            none={t('review.any')}
            value={narrowing.flag ?? ''}
            options={SUBMISSION_FLAGS.map((flag) => ({
              value: flag,
              label: t(`submissions.flag_${flag}`),
            }))}
            onChange={(event) => narrow({ flag: event.target.value || undefined })}
          />
          <SelectField
            label={t('review.filter_geofence')}
            none={t('review.any')}
            value={narrowing.geofence ?? ''}
            options={GEOFENCE_RESULTS.map((result) => ({
              value: result,
              label: t(`review.geofence_${result}`),
            }))}
            onChange={(event) => narrow({ geofence: event.target.value || undefined })}
          />
          <TextField
            label={t('review.from')}
            type="date"
            value={narrowing.from ?? ''}
            onChange={(event) => narrow({ from: event.target.value || undefined })}
          />
          <TextField
            label={t('review.to')}
            type="date"
            value={narrowing.to ?? ''}
            onChange={(event) => narrow({ to: event.target.value || undefined })}
          />
        </div>
      ) : null}

      {cleanAsked ? (
        <Confirm
          question={t('review.clean_question', {
            count: Math.min(clean, BULK_REVIEW_MAX),
            n: count(Math.min(clean, BULK_REVIEW_MAX)),
          })}
          action={
            <Button
              variant="primary"
              busy={cleanBusy}
              icon={<Icon icon={Check} />}
              onClick={() => void approveClean()}
            >
              {t('review.approve_clean', { count: clean, n: count(clean) })}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setCleanAsked(false)}>
              {t('common.cancel')}
            </Button>
          }
        >
          <p>{t('review.bulk_note')}</p>
          {cleanFailure ? (
            <p className="ks-help error" role="alert">
              {errorMessage(cleanFailure, t)}
            </p>
          ) : null}
        </Confirm>
      ) : null}
      {cleanResult ? (
        <p role="status">
          {t('review.bulk_done', { count: cleanResult.approved.length })}
          {cleanResult.skipped.length > 0
            ? ` ${t('review.bulk_skipped', { count: cleanResult.skipped.length })}`
            : ''}
        </p>
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
        <SplitDetail
          detailLabel={
            chosen ? `${chosen.form.name[locale].one}, ${chosen.user.name}` : t('review.title')
          }
          list={
            <DataTable
              caption={t('review.queue_caption')}
              columns={columns}
              rows={items}
              rowKey={(item) => item.id}
              selectedKey={chosen?.id ?? null}
              {...(queue.hasNextPage
                ? {
                    more: {
                      label: t('common.load_more'),
                      busy: queue.isFetchingNextPage,
                      onClick: () => void queue.fetchNextPage(),
                    },
                  }
                : {})}
            />
          }
          detail={
            chosen ? (
              <ReviewDetail
                key={chosen.id}
                item={chosen}
                form={forms.find((form) => form.key === chosen.form.key)}
                onDecided={decided}
              />
            ) : null
          }
        />
      )}

      {access.can('review_rules.manage') ? <Rules /> : null}
    </div>
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
