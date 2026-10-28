import { formatDate, formatMoney, formatMonth, formatNumber } from '@thelamp/i18n';
import {
  EXPENSE_STATES,
  type ExpenseClaimResult,
  ExpenseClaimListResult,
  ExpenseClaimResult as ClaimSchema,
  ExpensePolicyListResult,
  type ExpensePolicyResult,
  scaled,
  unscaled,
  type ExpenseState,
  todayIn,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  PageHeader,
  PeriodStepper,
  StatTile,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Banknote, Download, Receipt, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { useDates } from '../people/shared';
import { useStartExport } from '../reports/data';

const STATE_BADGE: Record<ExpenseState, BadgeVariant> = {
  pending: 'waiting',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  paid: 'neutral',
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

/** A policy in one line: its rate, its caps, and whether a bill is needed. */
export function policyLine(
  policy: ExpensePolicyResult,
  t: Translate,
  money: (amount: string) => string,
): string {
  const parts: string[] = [];
  if (policy.calculation === 'actual') parts.push(t('expenses.policy_actual'));
  else if (policy.rate && 'flat' in policy.rate)
    parts.push(t(`expenses.policy_rate_${policy.calculation}`, { rate: money(policy.rate.flat) }));
  else parts.push(t('expenses.policy_by_designation'));
  if (policy.caps.perDay)
    parts.push(t('expenses.policy_cap_day', { amount: money(policy.caps.perDay) }));
  if (policy.caps.perMonth)
    parts.push(t('expenses.policy_cap_month', { amount: money(policy.caps.perMonth) }));
  if (policy.caps.perClaim)
    parts.push(t('expenses.policy_cap_claim', { amount: money(policy.caps.perClaim) }));
  if (policy.receiptRequired) parts.push(t('expenses.policy_bill'));
  return parts.join(' · ');
}

const FLAG_BADGE: Record<string, BadgeVariant> = {
  duplicate_receipt: 'danger',
  receipt_missing: 'pending',
  capped: 'neutral',
  // A reading changed from the shift's punch readings (decision D99).
  odometer_changed: 'pending',
};

/**
 * Expense claims (M12, decision D83): claims for a month by the people the caller reaches,
 * newest day first, with what each policy and its caps made of them and what reviewers should
 * look at. Back office marks approved claims paid, asking first; the Expense register in Reports
 * exports them for payroll.
 */
export function ExpensesPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const navigate = useNavigate();
  const startExport = useStartExport();
  const [state, setState] = useState<ExpenseState | null>(null);
  const [exporting, setExporting] = useState(false);
  const [paying, setPaying] = useState<ExpenseClaimResult>();
  const [reference, setReference] = useState('');
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const currency = access.currency;
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });

  const policies = useQuery({
    queryKey: ['expense-policies'],
    queryFn: () => read(client, '/v1/expense-policies', ExpensePolicyListResult),
  });
  const names = new Map(
    (policies.data?.items ?? []).map((policy) => [policy.key, policy.name[locale]] as const),
  );
  const claims = useInfiniteQuery({
    queryKey: ['expense-claims', period, state],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/expense-claims?period=${period}${state ? `&state=${state}` : ''}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
        ExpenseClaimListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = claims.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = claims.data?.pages[0]?.summary ?? null;
  const count = (value: number) => formatNumber(value, { locale });
  const active = (policies.data?.items ?? []).filter((policy) => policy.active);

  async function exportForPayroll() {
    setExporting(true);
    setFailure(undefined);
    try {
      await startExport({
        report: 'expense_register',
        format: 'xlsx',
        locale,
        filters: { period },
      });
      await navigate({ to: '/reports' });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setExporting(false);
    }
  }
  const canPay = access.can('expense.mark_paid');

  async function pay(claim: ExpenseClaimResult) {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/expense-claims/${claim.id}/paid`, ClaimSchema, {
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      setPaying(undefined);
      setReference('');
      await queryClient.invalidateQueries({ queryKey: ['expense-claims'] });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ExpenseClaimResult>[] = [
    { key: 'date', header: t('expenses.col_date'), render: (row) => dates.date(row.expenseDate) },
    {
      key: 'person',
      header: t('expenses.col_person'),
      render: (row) => `${row.user.name} (${row.user.code})`,
    },
    {
      key: 'policy',
      header: t('expenses.col_policy'),
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{names.get(row.policy) ?? row.policy}</span>
          <span className="ks-meta">{row.description}</span>
        </span>
      ),
    },
    {
      key: 'receipts',
      header: t('expenses.col_bills'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          {row.receipts.length}
          {row.flags
            .filter((flag) => flag !== 'capped')
            .map((flag) => (
              <StatusBadge key={flag} variant={FLAG_BADGE[flag] ?? 'neutral'}>
                {t(
                  `expenses.flag_${flag as 'duplicate_receipt' | 'receipt_missing' | 'odometer_changed'}`,
                )}
              </StatusBadge>
            ))}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('expenses.col_amount'),
      align: 'end',
      render: (row) => money(row.amount),
    },
    {
      key: 'over',
      header: t('expenses.col_over'),
      align: 'end',
      render: (row) =>
        row.capped ? (
          <span className="font-semibold text-[var(--pending-fg)]">
            {money(unscaled(scaled(row.calculated, 2) - scaled(row.amount, 2), 2))}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'where',
      header: t('expenses.col_where'),
      render: (row) => whereItIs(row, t, (value) => formatDate(value, { locale })),
    },
    {
      key: 'state',
      header: t('expenses.col_state'),
      render: (row) => (
        <StatusBadge variant={STATE_BADGE[row.state]}>
          {row.state === 'paid' ? t('expenses.state_paid') : t(`approval.status_${row.state}`)}
        </StatusBadge>
      ),
    },
    ...(canPay
      ? [
          {
            key: 'actions',
            header: t('expenses.col_actions'),
            render: (row: ExpenseClaimResult) =>
              row.state === 'approved' ? (
                <Button
                  size="sm"
                  icon={<Icon icon={Banknote} size="sm" />}
                  aria-label={`${t('expenses.mark_paid')}: ${row.user.name}, ${money(row.amount)}`}
                  onClick={() => {
                    setPaying(row);
                    setReference('');
                    setFailure(undefined);
                  }}
                >
                  {t('expenses.mark_paid')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('expenses.title_month', { month: formatMonth(period, { locale }) })}
        meta={t('expenses.meta')}
        actions={
          <>
            {access.can('expense_policy.manage') ? (
              <Link to="/settings/expense-policies" className="ks-btn secondary sm">
                <Icon icon={SlidersHorizontal} size="sm" />
                {t('expenses.policy')}
              </Link>
            ) : null}
            {access.can('report.view') ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Icon icon={Download} />}
                busy={exporting}
                onClick={() => void exportForPayroll()}
              >
                {t('expenses.export')}
              </Button>
            ) : null}
          </>
        }
        toolbar={
          <>
            <PeriodStepper
              value={period}
              onChange={setPeriod}
              format={(value) => formatMonth(value, { locale })}
              label={t('expenses.period')}
              previousLabel={t('targets.previous_month')}
              nextLabel={t('targets.next_month')}
            />
            <FilterChips<ExpenseState>
              label={t('expenses.state')}
              value={state}
              onChange={setState}
              clearable
              choices={EXPENSE_STATES.map((value) => ({
                value,
                label: value === 'paid' ? t('expenses.state_paid') : t(`approval.status_${value}`),
              }))}
            />
          </>
        }
      />
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('expenses.tile_claimed')}
            value={money(summary.claimed)}
            sub={t('expenses.tile_claims', { count: summary.claims, n: count(summary.claims) })}
          />
          <StatTile
            label={t('expenses.tile_waiting')}
            value={money(summary.waiting)}
            sub={t('expenses.tile_claims', {
              count: summary.waitingClaims,
              n: count(summary.waitingClaims),
            })}
          />
          <StatTile
            label={t('expenses.tile_over')}
            value={money(summary.overPolicy)}
            {...(scaled(summary.overPolicy, 2) > 0n ? { tone: 'pending' as const } : {})}
            sub={t('expenses.tile_over_sub')}
          />
          <StatTile
            label={t('expenses.tile_approved')}
            value={money(summary.approved)}
            sub={t('expenses.tile_claims', {
              count: summary.approvedClaims,
              n: count(summary.approvedClaims),
            })}
          />
        </div>
      ) : null}
      {failure !== undefined && !paying ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {paying ? (
        <Confirm
          question={t('expenses.paid_question', {
            amount: money(paying.amount),
            name: paying.user.name,
          })}
          action={
            <Button variant="primary" busy={busy} onClick={() => void pay(paying)}>
              {t('expenses.mark_paid')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setPaying(undefined)}>
              {t('expenses.keep')}
            </Button>
          }
        >
          <TextField
            label={t('expenses.reference')}
            help={t('expenses.reference_help')}
            maxLength={80}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
          {failure !== undefined ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
        </Confirm>
      ) : null}
      {claims.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(claims.error, t)}
        </p>
      ) : claims.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('expenses.title')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState icon={<Icon icon={Receipt} />} title={t('expenses.none_title')}>
              {t('expenses.none_body')}
            </EmptyState>
          }
          {...(claims.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: claims.isFetchingNextPage,
                  onClick: () => void claims.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
      {active.length > 0 ? (
        <section className="ks-card flex flex-col gap-4" aria-labelledby="expense-policies">
          <h2 id="expense-policies" className="heading-md">
            {t('expenses.policies')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {active.map((policy) => (
              <li
                key={policy.key}
                className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] p-4"
              >
                <span className="font-semibold">{policy.name[locale]}</span>
                <span className="ks-meta">{policyLine(policy, t, money)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
