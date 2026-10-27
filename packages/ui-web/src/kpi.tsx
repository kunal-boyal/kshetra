import type { ReactNode } from 'react';
import { cn } from './cn';
import type { RowLink } from './lists';
import { IconChip, type Hue } from './surfaces';

export interface KpiTileProps {
  label: string;
  /** The metric's icon, drawn on a small chip in its hue. */
  icon: ReactNode;
  hue?: Hue;
  /** The approved actual, formatted; pending work is never inside it. */
  value: string;
  /** Shares of the target, from 0 to 1: approved, then pending after it. Null without a target. */
  progress: { done: number; pending: number } | null;
  /** The foot's first part: attainment of the target, or that there is none. */
  foot: ReactNode;
  /** "+N pending", shown apart; leave out when nothing waits. */
  pending?: string | undefined;
  /** A mark beside the label, such as a draft target's badge. */
  badge?: ReactNode;
  /** Makes the whole tile a link, through `as` when given (the portal's router link). */
  href?: string;
  as?: RowLink;
  className?: string;
}

const share = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%`;

/**
 * One metric's approved actual against its target, pending work apart (components/KpiTile). The
 * bar fills once; reduced motion shows it full at once.
 */
export function KpiTile({
  label,
  icon,
  hue,
  value,
  progress,
  foot,
  pending,
  badge,
  href,
  as: As,
  className,
}: KpiTileProps) {
  const done = progress ? Math.min(1, Math.max(0, progress.done)) : 0;
  const body = (
    <>
      <div className="ks-kpi-head">
        <IconChip size="sm" {...(hue ? { hue } : {})}>
          {icon}
        </IconChip>
        <p className="ks-kpi-label">{label}</p>
        {badge}
      </div>
      <p className="ks-kpi-value">{value}</p>
      <div className="ks-bar" aria-hidden="true">
        {progress ? (
          <>
            <i className="done" style={{ width: share(done) }} />
            <i className="pend" style={{ width: share(Math.min(progress.pending, 1 - done)) }} />
          </>
        ) : null}
      </div>
      <div className="ks-kpi-foot">
        <span>{foot}</span>
        <span className="pend">{pending}</span>
      </div>
    </>
  );
  const classes = cn('ks-kpi', (href || As) && 'act', className);
  if (As) return <As className={classes}>{body}</As>;
  if (href)
    return (
      <a className={classes} href={href}>
        {body}
      </a>
    );
  return <div className={classes}>{body}</div>;
}
