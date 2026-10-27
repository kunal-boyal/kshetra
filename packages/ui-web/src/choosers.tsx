import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from './cn';

/** One option of a chooser; a count shows beside the label, as "Waiting · 14". */
export interface Choice<T extends string> {
  value: T;
  label: string;
  count?: number;
}

const counted = <T extends string>(choice: Choice<T>, format: (n: number) => string): ReactNode =>
  choice.count === undefined ? (
    choice.label
  ) : (
    // One flex item, so the button's gap doesn't widen the space before the count.
    <span>
      {choice.label} <span className="ks-chip-count">· {format(choice.count)}</span>
    </span>
  );

const plain = (n: number) => String(n);

/**
 * A row of toggles that narrows a list, each with its count (components/Choosers). The pressed
 * chip is filled; with `clearable`, pressing it again clears the filter.
 */
export function FilterChips<T extends string>({
  label,
  choices,
  value,
  onChange,
  formatCount = plain,
  clearable = false,
  children,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  formatCount?: (n: number) => string;
  clearable?: boolean;
  /** More chips after these, such as ghost buttons that open a filter. */
  children?: ReactNode;
}) {
  return (
    <div className="ks-chips" role="group" aria-label={label}>
      {choices.map((choice) => {
        const pressed = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            className={cn('ks-btn sm', pressed ? 'primary' : 'secondary')}
            aria-pressed={pressed}
            onClick={() => onChange(pressed && clearable ? null : choice.value)}
          >
            {counted(choice, formatCount)}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** A few views of one thing, side by side in a pill; one is always chosen (components/Choosers). */
export function SegmentedControl<T extends string>({
  label,
  choices,
  value,
  onChange,
  formatCount = plain,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  formatCount?: (n: number) => string;
}) {
  return (
    <div className="ks-seg" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={choice.value === value}
          onClick={() => onChange(choice.value)}
        >
          {counted(choice, formatCount)}
        </button>
      ))}
    </div>
  );
}

/** The props that make an element the panel of `Tabs` with this `idPrefix`. */
export const tabPanelProps = (idPrefix: string, value: string) =>
  ({
    id: `${idPrefix}-panel`,
    role: 'tabpanel',
    'aria-labelledby': `${idPrefix}-tab-${value}`,
    tabIndex: 0,
  }) as const;

/**
 * Underlined tabs over one panel (components/Choosers): the arrow keys, Home and End move between
 * them, and only the chosen tab is in the tab order.
 */
export function Tabs<T extends string>({
  label,
  choices,
  value,
  onChange,
  idPrefix,
  formatCount = plain,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
  formatCount?: (n: number) => string;
}) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = choices.findIndex((choice) => choice.value === value);
    const last = choices.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(choices[next]!.value);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={list} className="ks-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            id={`${idPrefix}-tab-${choice.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(choice.value)}
          >
            {counted(choice, formatCount)}
          </button>
        );
      })}
    </div>
  );
}
