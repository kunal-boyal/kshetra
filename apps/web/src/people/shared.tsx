import { ApiError } from '@kshetra/api-client';
import { formatDate, formatDateTime } from '@kshetra/i18n';
import type { DesignationResult, Locale, TransferStatus, UserStatus } from '@kshetra/shared';
import { type BadgeVariant, Icon, StatusBadge } from '@kshetra/ui-web';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useLanguage } from '../i18n';

/** A designation's name in the reader's language, singular. */
export function designationName(
  key: string,
  designations: readonly Pick<DesignationResult, 'key' | 'name'>[],
  locale: Locale,
): string {
  return designations.find((designation) => designation.key === key)?.name[locale].one ?? key;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useLanguage();
  return (
    <StatusBadge variant={status === 'active' ? 'success' : 'neutral'}>
      {t(status === 'active' ? 'people.active' : 'people.inactive')}
    </StatusBadge>
  );
}

const TRANSFER_VARIANTS: Record<TransferStatus, BadgeVariant> = {
  scheduled: 'info',
  applied: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const { t } = useLanguage();
  return <StatusBadge variant={TRANSFER_VARIANTS[status]}>{t(`transfer.${status}`)}</StatusBadge>;
}

/** Dates and times on the tenant's clock, in the reader's language. */
export function useDates(timeZone: string) {
  const { locale } = useLanguage();
  return {
    date: (value: string) => formatDate(value, { locale }),
    dateTime: (value: string) => formatDateTime(value, { locale, timeZone }),
  };
}

/**
 * Field problems from a VALIDATION or CONFLICT answer, by path, such as `code` or `custom.zone`:
 * what each field shows under itself.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.details.map((detail) => [detail.path, detail.issue]));
}

/** A page's title row: a way back, the heading, and its actions. */
export function PageHeader({
  title,
  back,
  intro,
  children,
}: {
  title: string;
  back?: { to: string; params?: Record<string, string>; label: string };
  intro?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link
          to={back.to}
          {...(back.params ? { params: back.params } : {})}
          className="ks-btn ghost sm self-start"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="heading-xl">{title}</h1>
          {intro ? <p className="ks-muted max-w-prose">{intro}</p> : null}
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

/** A labelled section of a detail page. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ks-card flex flex-col gap-3" aria-label={title}>
      <h2 className="heading-md">{title}</h2>
      {children}
    </section>
  );
}

/** Label and value pairs (`ks-dl`). */
export function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="ks-dl">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** How long typing must pause before a search asks the server. Input handling, not motion. */
const SEARCH_PAUSE_MS = 300;

/** The value once it has stopped changing for a moment. */
export function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}
