import type { ComponentType, ReactNode } from 'react';
import { cn } from './cn';

/** A card of rows (`ks-list`), named for screen readers. */
export function List({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn('ks-list', className)} aria-label={label}>
      {children}
    </ul>
  );
}

/** What renders a row that goes somewhere, such as the portal's router link. */
export type RowLink = ComponentType<{
  className: string;
  children: ReactNode;
  'aria-current'?: 'true';
}>;

export interface ListItemProps {
  /** An avatar, icon chip, rank or status dot. */
  lead?: ReactNode;
  title: string;
  /** The line under the title: where, when, how much. */
  meta?: ReactNode;
  /** A value, badge or time at the row's end. */
  trailing?: ReactNode;
  selected?: boolean;
  /** Makes the row a link, through `as` when given (the portal's router link). */
  href?: string;
  as?: RowLink;
  onClick?: () => void;
}

/**
 * One row of a list (components/ListItem): lead, title and meta, then what sits at its end. A long
 * title is cut to one line and keeps its full text in a tooltip.
 */
export function ListItem({
  lead,
  title,
  meta,
  trailing,
  selected,
  href,
  as: As,
  onClick,
}: ListItemProps) {
  const className = cn('ks-item', selected && 'sel', (href || onClick) && 'act');
  const body = (
    <>
      {lead}
      <span className="ks-item-main">
        <span className="ks-title" title={title}>
          {title}
        </span>
        {meta ? <span className="ks-meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="ks-item-end">{trailing}</span> : null}
    </>
  );
  const current = selected ? ({ 'aria-current': 'true' } as const) : {};
  return (
    <li>
      {As ? (
        <As className={className} {...current}>
          {body}
        </As>
      ) : href ? (
        <a className={className} href={href} {...current}>
          {body}
        </a>
      ) : onClick ? (
        <button type="button" className={className} onClick={onClick} {...current}>
          {body}
        </button>
      ) : (
        <div className={className} {...current}>
          {body}
        </div>
      )}
    </li>
  );
}

/**
 * A list beside the detail of its chosen row (components/ListItem): three parts to two, one column
 * on narrow screens. Without a detail the list takes the width.
 */
export function SplitDetail({
  list,
  detail,
  detailLabel,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  detailLabel: string;
}) {
  return (
    <div className={cn('ks-split', !detail && 'single')}>
      <div className="ks-split-list">{list}</div>
      {detail ? (
        <aside className="ks-split-detail ks-card raised" aria-label={detailLabel}>
          {detail}
        </aside>
      ) : null}
    </div>
  );
}
