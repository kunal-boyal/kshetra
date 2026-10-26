import { formatMoney, formatNumber } from '@thelamp/i18n';
import { DEFAULT_REJECTION_REASONS, type OrderLineResult, type OrderResult } from '@thelamp/shared';
import {
  Button,
  type Column,
  Confirm,
  DataTable,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { Check, Info, PackageCheck, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApprovalSteps } from '../approvals/steps';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import { Printable, PrintButton } from '../print';
import { useOrder, useOrderWrites } from './data';
import { ORDER_BADGE } from './orders-page';

/** The tenant's reasons for rejecting orders and lines, or the defaults (spec 5.11). */
function useReasons() {
  const { client, queryClient } = useApp();
  const { locale } = useLanguage();
  const configured = useConfig(client, queryClient).data?.bundle.catalogue.rejectionReasons;
  const reasons = configured && configured.length > 0 ? configured : DEFAULT_REJECTION_REASONS;
  return reasons.map((reason) => ({ value: reason.key, label: reason.name[locale] }));
}

/**
 * One order (M10, decision D78): its account and supplier, who placed it and when, each line as
 * it was priced, the totals with GST as CGST and SGST halves, and its approval. Approvers accept
 * or reject it here, whole or line by line; back office records what went out, or cancels it.
 */
export function OrderPage({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const order = useOrder(orderId);
  if (order.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(order.error, t)}
      </p>
    );
  }
  if (!order.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return <Showing key={order.data.version} order={order.data} />;
}

function Showing({ order }: { order: OrderResult }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const reasons = useReasons();
  const reasonName = (key: string | null) =>
    reasons.find((reason) => reason.value === key)?.label ?? key ?? '';
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const number = (amount: string) =>
    formatNumber(amount as `${number}`, { locale }, { maximumFractionDigits: 3 });

  const columns: Column<OrderLineResult>[] = [
    {
      key: 'item',
      header: t('orders.item'),
      render: (line) => (
        <span className="flex flex-col">
          <span className="font-semibold">{line.item.name}</span>
          <code>{line.item.code}</code>
        </span>
      ),
    },
    {
      key: 'quantity',
      header: t('orders.quantity'),
      align: 'end',
      render: (line) => (
        <span className="flex flex-col">
          <span>{`${number(line.quantity)} ${line.unitKey}`}</span>
          <span className="ks-muted">
            {t('orders.base_units', { count: number(line.baseUnits), unit: line.item.baseUnit })}
          </span>
        </span>
      ),
    },
    { key: 'rate', header: t('orders.rate'), align: 'end', render: (line) => money(line.rate) },
    {
      key: 'taxable',
      header: t('orders.taxable'),
      align: 'end',
      render: (line) => money(line.taxable),
    },
    {
      key: 'tax',
      header: t('orders.tax'),
      align: 'end',
      render: (line) => `${money(line.tax)} (${number(line.taxRate)}%)`,
    },
    { key: 'total', header: t('orders.total'), align: 'end', render: (line) => money(line.total) },
    {
      key: 'decision',
      header: t('orders.decision'),
      render: (line) => (
        <span className="flex flex-col gap-1">
          <StatusBadge
            variant={
              line.decision === 'accepted'
                ? 'success'
                : line.decision === 'rejected'
                  ? 'danger'
                  : 'waiting'
            }
          >
            {t(`orders.line_${line.decision}`)}
          </StatusBadge>
          {line.decisionReason ? (
            <span className="ks-muted">{reasonName(line.decisionReason)}</span>
          ) : null}
          {line.fulfilledUnits !== null ? (
            <span className="ks-muted">
              {t('orders.fulfilled_units', { count: number(line.fulfilledUnits) })}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order.account.name}
        back={{ to: '/orders', label: t('orders.title') }}
        intro={t('orders.placed_on', {
          name: order.placedBy.name,
          when: dates.dateTime(order.placedAt),
        })}
      >
        <StatusBadge variant={ORDER_BADGE[order.status]}>
          {t(`orders.status_${order.status}`)}
        </StatusBadge>
        <PrintButton printable="order" />
      </PageHeader>
      <Printable
        id="order"
        title={t('print.order', { name: order.account.name })}
        details={[
          t('orders.placed_on', {
            name: order.placedBy.name,
            when: dates.dateTime(order.placedAt),
          }),
          t(`orders.status_${order.status}`),
          t('print.reference', { id: order.id }),
        ]}
      >
        <Notice icon={<Icon icon={Info} />}>{t('orders.not_an_invoice')}</Notice>
        <Facts
          items={[
            [t('orders.account'), `${order.account.name} (${order.account.code})`],
            [
              t('orders.supplier'),
              order.supplier.account
                ? `${order.supplier.account.name} (${order.supplier.account.code})`
                : t('orders.supplier_company'),
            ],
            ...(order.note ? [[t('orders.note'), order.note] as [string, string]] : []),
            ...(order.rejectionReason
              ? [[t('orders.rejected_for'), reasonName(order.rejectionReason)] as [string, string]]
              : []),
          ]}
        />
        <DataTable
          caption={t('orders.lines_caption')}
          columns={columns}
          rows={order.lines}
          rowKey={(line) => line.id}
        />
        <Section title={t('orders.totals')}>
          <Facts
            items={[
              [t('orders.taxable'), money(order.totals.taxable)],
              [t('orders.cgst'), money(order.totals.cgst)],
              [t('orders.sgst'), money(order.totals.sgst)],
              [t('orders.total'), money(order.totals.total)],
              ...(['kg', 'L'] as const).flatMap((type) =>
                order.measures[type]
                  ? [
                      [t(`orders.measure_${type}`), number(order.measures[type])] as [
                        string,
                        string,
                      ],
                    ]
                  : [],
              ),
            ]}
          />
        </Section>
        {order.approval && order.approval.steps.length > 0 ? (
          <Section title={t('approvals.chain')}>
            <ApprovalSteps item={order.approval} />
          </Section>
        ) : null}
      </Printable>
      {order.can.decideLines ? (
        <LineDecisions order={order} reasons={reasons} />
      ) : order.can.decide ? (
        <WholeDecision order={order} reasons={reasons} />
      ) : null}
      {order.can.fulfil ? <Fulfilment order={order} /> : null}
    </div>
  );
}

function WholeDecision({
  order,
  reasons,
}: {
  order: OrderResult;
  reasons: { value: string; label: string }[];
}) {
  const { t } = useLanguage();
  const writes = useOrderWrites();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);

  async function decide(decision: 'accept' | 'reject') {
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.decide(order.id, {
        decision,
        version: order.approval!.version,
        ...(decision === 'reject' && reason ? { reason } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  return (
    <Section title={t('orders.decide')}>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {rejecting ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('orders.reason')}
            none={t('orders.choose_reason')}
            value={reason}
            options={reasons}
            {...(errors.reason ? { error: errors.reason } : {})}
            onChange={(event) => setReason(event.target.value)}
          />
          <TextAreaField
            label={t('orders.reject_note')}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button
              variant="danger"
              busy={busy}
              icon={<Icon icon={X} />}
              onClick={() => void decide('reject')}
            >
              {t('orders.reject')}
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              busy={busy}
              icon={<Icon icon={Check} />}
              onClick={() => void decide('accept')}
            >
              {t('orders.accept')}
            </Button>
            <Button variant="secondary" icon={<Icon icon={X} />} onClick={() => setRejecting(true)}>
              {t('orders.reject')}
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

function LineDecisions({
  order,
  reasons,
}: {
  order: OrderResult;
  reasons: { value: string; label: string }[];
}) {
  const { t } = useLanguage();
  const writes = useOrderWrites();
  const open = order.lines.filter((line) => line.decision !== 'rejected');
  const [choices, setChoices] = useState<Record<string, { decision: string; reason: string }>>(() =>
    Object.fromEntries(open.map((line) => [line.id, { decision: 'accepted', reason: '' }])),
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const set = (id: string, patch: Partial<{ decision: string; reason: string }>) =>
    setChoices((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.decideLines(order.id, {
        lines: open.map((line) => {
          const choice = choices[line.id]!;
          return {
            lineId: line.id,
            decision: choice.decision as 'accepted' | 'rejected',
            ...(choice.decision === 'rejected' && choice.reason ? { reason: choice.reason } : {}),
          };
        }),
        version: order.approval!.version,
      });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <Section title={t('orders.decide_lines')}>
        <p className="ks-muted">{t('orders.decide_lines_help')}</p>
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {open.map((line, index) => (
            <li key={line.id} className="grid gap-3 md:grid-cols-3">
              <p className="font-semibold">{line.item.name}</p>
              <SelectField
                label={t('orders.line_decision', { item: line.item.name })}
                value={choices[line.id]!.decision}
                options={[
                  { value: 'accepted', label: t('orders.line_accepted') },
                  { value: 'rejected', label: t('orders.line_rejected') },
                ]}
                onChange={(event) => set(line.id, { decision: event.target.value })}
              />
              {choices[line.id]!.decision === 'rejected' ? (
                <SelectField
                  label={t('orders.reason')}
                  none={t('orders.choose_reason')}
                  value={choices[line.id]!.reason}
                  options={reasons}
                  {...(errors[`lines[${index}].reason`]
                    ? { error: errors[`lines[${index}].reason`] }
                    : {})}
                  onChange={(event) => set(line.id, { reason: event.target.value })}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Check} />}>
            {t('orders.save_decisions')}
          </Button>
        </div>
      </Section>
    </form>
  );
}

function Fulfilment({ order }: { order: OrderResult }) {
  const { t } = useLanguage();
  const writes = useOrderWrites();
  const accepted = order.lines.filter((line) => line.decision === 'accepted');
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      accepted.map((line) => [line.id, String(Number(line.fulfilledUnits ?? '0'))]),
    ),
  );
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);

  async function run(body: Parameters<typeof writes.fulfil>[1]) {
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.fulfil(order.id, body);
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  return (
    <Section title={t('orders.fulfilment')}>
      <p className="ks-muted">{t('orders.fulfilment_help')}</p>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void run({
            action: 'fulfil',
            lines: accepted.map((line) => ({
              lineId: line.id,
              fulfilledUnits: (units[line.id] ?? '0').trim() || '0',
            })),
            version: order.version,
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {accepted.map((line, index) => (
            <TextField
              key={line.id}
              label={t('orders.fulfilled_of', {
                item: line.item.name,
                count: line.baseUnits,
                unit: line.item.baseUnit,
              })}
              numeric
              inputMode="decimal"
              value={units[line.id] ?? ''}
              {...(errors[`lines[${index}].fulfilledUnits`]
                ? { error: errors[`lines[${index}].fulfilledUnits`] }
                : {})}
              onChange={(event) => setUnits({ ...units, [line.id]: event.target.value })}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={PackageCheck} />}>
            {t('orders.save_fulfilment')}
          </Button>
          {order.status === 'accepted' || order.status === 'partially_accepted' ? (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              {t('orders.cancel_order')}
            </Button>
          ) : null}
        </div>
      </form>
      {cancelling ? (
        <Confirm
          question={t('orders.cancel_question')}
          action={
            <Button
              variant="danger"
              busy={busy}
              disabled={note.trim().length < 3}
              onClick={() =>
                void run({ action: 'cancel', note: note.trim(), version: order.version })
              }
            >
              {t('orders.cancel_order')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              {t('orders.keep_order')}
            </Button>
          }
        >
          <TextAreaField
            label={t('orders.cancel_why')}
            required
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Confirm>
      ) : null}
    </Section>
  );
}
