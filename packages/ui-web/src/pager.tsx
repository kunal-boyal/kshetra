import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { Button } from './button';
import { Icon } from './icon';

/** Rows a page shows (decision D104). */
export const PAGE_SIZE = 10;

/** What the pager says, in the reader's language: each app provides it once, at its root. */
export interface PagerText {
  previous: string;
  next: string;
  /** "Showing 11–20", or with a total the app knows: "Showing 11–20 of 46". */
  showing: (from: number, to: number) => string;
  /** Names the pager for screen readers: "Pages". */
  label: string;
}

const PagerTextContext = createContext<PagerText>({
  previous: 'Previous',
  next: 'Next',
  showing: (from, to) => `Showing ${from}–${to}`,
  label: 'Pages',
});

export const PagerTextProvider = PagerTextContext.Provider;

/** Where the server's list goes on, when it has more than is loaded. */
export interface More {
  onClick: () => void;
  busy?: boolean;
}

export interface Paging {
  /** The index of every loaded row, and whether it is on the page shown. */
  onPage: (index: number) => boolean;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
  busy: boolean;
  previous: () => void;
  next: () => void;
}

/**
 * Ten rows a page over rows loaded so far (decision D104). Next shows the following ten, asking
 * the server for more (`more`) when it runs past what is loaded, as its cursor pages; a list that
 * loads everything is paged on screen. A new list, such as after a filter, starts at its first page.
 */
export function usePagedRows(
  count: number,
  more?: More,
  resetKey?: unknown,
  size: number = PAGE_SIZE,
): Paging {
  const [page, setPage] = useState(0);
  // How many rows were loaded when more were asked for; null while not waiting.
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [listKey, setListKey] = useState(resetKey);
  const pages = Math.max(1, Math.ceil(count / size));
  // A changed list starts again at its first page (adjusted while rendering, as React advises).
  if (listKey !== resetKey) {
    setListKey(resetKey);
    setPage(0);
    setAskedAt(null);
  }
  // Once rows arrive, move on to them if they reach past this page; if none came, stay.
  if (askedAt !== null && count > askedAt) {
    if (count > (page + 1) * size) setPage(page + 1);
    setAskedAt(null);
  } else if (askedAt !== null && !more) {
    setAskedAt(null);
  }
  const shown = Math.min(page, pages - 1);
  const from = count === 0 ? 0 : shown * size + 1;
  const to = Math.min(count, (shown + 1) * size);
  return {
    onPage: (index) => index >= shown * size && index < (shown + 1) * size,
    from,
    to,
    hasPrevious: shown > 0,
    hasNext: shown < pages - 1 || Boolean(more),
    busy: askedAt !== null || Boolean(more?.busy),
    previous: () => setPage(Math.max(0, shown - 1)),
    next: () => {
      if (shown < pages - 1) setPage(shown + 1);
      else if (more) {
        setAskedAt(count);
        more.onClick();
      }
    },
  };
}

/** "Showing 11–20" with Previous and Next (components/DataTable); nothing for a single page. */
export function Pager({ paging }: { paging: Paging }): ReactNode {
  const text = useContext(PagerTextContext);
  if (!paging.hasPrevious && !paging.hasNext) return null;
  return (
    // A group, not a landmark: a page may hold several paged lists.
    <div role="group" aria-label={text.label} className="ks-pager ks-no-print">
      <span className="ks-meta ks-num" aria-live="polite">
        {text.showing(paging.from, paging.to)}
      </span>
      <span className="ks-pager-buttons">
        <Button
          size="sm"
          variant="secondary"
          disabled={!paging.hasPrevious}
          onClick={paging.previous}
          icon={<Icon icon={ChevronLeft} size="sm" />}
        >
          {text.previous}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!paging.hasNext}
          busy={paging.busy}
          onClick={paging.next}
        >
          {text.next}
          <Icon icon={ChevronRight} size="sm" />
        </Button>
      </span>
    </div>
  );
}
