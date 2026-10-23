import type { OrgChartNode } from '@thelamp/shared';
import { Button, Icon } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useOrgChart } from './data';
import { designationName, PageHeader, UserStatusBadge } from './shared';

/** Counts by designation, highest designation first, as "2 Managers · 12 Executives". */
function useCounts() {
  const { locale } = useLanguage();
  const access = useAccess();
  return (counts: Record<string, number>) =>
    [...access.designations]
      .sort((a, b) => a.level - b.level)
      .filter((designation) => (counts[designation.key] ?? 0) > 0)
      .map((designation) => {
        const count = counts[designation.key]!;
        return `${count} ${count === 1 ? designation.name[locale].one : designation.name[locale].other}`;
      })
      .join(' · ');
}

/**
 * The organisation chart (M3): the top of what the viewer reaches, opened a level at a time, each
 * person with their direct reports and everyone below them by designation.
 */
export function OrgChartPage() {
  const { t } = useLanguage();
  const top = useOrgChart();
  const counts = useCounts();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('org.title')} intro={t('org.intro')} />
      {top.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(top.error, t)}
        </p>
      ) : top.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <section className="ks-card flex flex-col gap-1" aria-label={t('org.totals')}>
            <h2 className="label-sm ks-muted">{t('org.totals')}</h2>
            <p>{counts(top.data.totals) || '—'}</p>
          </section>
          {top.data.items.length === 0 ? (
            <p className="ks-muted">{t('org.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {top.data.items.map((node) => (
                <Node key={node.id} node={node} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Node({ node }: { node: OrgChartNode }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const counts = useCounts();
  const [open, setOpen] = useState(false);
  const children = useOrgChart(node.id, open);
  const team = counts(node.team);
  return (
    <li className="flex flex-col gap-2">
      <div className="ks-card flex flex-wrap items-center gap-3">
        {node.reports > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-label={t(open ? 'org.collapse' : 'org.expand', { name: node.name })}
            icon={<Icon icon={open ? ChevronDown : ChevronRight} size="sm" />}
            onClick={() => setOpen(!open)}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <Link to="/people/$userId" params={{ userId: node.id }} className="font-semibold">
            {node.name}
          </Link>
          <span className="ks-muted">
            {designationName(node.designation, access.designations, locale)} ·{' '}
            {t('org.reports', { count: node.reports })}
          </span>
          {team ? <span className="ks-help">{team}</span> : null}
        </div>
        <UserStatusBadge status={node.status} />
      </div>
      {open ? (
        children.isPending ? (
          <p className="ks-muted pl-8">{t('common.loading')}</p>
        ) : children.isError ? (
          <p className="ks-help error pl-8" role="alert">
            {errorMessage(children.error, t)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 border-l border-[var(--border)] pl-8">
            {children.data.items.map((child) => (
              <Node key={child.id} node={child} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}
