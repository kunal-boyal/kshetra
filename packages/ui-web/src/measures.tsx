import { shiftPeriod } from '@thelamp/shared';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import type { BadgeVariant } from './data';
import { Icon } from './icon';
import type { RowLink } from './lists';
import { IconChip, type Hue } from './surfaces';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const percent = (value: number) => `${Math.round(clamp(value) * 1000) / 10}%`;

export interface StatTileProps {
  label: string;
  value: string;
  /** The line under the value: "of 46 people", "6 on leave". */
  sub?: ReactNode;
  /** A share from 0 to 1, drawn as a bar under the value. */
  meter?: number;
  /** Colours the value and the bar, for figures that mean trouble or good news. */
  tone?: 'danger' | 'success' | 'pending';
  icon?: ReactNode;
  hue?: Hue;
  /** Makes the whole tile a link, through `as` when given. */
  href?: string;
  as?: RowLink;
}

/**
 * One figure with its label and a line under it, an optional bar and icon (components/StatTile).
 * KpiTile is the same tile for a metric against its target.
 */
export function StatTile({
  label,
  value,
  sub,
  meter,
  tone,
  icon,
  hue,
  href,
  as: As,
}: StatTileProps) {
  const body = (
    <>
      <div className="ks-kpi-head">
        {icon ? (
          <IconChip size="sm" {...(hue ? { hue } : {})}>
            {icon}
          </IconChip>
        ) : null}
        <p className="ks-kpi-label">{label}</p>
      </div>
      <p className="ks-kpi-value">{value}</p>
      {meter === undefined ? null : (
        <div className="ks-bar" aria-hidden="true">
          <i className="done" style={{ width: percent(meter) }} />
        </div>
      )}
      {sub ? <div className="ks-kpi-foot">{sub}</div> : null}
    </>
  );
  const className = cn('ks-kpi ks-stat', tone, (href || As) && 'act');
  if (As) return <As className={className}>{body}</As>;
  if (href)
    return (
      <a className={className} href={href}>
        {body}
      </a>
    );
  return <div className={className}>{body}</div>;
}

/** Parts that make up a whole, each with a label and a value. */
export interface Part {
  label: string;
  value: number;
}

function Segments({
  label,
  parts,
  labels,
}: {
  label: string;
  parts: readonly (Part & { colour: string })[];
  labels: boolean;
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  if (total <= 0) return null;
  return (
    <div className="ks-share-wrap">
      <div className="ks-share" role="img" aria-label={label}>
        {parts.map((part) =>
          part.value > 0 ? (
            <span
              key={part.label}
              className="ks-share-part"
              style={{ flex: part.value, background: part.colour }}
            >
              {labels && part.value / total >= 0.12 ? `${part.label} ${part.value}` : null}
            </span>
          ) : null,
        )}
      </div>
      <ul className="sr-only">
        {parts.map((part) => (
          <li key={part.label}>
            {part.label}: {part.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How a whole splits, such as the score's weights, in the chart series colours with each part's
 * label inside when it fits (components/StatTile). The numbers are also listed for screen readers.
 */
export function ShareBar({
  label,
  parts,
  showLabels = true,
}: {
  label: string;
  parts: readonly Part[];
  showLabels?: boolean;
}) {
  return (
    <Segments
      label={label}
      labels={showLabels}
      parts={parts.map((part, index) => ({ ...part, colour: `var(--chart-${(index % 8) + 1})` }))}
    />
  );
}

/**
 * Parts of a whole by state, such as an account's ageing, in the status colours, with a legend
 * that names each part beside its colour (components/StatTile).
 */
export function StackedBar({
  label,
  parts,
  format = String,
}: {
  label: string;
  parts: readonly (Part & { tone: BadgeVariant })[];
  format?: (value: number) => string;
}) {
  if (!parts.some((part) => part.value > 0)) return null;
  return (
    <div className="flex flex-col gap-2">
      <Segments
        label={label}
        labels={false}
        parts={parts.map((part) => ({ ...part, colour: `var(--${part.tone}-solid)` }))}
      />
      <ul className="ks-legend" aria-hidden="true">
        {parts.map((part) => (
          <li key={part.label}>
            <i style={{ background: `var(--${part.tone}-solid)` }} />
            {part.label} <b>{format(part.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A month chip with a step either side, in place of a month input (components/PeriodStepper).
 * `min` and `max` stop it at the ends.
 */
export function PeriodStepper({
  value,
  onChange,
  format,
  label,
  previousLabel,
  nextLabel,
  min,
  max,
}: {
  /** `YYYY-MM`. */
  value: string;
  onChange: (period: string) => void;
  format: (period: string) => string;
  label: string;
  previousLabel: string;
  nextLabel: string;
  min?: string;
  max?: string;
}) {
  return (
    <div className="ks-period" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={previousLabel}
        disabled={min !== undefined && value <= min}
        onClick={() => onChange(shiftPeriod(value, -1))}
      >
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button
        type="button"
        aria-label={nextLabel}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(shiftPeriod(value, 1))}
      >
        <Icon icon={ChevronRight} size="sm" />
      </button>
    </div>
  );
}

export interface Step {
  state: 'done' | 'current' | 'rejected' | 'todo';
  title: string;
  meta?: string;
}

/** A sequence with where it stands (components/Steps): done, now, turned down, still to come. */
export function Steps({ label, steps }: { label: string; steps: readonly Step[] }) {
  return (
    <ol className="ks-steps" aria-label={label}>
      {steps.map((step, index) => (
        <li key={index} className={cn('ks-step', step.state !== 'todo' && step.state)}>
          <span className="ks-node">
            {step.state === 'done' ? <Icon icon={Check} size="sm" /> : null}
            {step.state === 'rejected' ? <Icon icon={X} size="sm" /> : null}
          </span>
          <div>
            <p className={cn('ks-title', step.state === 'todo' && 'ks-muted')}>{step.title}</p>
            {step.meta ? <p className="ks-meta">{step.meta}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
