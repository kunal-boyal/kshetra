import { formatMoney } from '@thelamp/i18n';
import {
  EXPENSE_STATES,
  type ExpenseClaimResult,
  ExpenseClaimListResult,
  ExpenseClaimResult as ClaimSchema,
  ExpensePolicyListResult,
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
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Receipt } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { PageHeader, useDates } from '../people/shared';

const STATE_BADGE: Record<ExpenseState, BadgeVariant> = {
  pending: 'pending',
  approved: 'info',
  rejected: 'danger',
  cancelled: 'neutral',
  paid: 'success',
};

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
  const [state, setState] = useState<ExpenseState | ''>('');
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
      render: (row) => names.get(row.policy) ?? row.policy,
    },
    { key: 'description', header: t('expenses.col_description'), render: (row) => row.description },
    {
      key: 'amount',
      header: t('expenses.col_amount'),
      align: 'end',
      render: (row) => (
        <span className="flex flex-col items-end">
          <span>{money(row.amount)}</span>
          {row.capped ? (
            <span className="ks-muted">
              {t('expenses.of_calculated', { amount: money(row.calculated) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'receipts',
      header: t('expenses.col_receipts'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          {row.receipts.length}
          {row.flags.map((flag) => (
            <StatusBadge key={flag} variant={FLAG_BADGE[flag] ?? 'neutral'}>
              {t(
                `expenses.flag_${flag as 'duplicate_receipt' | 'receipt_missing' | 'capped' | 'odometer_changed'}`,
              )}
            </StatusBadge>
          ))}
        </span>
      ),
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
      <PageHeader title={t('expenses.title')} intro={t('expenses.intro')} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          label={t('expenses.period')}
          type="month"
          value={period}
          onChange={(event) => event.target.value && setPeriod(event.target.value)}
        />
        <SelectField
          label={t('expenses.state')}
          value={state}
          options={[
            { value: '', label: t('expenses.state_any') },
            ...EXPENSE_STATES.map((value) => ({
              value,
              label: value === 'paid' ? t('expenses.state_paid') : t(`approval.status_${value}`),
            })),
          ]}
          onChange={(event) => setState(event.target.value as ExpenseState | '')}
        />
      </div>
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
    </div>
  );
}
