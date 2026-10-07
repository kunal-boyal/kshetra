import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

/** The fixed mapping of record states to badge variants (components/StatusBadge). */
export type BadgeVariant = 'success' | 'pending' | 'waiting' | 'info' | 'danger' | 'neutral';

/** One record's state as a word with a dot: the word is the meaning, the colour is for scanning. */
export function StatusBadge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={cn('ks-badge', variant)}>{children}</span>;
}

export interface Column<Row> {
  key: string;
  header: string;
  /** `end` right-aligns numbers in tabular figures. */
  align?: 'start' | 'end';
  render: (row: Row) => ReactNode;
}

/**
 * The portal's register (components/DataTable): compact rows, a caption for screen readers, and
 * cursor paging with a Load more button, as the API pages.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  more,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  more?: { label: string; onClick: () => void; busy?: boolean };
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="w-full overflow-x-auto">
        <table className="ks-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === 'end' ? 'r' : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.align === 'end' ? 'r' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more ? (
        <Button size="sm" variant="secondary" busy={more.busy ?? false} onClick={more.onClick}>
          {more.label}
        </Button>
      ) : null}
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
