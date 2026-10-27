import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PageHeaderProps {
  /** The page's one h1; put the period in it, as "Expenses · October". */
  title: string;
  /** One line under the title that sums the page up: "53 people · 46 active". */
  meta?: ReactNode;
  /** A sentence or two on what the page is for, for pages that need it. */
  intro?: ReactNode;
  /** A way back, such as a router link styled `ks-btn ghost sm`. */
  back?: ReactNode;
  /** Buttons at the title's end. */
  actions?: ReactNode;
  /** A row under the title for filter chips, tabs or a period stepper. */
  toolbar?: ReactNode;
  /** Before the title, such as a person's avatar on their own page. */
  lead?: ReactNode;
}

/** A page's head (components/PageHeader): back, title and meta, actions, then its toolbar. */
export function PageHeader({ title, meta, intro, back, actions, toolbar, lead }: PageHeaderProps) {
  const name = (
    <div className="ks-page-name">
      <h1 className="heading-xl">{title}</h1>
      {meta ? <p className="ks-meta">{meta}</p> : null}
      {intro ? <p className="ks-muted max-w-prose">{intro}</p> : null}
    </div>
  );
  return (
    <header className="ks-page-head">
      {back}
      <div className="ks-page-title">
        {lead ? (
          <div className="flex min-w-0 items-center gap-3">
            {lead}
            {name}
          </div>
        ) : (
          name
        )}
        {actions ? <div className="ks-page-actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="ks-page-toolbar">{toolbar}</div> : null}
    </header>
  );
}

/** Label and value pairs (`ks-dl`); `end` right-aligns the values, for amounts. */
export function DescriptionList({
  items,
  align = 'start',
  className,
}: {
  items: readonly (readonly [string, ReactNode])[];
  align?: 'start' | 'end';
  className?: string;
}) {
  return (
    <dl className={cn('ks-dl', align === 'end' && 'end', className)}>
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled card of a page, with its actions beside the title. */
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ks-card flex flex-col gap-3', className)} aria-label={title}>
      <div className="ks-spread">
        <h2 className="heading-md">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
