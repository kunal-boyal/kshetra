import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  ExpenseClaimDetail,
  type ExpenseClaimResult,
  ExpensePolicyListResult,
  type ExpenseState,
  MediaUrlResult,
  odometerDistance,
} from '@thelamp/shared';
import { type BadgeVariant, Button, Icon, StatusBadge } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { Facts, useDates } from '../people/shared';

export const STATE_BADGE: Record<ExpenseState, BadgeVariant> = {
  pending: 'waiting',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  paid: 'neutral',
};

export const FLAG_BADGE: Record<string, BadgeVariant> = {
  duplicate_receipt: 'danger',
  receipt_missing: 'pending',
  capped: 'neutral',
  // A reading changed from the shift's punch readings (decision D99).
  odometer_changed: 'pending',
  // Tracked and odometer kilometres beyond the tolerance (decision D115).
  distance_gap: 'pending',
};

type Translate = ReturnType<typeof useLanguage>['t'];

/** Where a claim is (decision D104): with whom at which step, waiting to be paid, or decided. */
export function whereItIs(
  claim: ExpenseClaimResult,
  t: Translate,
  date: (value: string) => string,
): string {
  const steps = claim.approval?.steps ?? [];
  switch (claim.state) {
    case 'pending': {
      const at = steps.find((step) => step.status === 'pending');
      return at
        ? t('expenses.where_step', {
            names: at.approvers.map((person) => person.name).join(', '),
            n: String(at.index + 1),
            m: String(steps.length),
          })
        : t('expenses.where_waiting');
    }
    case 'approved':
      return t('expenses.where_to_pay');
    case 'paid':
      return claim.paidAt
        ? t('expenses.where_paid_on', { date: date(claim.paidAt.slice(0, 10)) })
        : t('expenses.state_paid');
    case 'rejected': {
      const by = steps.find((step) => step.status === 'rejected')?.actedBy;
      return by
        ? t('expenses.where_rejected_by', { name: by.name })
        : t('approval.status_rejected');
    }
    case 'cancelled':
      return t('expenses.where_withdrawn');
  }
}

/** One claim, for whoever it is shown to (decision D142). */
export function useClaim(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['expense-claim', id],
    queryFn: () => read(client, `/v1/expense-claims/${id}`, ExpenseClaimDetail),
  });
}

/**
 * A claim in full (M12, decision D142): who claimed what for which day, what the policy made of
 * it, the readings beside the tracked distance, what reviewers should look at, and its receipts
 * and odometer photos, each opening full size. A receipt seen on another claim says so, and shows
 * that claim when the reader may read it.
 */
export function ClaimDetail({ id }: { id: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [showing, setShowing] = useState(id);
  const claim = useClaim(showing);
  const policies = useQuery({
    queryKey: ['expense-policies'],
    queryFn: () => read(client, '/v1/expense-policies', ExpensePolicyListResult),
  });
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const km = (value: string) => formatNumber(Number(value), { locale });

  const back =
    showing !== id ? (
      <Button
        variant="secondary"
        size="sm"
        icon={<Icon icon={ArrowLeft} size="sm" />}
        className="self-start"
        onClick={() => setShowing(id)}
      >
        {t('expenses.back_to_claim')}
      </Button>
    ) : null;
  if (claim.isError) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="ks-help error" role="alert">
          {errorMessage(claim.error, t)}
        </p>
      </div>
    );
  }
  if (!claim.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const data = claim.data;
  const policy = policies.data?.items.find((entry) => entry.key === data.policy);
  const facts: [string, React.ReactNode][] = [
    [t('expenses.col_amount'), <b key="amount">{money(data.amount)}</b>],
    ...(data.capped
      ? [[t('expenses.flag_capped'), t('claims.capped_from', { amount: money(data.calculated) })]]
      : []),
    ...(data.quantity !== null && data.rate !== null
      ? [
          [
            t('expenses.detail_rate'),
            t('expenses.detail_quantity_rate', {
              quantity: km(data.quantity),
              rate: money(data.rate),
            }),
          ],
        ]
      : []),
    ...(data.billAmount !== null ? [[t('expenses.detail_bill'), money(data.billAmount)]] : []),
    ...(data.odometerOpen !== null && data.odometerClose !== null
      ? [
          [
            t('expenses.detail_readings'),
            `${km(data.odometerOpen)} → ${km(data.odometerClose)} · ${t('expenses.odometer_km', {
              km: km(odometerDistance(data.odometerOpen, data.odometerClose)),
            })}`,
          ],
        ]
      : []),
    ...(data.trackedKm !== null
      ? [[t('expenses.detail_tracked'), t('expenses.tracked_km', { km: km(data.trackedKm) })]]
      : []),
    [t('expenses.col_where'), whereItIs(data, t, dates.date)],
    ...(data.paymentReference ? [[t('expenses.reference'), data.paymentReference]] : []),
  ] as [string, React.ReactNode][];
  const receiptNumber = (receiptId: string) => data.receipts.indexOf(receiptId) + 1;

  return (
    <div className="flex flex-col gap-4">
      {back}
      <div className="ks-spread items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="ks-muted">{policy?.name[locale] ?? data.policy}</p>
          <h2 className="heading-lg">{data.description}</h2>
          <p className="ks-meta">
            {t('expenses.claimed_by', {
              name: data.user.name,
              code: data.user.code,
              date: dates.date(data.expenseDate),
            })}
          </p>
        </div>
        <StatusBadge variant={STATE_BADGE[data.state]}>
          {data.state === 'paid' ? t('expenses.state_paid') : t(`approval.status_${data.state}`)}
        </StatusBadge>
      </div>
      <Facts items={facts} />
      {data.flags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {data.flags.map((flag) => (
            <StatusBadge key={flag} variant={FLAG_BADGE[flag] ?? 'neutral'}>
              {t(
                `expenses.flag_${flag as 'duplicate_receipt' | 'receipt_missing' | 'capped' | 'odometer_changed' | 'distance_gap'}`,
              )}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {data.seenBefore.map((seen) =>
        seen.claimId ? (
          <div key={seen.receiptId} className="flex flex-wrap items-center gap-2">
            <p>{t('expenses.seen_before', { n: receiptNumber(seen.receiptId) })}</p>
            <Button variant="secondary" size="sm" onClick={() => setShowing(seen.claimId!)}>
              {t('expenses.show_other_claim')}
            </Button>
          </div>
        ) : (
          <p key={seen.receiptId}>
            {t('expenses.seen_before_closed', { n: receiptNumber(seen.receiptId) })}
          </p>
        ),
      )}
      <section className="flex flex-col gap-2" aria-label={t('expenses.receipts')}>
        <h3 className="heading-sm">{t('expenses.receipts')}</h3>
        {data.receipts.length === 0 ? (
          <p className="ks-muted">{t('expenses.no_receipts')}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {data.receipts.map((photo, index) => (
              <ClaimPhoto
                key={photo}
                id={photo}
                label={t('expenses.receipt_n', { n: index + 1 })}
              />
            ))}
          </div>
        )}
      </section>
      {data.odometerPhotos.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t('expenses.odometer_photos')}>
          <h3 className="heading-sm">{t('expenses.odometer_photos')}</h3>
          <div className="flex flex-wrap gap-3">
            {data.odometerPhotos.map((photo, index) => (
              <ClaimPhoto
                key={photo}
                id={photo}
                label={t('expenses.odometer_n', { n: index + 1 })}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A claim's photo as a thumbnail that opens full size; a photo that can't be shown says why. */
function ClaimPhoto({ id, label }: { id: string; label: string }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const link = (variant: 'thumbnail' | 'original') =>
    ({
      queryKey: ['photo-link', id, variant],
      queryFn: () => read(client, `/v1/media/${id}/url?variant=${variant}`, MediaUrlResult),
      staleTime: 4 * 60_000,
      retry: false,
    }) as const;
  const thumbnail = useQuery(link('thumbnail'));
  const original = useQuery({ ...link('original'), enabled: thumbnail.isSuccess });
  if (thumbnail.isError) {
    return (
      <div className="ks-photo wide flex w-40 items-center p-2" role="img" aria-label={label}>
        <span className="ks-meta">{errorMessage(thumbnail.error, t)}</span>
      </div>
    );
  }
  if (!thumbnail.data) return <div className="ks-photo wide w-40" role="img" aria-label={label} />;
  const image = (
    <img
      src={thumbnail.data.url}
      alt={label}
      className="ks-photo wide object-cover"
      loading="lazy"
    />
  );
  return original.data ? (
    <a
      href={original.data.url}
      target="_blank"
      rel="noreferrer"
      className="block w-40"
      aria-label={t('expenses.open_full', { label })}
    >
      {image}
    </a>
  ) : (
    <div className="w-40">{image}</div>
  );
}
