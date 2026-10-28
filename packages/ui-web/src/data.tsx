import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { type More, Pager, usePagedRows } from './pager';

/** The fixed mapping of record states to badge variants (components/StatusBadge). */
export type BadgeVariant = 'success' | 'pending' | 'waiting' | 'info' | 'danger' | 'neutral';

/** One record's state as a word with a dot: the word is the meaning, the colour is for scanning. */
export function StatusBadge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={cn('ks-badge', variant)}>{children}</span>;
}

export interface Column<Row> {
  key: string;
  header: string;
  /** `end` right-aligns numbers in tabular figures; `num` keeps tabular figures at the start, for codes and phone numbers. */
  align?: 'start' | 'end' | 'num';
  render: (row: Row) => ReactNode;
}

/**
 * Whether a box's content is wider than the box, kept current as either changes size. A box that
 * scrolls must take keyboard focus, so people who don't use a mouse can scroll it too.
 */
function useScrolls(box: RefObject<HTMLElement | null>, shown: boolean): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    check();
    return () => observer.disconnect();
  }, [box, shown]);
  return scrolls;
}

/**
 * The portal's register (components/DataTable): compact rows, a caption for screen readers, and
 * ten rows a page with Previous and Next (decision D104). `more` asks the server for the rows after
 * those loaded, as the API's cursor pages, when Next runs past them. Every loaded row stays in the
 * table, those off the page hidden, so a printed sheet still holds them all.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  more,
  selectedKey,
  stickyFirst = false,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** The server has rows after those loaded: Next asks for them, as its cursor pages. */
  more?: More;
  /** The row shown beside its detail (SplitDetail), marked chosen. */
  selectedKey?: string | null | undefined;
  /** Keeps the first column in view while the table scrolls sideways, for wide registers. */
  stickyFirst?: boolean;
}) {
  const cell = (align: Column<Row>['align']) =>
    align === 'end' ? 'r' : align === 'num' ? 'ks-num' : undefined;
  const box = useRef<HTMLDivElement>(null);
  const shown = rows.length > 0 || !empty;
  const scrolls = useScrolls(box, shown);
  const paging = usePagedRows(rows.length, more, rows[0] ? rowKey(rows[0]) : null);
  if (!shown) return <>{empty}</>;
  return (
    <div className="flex flex-col items-start gap-3">
      <div
        ref={box}
        className="relative w-full overflow-x-auto"
        {...(scrolls ? { role: 'region', 'aria-label': caption, tabIndex: 0 } : {})}
      >
        <table className={cn('ks-table', stickyFirst && 'sticky-first')}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cell(column.align)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = rowKey(row);
              const selected = selectedKey !== undefined && selectedKey === key;
              return (
                <tr
                  key={key}
                  className={cn(selected && 'sel', !paging.onPage(index) && 'ks-off-page')}
                  aria-selected={selectedKey === undefined ? undefined : selected}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cell(column.align)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager paging={paging} />
    </div>
  );
}

/**
 * A question before something that can't be undone, in place rather than in a dialog: what will
 * happen, the action, and a way back.
 */
export function Confirm({
  question,
  children,
  action,
  cancel,
}: {
  question: string;
  children?: ReactNode;
  action: ReactNode;
  cancel: ReactNode;
}) {
  return (
    <div className="ks-card flex flex-col gap-3" role="group" aria-label={question}>
      <p className="font-semibold" role="alert">
        {question}
      </p>
      {children}
      <div className="flex flex-wrap gap-2">
        {action}
        {cancel}
      </div>
    </div>
  );
}
