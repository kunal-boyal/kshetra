import { ApiError } from '@thelamp/api-client';
import { formatMoney } from '@thelamp/i18n';
import type { CollectionResult, CollectionStatusKey, ErrorCode } from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Confirm,
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Check, Link2, Link2Off, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Facts, useDates } from '../people/shared';
import { usePhotoLink } from '../review/data';
import { useAccountReceipts, useCollectionWrites } from './collections-data';

/** Each collection status as a badge (components/StatusBadge). */
export const COLLECTION_BADGE: Record<CollectionStatusKey, BadgeVariant> = {
  recorded: 'waiting',
  confirmed: 'info',
  rejected: 'danger',
  bounced: 'danger',
  in_books: 'success',
};

export function CollectionBadge({ status }: { status: CollectionStatusKey }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={COLLECTION_BADGE[status]}>
      {t(`collections.status_${status}`)}
    </StatusBadge>
  );
}

/** An amount in the tenant's currency. */
export function useMoney() {
  const { locale } = useLanguage();
  const access = useAccess();
  return (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
}

/** How it was paid, with its reference: "UPI · UPI 4471", "Cheque 004512 · Bank of Maharashtra". */
export function paidBy(collection: CollectionResult, t: ReturnType<typeof useLanguage>['t']) {
  const mode = t(`collections.mode_${collection.mode}`);
  if (collection.mode === 'cheque') {
    return [`${mode} ${collection.chequeNumber ?? ''}`.trim(), collection.chequeBank]
      .filter(Boolean)
      .join(' · ');
  }
  return [mode, collection.reference].filter(Boolean).join(' · ');
}

/** What a collection says: when, who took it, how it was paid, where, and what was decided. */
export function CollectionFacts({ collection }: { collection: CollectionResult }) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const money = useMoney();
  return (
    <Facts
      items={[
        [t('collections.amount'), <b key="amount">{money(collection.amount)}</b>],
        [t('collections.paid_by'), paidBy(collection, t)],
        ...(collection.chequeDate
          ? [[t('collections.cheque_date'), dates.date(collection.chequeDate)] as [string, string]]
          : []),
        [t('collections.taken'), dates.dateTime(collection.collectedAt)],
        [t('collections.collector'), `${collection.collector.name} (${collection.collector.code})`],
        [
          t('collections.where'),
          collection.inGeofence === null
            ? t('collections.where_unknown')
            : t(collection.inGeofence ? 'collections.at_account' : 'collections.away'),
        ],
        ...(collection.note ? [[t('collections.note'), collection.note] as [string, string]] : []),
        ...(collection.decidedBy && collection.decidedAt
          ? [
              [
                t('collections.decided'),
                t('collections.decided_by', {
                  name: collection.decidedBy.name,
                  when: dates.dateTime(collection.decidedAt),
                }),
              ] as [string, string],
            ]
          : []),
        ...(collection.reason
          ? [[t('collections.reason'), collection.reason] as [string, string]]
          : []),
        ...(collection.receipt
          ? [
              [
                t('collections.in_books'),
                t(
                  collection.receipt.byHand ? 'collections.receipt_by_hand' : 'collections.receipt',
                  {
                    number: collection.receipt.number,
                    date: dates.date(collection.receipt.date),
                  },
                ),
              ] as [string, string],
            ]
          : []),
      ]}
    />
  );
}

/** A cheque's photo, as a thumbnail that opens the full one. */
export function ChequePhoto({ id, index }: { id: string; index: number }) {
  const { t } = useLanguage();
  const link = usePhotoLink(id);
  const alt = t('collections.cheque_photo', { n: index + 1 });
  return link.data ? (
    <a href={link.data.url} target="_blank" rel="noreferrer" className="block w-40">
      <img src={link.data.url} alt={alt} className="ks-photo wide object-cover" loading="lazy" />
    </a>
  ) : (
    <div className="ks-photo wide w-40" role="img" aria-label={alt} />
  );
}

type Asking = 'reject' | 'bounce' | 'unmatch' | 'match' | null;

/**
 * What the office does with a collection (BR-63): confirm it, or reject it saying why; bounce a
 * confirmed cheque saying why; match a confirmed one to the books' receipt by hand, or undo a
 * match. Each change that can't be undone asks first, in place.
 */
export function CollectionActions({ collection }: { collection: CollectionResult }) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const money = useMoney();
  const writes = useCollectionWrites();
  const [asking, setAsking] = useState<Asking>(null);
  const [reason, setReason] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const receipts = useAccountReceipts(collection.account.id, asking === 'match');
  const { can } = collection;
  if (!can.decide && !can.bounce && !can.match && !can.unmatch) return null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setFailure(undefined);
    try {
      await work();
      setAsking(null);
      setReason('');
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }
  const decide = (decision: 'confirm' | 'reject') =>
    run(async () => {
      const [result] = (
        await writes.decide([
          { id: collection.id, decision, ...(decision === 'reject' ? { reason } : {}) },
        ])
      ).results;
      if (result?.error) {
        throw new ApiError(409, result.error.code as ErrorCode, result.error.message);
      }
    });
  const ask = (next: Asking) => {
    setFailure(undefined);
    setReason('');
    setAsking(next);
  };
  const cancel = (
    <Button variant="secondary" onClick={() => setAsking(null)}>
      {t('common.cancel')}
    </Button>
  );
  const reasonField = (
    <TextField
      label={t('collections.why')}
      value={reason}
      onChange={(event) => setReason(event.target.value)}
    />
  );

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={t('collections.office')}>
      {asking === 'reject' ? (
        <Confirm
          question={t('collections.reject_question')}
          action={
            <Button
              variant="danger"
              busy={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void decide('reject')}
            >
              {t('collections.reject')}
            </Button>
          }
          cancel={cancel}
        >
          {reasonField}
        </Confirm>
      ) : asking === 'bounce' ? (
        <Confirm
          question={t('collections.bounce_question')}
          action={
            <Button
              variant="danger"
              busy={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void run(() => writes.bounce(collection.id, reason.trim()))}
            >
              {t('collections.bounce')}
            </Button>
          }
          cancel={cancel}
        >
          {reasonField}
        </Confirm>
      ) : asking === 'unmatch' ? (
        <Confirm
          question={t('collections.unmatch_question')}
          action={
            <Button
              variant="danger"
              busy={busy}
              onClick={() => void run(() => writes.unmatch(collection.id))}
            >
              {t('collections.unmatch')}
            </Button>
          }
          cancel={cancel}
        >
          <p>{t('collections.unmatch_body')}</p>
        </Confirm>
      ) : asking === 'match' ? (
        <div className="ks-card flex flex-col gap-3">
          <SelectField
            label={t('collections.receipt_to_match')}
            value={receiptId}
            none={t('collections.choose_receipt')}
            options={(receipts.data?.items ?? [])
              .filter((receipt) => receipt.kind === 'receipt' && !receipt.cancelled)
              .map((receipt) => ({
                value: receipt.id,
                label: `${receipt.number} · ${dates.date(receipt.date)} · ${money(receipt.amount)}`,
              }))}
            onChange={(event) => setReceiptId(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              busy={busy}
              disabled={receiptId === ''}
              icon={<Icon icon={Link2} />}
              onClick={() => void run(() => writes.match(collection.id, receiptId))}
            >
              {t('collections.match')}
            </Button>
            {cancel}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {can.decide ? (
            <>
              <Button
                variant="primary"
                busy={busy}
                icon={<Icon icon={Check} />}
                onClick={() => void decide('confirm')}
              >
                {t('collections.confirm')}
              </Button>
              <Button variant="secondary" icon={<Icon icon={X} />} onClick={() => ask('reject')}>
                {t('collections.reject')}
              </Button>
            </>
          ) : null}
          {can.match ? (
            <Button variant="secondary" icon={<Icon icon={Link2} />} onClick={() => ask('match')}>
              {t('collections.match_by_hand')}
            </Button>
          ) : null}
          {can.bounce ? (
            <Button
              variant="secondary"
              icon={<Icon icon={TriangleAlert} />}
              onClick={() => ask('bounce')}
            >
              {t('collections.mark_bounced')}
            </Button>
          ) : null}
          {can.unmatch ? (
            <Button
              variant="secondary"
              icon={<Icon icon={Link2Off} />}
              onClick={() => ask('unmatch')}
            >
              {t('collections.unmatch')}
            </Button>
          ) : null}
        </div>
      )}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </div>
  );
}
