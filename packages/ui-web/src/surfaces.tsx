import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/** A product-owned pastel that marks a kind of thing, never a status. */
export type Hue = 'sky' | 'peach' | 'mint' | 'lilac' | 'butter' | 'rose' | 'sage' | 'sand';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: 'raised' | 'flat' | 'tint';
  hue?: Hue;
}

/** A surface with a soft shadow, never a hard outline (components/Cover, Card rules). */
export function Card({ tone, hue, className, ...rest }: CardProps) {
  return <section className={cn('ks-card', tone, hue && `hue-${hue}`, className)} {...rest} />;
}

export interface IconChipProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hue?: Hue;
  round?: boolean;
  soft?: boolean;
}

/** An icon or initials on a pastel chip (components/IconChip). */
export function IconChip({ children, size = 'md', hue, round, soft }: IconChipProps) {
  return (
    <span
      className={cn(
        'ks-ico',
        size !== 'md' && size,
        round && 'round',
        soft && 'soft',
        hue && `hue-${hue}`,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/**
 * Says what a figure or record really is, beside it: provisional, indicative, a request
 * (components/Notice). Information, not a warning, so it is never dismissible.
 */
export function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="ks-notice">
      {icon}
      <span>{children}</span>
    </p>
  );
}

export interface EmptyStateProps {
  icon: ReactNode;
  hue?: Hue;
  title: string;
  /** Says what happens next, as spec 8.5 asks. */
  children: ReactNode;
  action?: ReactNode;
}

/** An empty screen that says what happens next (components/EmptyState). */
export function EmptyState({ icon, hue = 'lilac', title, children, action }: EmptyStateProps) {
  return (
    <section className="ks-empty ks-enter">
      <IconChip size="xl" hue={hue} soft>
        {icon}
      </IconChip>
      <h2 className="ks-title heading-md">{title}</h2>
      <p className="ks-meta ks-muted">{children}</p>
      {action}
    </section>
  );
}
