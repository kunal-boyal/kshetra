import {
  type ApprovalResult,
  type ApprovalStatus,
  type BulkApprovalResult,
  REQUEST_TYPES,
  type RequestType,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Checkbox,
  cn,
  Confirm,
  EmptyState,
  Icon,
  Notice,
  StatusBadge,
  TextAreaField,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Check, CircleCheck, Inbox, Send, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import type { MessageKey } from '@thelamp/i18n';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, PageHeader, useDates } from '../people/shared';
import { useDecisions, useInbox, useMine } from './data';
import { ApprovalSteps } from './steps';

export type ApprovalsView = 'waiting' | 'mine';

/** Search params of `/approvals`: which list, and which type of request waits. */
export function approvalsSearch(search: Record<string, unknown>): {
  view?: ApprovalsView;
  type?: RequestType;
} {
  return {
    ...(search.view === 'mine' ? { view: 'mine' as const } : {}),
    ...(REQUEST_TYPES.includes(search.type as RequestType)
      ? { type: search.type as RequestType }
      : {}),
  };
}

const STATUS_BADGE: Record<ApprovalStatus, BadgeVariant> = {
  pending: 'waiting',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * The approvals inbox (M15, decision D76): what waits for the viewer, by type, decided one at a
 * time or several together where the type allows; and what the viewer asked for, with where each
 * request stands in its chain.
 */
export function ApprovalsPage({
  view = 'waiting',
  type,
}: {
  view?: ApprovalsView;
  type?: RequestType;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('approvals.title')} intro={t('approvals.intro')} />
      <nav aria-label={t('approvals.views')} className="flex flex-wrap gap-2">
        <Link
          to="/approvals"
          search={{}}
          className={cn('ks-btn sm', view === 'waiting' ? 'tonal' : 'secondary')}
          {...(view === 'waiting' ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon icon={Inbox} size="sm" />
          {t('approvals.view_waiting')}
        </Link>
        <Link
          to="/approvals"
          search={{ view: 'mine' }}
          className={cn('ks-btn sm', view === 'mine' ? 'tonal' : 'secondary')}
          {...(view === 'mine' ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon icon={Send} size="sm" />
          {t('approvals.view_mine')}
        </Link>
      </nav>
      {view === 'mine' ? <Mine /> : <Waiting {...(type ? { type } : {})} />}
    </div>
  );
}

function Waiting({ type }: { type?: RequestType }) {
  const { t } = useLanguage();
  const inbox = useInbox(type);
  const decisions = useDecisions();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [outcome, setOutcome] = useState<{ approved: number; refused: Refusal[] }>();

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = inbox.data?.pages[0]?.counts ?? {};
  const types = REQUEST_TYPES.filter((key) => counts[key]);
  const total = types.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
  // Together only where two or more could go: one request is approved on its own.
  const together = items.filter((item) => item.bulk);
  const bulk = together.length > 1;
  const chosen = together.filter((item) => selected.has(item.id));

  function choose(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function approveChosen() {
    setBusy(true);
    setFailure(undefined);
    setOutcome(undefined);
    try {
      const result = await decisions.approveMany(chosen);
      setOutcome(summarise(result, chosen));
      setSelected(new Set());
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  if (inbox.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(inbox.error, t)}
      </p>
    );
  }
  if (inbox.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  return (
    <>
      {types.length > 1 || type ? (
        <nav aria-label={t('approvals.types')} className="flex flex-wrap gap-2">
          <TypeLink active={!type} label={t('approvals.type_all', { count: total })} />
          {types.map((key) => (
            <TypeLink
              key={key}
              type={key}
              active={type === key}
              label={t('approvals.type_count', {
                type: t(`approval.type_${key}`),
                count: counts[key] ?? 0,
              })}
            />
          ))}
        </nav>
      ) : null}
      {outcome ? <Outcome {...outcome} /> : null}
      {items.length === 0 ? (
        <EmptyState icon={<Icon icon={Inbox} />} title={t('approvals.empty_title')}>
          {t('approvals.empty_body')}
        </EmptyState>
      ) : (
        <>
          {bulk ? (
            <div
              className="ks-card flex flex-wrap items-center justify-between gap-3"
              role="group"
              aria-label={t('approvals.together')}
            >
              <Checkbox
                label={t('approvals.select_all', { count: together.length })}
                checked={chosen.length === together.length}
                onChange={(event) =>
                  setSelected(new Set(event.target.checked ? together.map((item) => item.id) : []))
                }
              />
              <Button
                variant="primary"
                busy={busy}
                disabled={chosen.length === 0}
                icon={<Icon icon={Check} />}
                onClick={() => void approveChosen()}
              >
                {t('approvals.approve_selected', { count: chosen.length })}
              </Button>
              {failure ? (
                <p className="ks-help error w-full" role="alert">
                  {errorMessage(failure, t)}
                </p>
              ) : null}
            </div>
          ) : null}
          <ul className="flex flex-col gap-4" aria-label={t('approvals.view_waiting')}>
            {items.map((item) => (
              <li key={item.id}>
                <Request
                  item={item}
                  {...(bulk && item.bulk
                    ? {
                        chosen: selected.has(item.id),
                        onChoose: (on: boolean) => choose(item.id, on),
                      }
                    : {})}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <More query={inbox} />
    </>
  );
}

function TypeLink({ type, active, label }: { type?: RequestType; active: boolean; label: string }) {
  return (
    <Link
      to="/approvals"
      search={type ? { type } : {}}
      className={cn('ks-btn sm', active ? 'tonal' : 'secondary')}
      {...(active ? { 'aria-current': 'page' as const } : {})}
    >
      {label}
    </Link>
  );
}

interface Refusal {
  title: string;
  code: string;
}

function summarise(result: BulkApprovalResult, sent: readonly ApprovalResult[]) {
  const titles = new Map(sent.map((item) => [item.id, item.subject.title]));
  return {
    approved: result.results.filter((entry) => entry.approval).length,
    refused: result.results.flatMap((entry) =>
      entry.error ? [{ title: titles.get(entry.id) ?? '', code: entry.error.code }] : [],
    ),
  };
}

function Outcome({ approved, refused }: { approved: number; refused: Refusal[] }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2" role="status">
      {approved ? (
        <Notice icon={<Icon icon={CircleCheck} />}>
          {t('approvals.approved_many', { count: approved })}
        </Notice>
      ) : null}
      {refused.length ? (
        <div className="ks-card flex flex-col gap-2">
          <p className="font-semibold">{t('approvals.refused_many', { count: refused.length })}</p>
          <ul className="flex flex-col gap-1">
            {refused.map((entry) => (
              <li key={entry.title}>
                {entry.title}: {t(`error.${entry.code}` as MessageKey)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Request({
  item,
  chosen,
  onChoose,
}: {
  item: ApprovalResult;
  chosen?: boolean;
  onChoose?: (on: boolean) => void;
}) {
  const { t } = useLanguage();
  const decisions = useDecisions();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setFailure(undefined);
    try {
      await decisions.decide(item, decision, decision === 'reject' ? note.trim() : undefined);
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  const title = item.subject.title || t(`approval.type_${item.requestType}`);
  return (
    <article className="ks-card flex flex-col gap-4" aria-label={title}>
      <Heading item={item} title={title}>
        {onChoose ? (
          <Checkbox
            label={t('approvals.select')}
            aria-label={t('approvals.select_one', { title })}
            checked={chosen ?? false}
            onChange={(event) => onChoose(event.target.checked)}
          />
        ) : null}
      </Heading>
      {item.steps.length ? <ApprovalSteps item={item} /> : null}
      {failure && !fieldErrors(failure).note ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {rejecting ? (
        <TextAreaField
          label={t('approvals.why')}
          help={t('approvals.why_help')}
          required
          rows={3}
          value={note}
          {...(fieldErrors(failure).note ? { error: fieldErrors(failure).note } : {})}
          onChange={(event) => setNote(event.target.value)}
        />
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
              {t('approvals.reject')}
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
              onClick={() => void decide('approve')}
            >
              {t('approvals.approve')}
            </Button>
            <Button variant="secondary" icon={<Icon icon={X} />} onClick={() => setRejecting(true)}>
              {t('approvals.reject')}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

/** A request's type, title (linked to its account, if it has one) and who asked when. */
function Heading({
  item,
  title,
  children,
}: {
  item: ApprovalResult;
  title: string;
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <p className="ks-muted">{t(`approval.type_${item.requestType}`)}</p>
        <h2 className="heading-md">
          {item.subject.accountId ? (
            <Link to="/accounts/$accountId" params={{ accountId: item.subject.accountId }}>
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        <p>
          {t('approvals.asked', {
            name: item.requester.name,
            when: dates.dateTime(item.createdAt),
          })}
        </p>
      </div>
      {children}
    </div>
  );
}

function Mine() {
  const { t } = useLanguage();
  const mine = useMine();
  const items = mine.data?.pages.flatMap((page) => page.items) ?? [];
  if (mine.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(mine.error, t)}
      </p>
    );
  }
  if (mine.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  return (
    <>
      {items.length === 0 ? (
        <EmptyState icon={<Icon icon={Send} />} title={t('approvals.mine_empty_title')}>
          {t('approvals.mine_empty_body')}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t('approvals.view_mine')}>
          {items.map((item) => (
            <li key={item.id}>
              <MyRequest item={item} />
            </li>
          ))}
        </ul>
      )}
      <More query={mine} />
    </>
  );
}

function MyRequest({ item }: { item: ApprovalResult }) {
  const { t } = useLanguage();
  const decisions = useDecisions();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function withdraw() {
    setBusy(true);
    setFailure(undefined);
    try {
      await decisions.withdraw(item);
      setAsking(false);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const title = item.subject.title || t(`approval.type_${item.requestType}`);
  return (
    <article className="ks-card flex flex-col gap-4" aria-label={title}>
      <Heading item={item} title={title}>
        <StatusBadge variant={STATUS_BADGE[item.status]}>
          {t(`approval.status_${item.status}`)}
        </StatusBadge>
      </Heading>
      <ApprovalSteps item={item} />
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {item.cancellable ? (
        asking ? (
          <Confirm
            question={t('approvals.withdraw_question')}
            action={
              <Button variant="danger" busy={busy} onClick={() => void withdraw()}>
                {t('approvals.withdraw')}
              </Button>
            }
            cancel={
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('approvals.keep')}
              </Button>
            }
          >
            <p>{t('approvals.withdraw_body')}</p>
          </Confirm>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            icon={<Icon icon={Undo2} />}
            onClick={() => setAsking(true)}
          >
            {t('approvals.withdraw')}
          </Button>
        )
      ) : null}
    </article>
  );
}

function More({
  query,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  const { t } = useLanguage();
  return query.hasNextPage ? (
    <Button
      variant="secondary"
      className="self-start"
      busy={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
    >
      {t('common.load_more')}
    </Button>
  ) : null;
}
