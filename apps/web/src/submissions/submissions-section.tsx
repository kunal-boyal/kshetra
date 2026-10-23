import { formatNumber } from '@thelamp/i18n';
import { type SubmissionResult, SubmissionListResult } from '@thelamp/shared';
import { type Column, DataTable, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { Section, useDates } from '../people/shared';

type Whose = { userId: string } | { accountId: string };

function useSubmissions(whose: Whose) {
  const { client } = useApp();
  const filter = 'userId' in whose ? `userId=${whose.userId}` : `accountId=${whose.accountId}`;
  return useInfiniteQuery({
    queryKey: ['submissions', filter],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/submissions?${filter}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        SubmissionListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

const STATUS_VARIANT = { pending: 'pending', approved: 'success', rejected: 'danger' } as const;

/**
 * The forms a person filled, or those filled at an account (M6), newest first: when, which form,
 * whose or where, how far from the account, and what reviewers should look at. Review itself
 * arrives with M7.
 */
export function SubmissionsSection(props: Whose) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const submissions = useSubmissions(props);
  const rows = submissions.data?.pages.flatMap((page) => page.items) ?? [];
  const byPerson = 'userId' in props;
  const metres = (value: number | null) => formatNumber(value ?? 0, { locale });

  const columns: Column<SubmissionResult>[] = [
    {
      key: 'captured',
      header: t('submissions.captured'),
      render: (row) => dates.dateTime(row.capturedAt),
    },
    {
      key: 'form',
      header: t('submissions.form'),
      render: (row) => row.form.name[locale].one,
    },
    byPerson
      ? {
          key: 'account',
          header: t('submissions.account'),
          render: (row) =>
            row.account ? (
              <Link to="/accounts/$accountId" params={{ accountId: row.account.id }}>
                {row.account.name}
              </Link>
            ) : (
              <span className="ks-muted">{t('submissions.no_account')}</span>
            ),
        }
      : {
          key: 'person',
          header: t('submissions.person'),
          render: (row) => (
            <Link to="/people/$userId" params={{ userId: row.user.id }}>
              {row.user.name}
            </Link>
          ),
        },
    {
      key: 'where',
      header: t('submissions.where'),
      render: (row) =>
        row.geofence === null ? (
          '—'
        ) : row.geofence === 'unknown' ? (
          <StatusBadge variant="neutral">{t('submissions.unknown')}</StatusBadge>
        ) : (
          <StatusBadge variant={row.geofence === 'inside' ? 'success' : 'danger'}>
            {t(row.geofence === 'inside' ? 'submissions.inside' : 'submissions.outside', {
              distance: metres(row.distanceM),
            })}
          </StatusBadge>
        ),
    },
    {
      key: 'evidence',
      header: t('submissions.status'),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge variant={STATUS_VARIANT[row.status]}>
            {t(`submissions.status_${row.status}`)}
          </StatusBadge>
          {row.photos.length > 0 ? (
            <StatusBadge variant="info">
              {t('submissions.photos', { count: row.photos.length })}
            </StatusBadge>
          ) : null}
          {row.flags.map((flag) => (
            <StatusBadge key={flag} variant="danger">
              {t(`submissions.flag_${flag}`)}
            </StatusBadge>
          ))}
        </span>
      ),
    },
  ];

  return (
    <Section title={t('submissions.title')}>
      {submissions.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(submissions.error, t)}
        </p>
      ) : submissions.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('submissions.caption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState icon={<Icon icon={ClipboardList} />} title={t('submissions.none_title')}>
              {t(byPerson ? 'submissions.none_person' : 'submissions.none_account')}
            </EmptyState>
          }
          {...(submissions.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: submissions.isFetchingNextPage,
                  onClick: () => void submissions.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </Section>
  );
}
