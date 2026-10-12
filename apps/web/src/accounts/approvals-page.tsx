import { ApprovalResult } from '@kshetra/shared';
import { Button, EmptyState, Icon, TextAreaField } from '@kshetra/ui-web';
import { Link } from '@tanstack/react-router';
import { Check, Inbox, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, write } from '../people/data';
import { fieldErrors, PageHeader, useDates } from '../people/shared';
import { useInbox, useRefreshAccounts } from './data';

/**
 * The approvals inbox (M15), as phase 1 needs it: the accounts and locations proposed by the
 * people who report to the viewer, decided one at a time (decision D38).
 */
export function ApprovalsPage() {
  const { t } = useLanguage();
  const inbox = useInbox();
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('approvals.title')} intro={t('approvals.intro')} />
      {inbox.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(inbox.error, t)}
        </p>
      ) : inbox.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Icon icon={Inbox} />} title={t('approvals.empty_title')}>
          {t('approvals.empty_body')}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t('approvals.title')}>
          {items.map((item) => (
            <li key={item.id}>
              <Request item={item} />
            </li>
          ))}
        </ul>
      )}
      {inbox.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          busy={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
        >
          {t('common.load_more')}
        </Button>
      ) : null}
    </div>
  );
}

function Request({ item }: { item: ApprovalResult }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const refresh = useRefreshAccounts();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/approvals/${item.id}/decision`, ApprovalResult, {
        decision,
        version: item.version,
        ...(decision === 'reject' ? { note: note.trim() } : {}),
      });
      await refresh(item.subject.accountId ?? undefined);
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  const title = item.subject.title || t(`approval.type_${item.requestType}`);
  return (
    <article className="ks-card flex flex-col gap-3" aria-label={title}>
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
