import type { ReactNode } from 'react';
import { isoWeekday, monthDates } from './plan-days';

export interface CalendarCell {
  date: string;
  title: ReactNode;
  detail?: ReactNode;
  /** `off` for a weekly off or holiday (sunken), `leave` for leave (the info tint). */
  tone?: 'off' | 'leave';
}

const TONE = {
  off: 'bg-[var(--surface-sunken)] border-transparent',
  leave: 'bg-[var(--info-bg)] border-[var(--info-border)]',
} as const;

/**
 * A month as weeks from Monday (decision D104): each day its date, a title and a line of detail.
 * A table, so the weeks and weekdays read as such; it scrolls inside its box on a phone.
 */
export function MonthCalendar({
  period,
  caption,
  weekdays,
  cells,
}: {
  period: string;
  caption: string;
  /** Monday to Sunday, short. */
  weekdays: readonly string[];
  cells: readonly CalendarCell[];
}) {
  const dates = monthDates(period);
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const lead = isoWeekday(dates[0]!) - 1;
  const slots: (string | null)[] = [...Array<null>(lead).fill(null), ...dates];
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks = Array.from({ length: slots.length / 7 }, (_, index) =>
    slots.slice(index * 7, index * 7 + 7),
  );
  return (
    // Focusable, so the month can be scrolled by keyboard on a narrow screen.
    <div className="relative overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full min-w-[42rem] table-fixed border-separate border-spacing-1.5">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {weekdays.map((name) => (
              <th key={name} scope="col" className="ks-meta px-1.5 text-start font-semibold">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((date, column) => {
                if (!date) return <td key={`blank-${column}`} />;
                const cell = byDate.get(date);
                return (
                  <td
                    key={date}
                    className={`h-24 rounded-[var(--radius-md)] border border-[var(--border)] p-2 align-top ${
                      cell?.tone ? TONE[cell.tone] : 'bg-[var(--surface)]'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="ks-meta tabular-nums">{Number(date.slice(8, 10))}</span>
                      {cell?.title ? (
                        <span className="line-clamp-2 text-sm font-semibold leading-snug">
                          {cell.title}
                        </span>
                      ) : null}
                      {cell?.detail ? <span className="ks-meta">{cell.detail}</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
