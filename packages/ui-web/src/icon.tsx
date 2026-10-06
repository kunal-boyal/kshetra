import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export interface IconProps {
  icon: LucideIcon;
  size?: 'sm' | 'md';
  className?: string;
  /** Names the icon for screen readers; without one it is decoration and hidden from them. */
  label?: string;
}

/** A Lucide icon (D18) at the design system's sizes and stroke widths. */
export function Icon({ icon: Glyph, size = 'md', className, label }: IconProps) {
  return (
    <Glyph
      className={cn('ks-icon', size === 'sm' && 'sm', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
