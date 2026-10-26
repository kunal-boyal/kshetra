import { Button, Icon } from '@thelamp/ui-web';
import { Printer } from 'lucide-react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { browser } from './browser';
import { useApp } from './context';
import { useConfig, useMe } from './data';
import { useLanguage } from './i18n';
import { useAccess } from './people/data';
import { useDates } from './people/shared';
import { useOrganisation } from './settings/data';

/** Which printable is being printed, if any: one at a time, for the whole page. */
let printing: string | null = null;
const listeners = new Set<() => void>();

function setPrinting(id: string | null) {
  printing = id;
  for (const listener of listeners) listener();
}

function usePrinting(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => printing,
  );
}

/**
 * Prints one printable (decision D99): its sheet is drawn, the page turns to the Light theme for
 * paper, and the browser's dialog opens. Most browsers return once it closes; `afterprint` covers
 * those that don't, and puts the theme and the page back.
 */
function print(id: string) {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', finish);
    if (theme === undefined) delete root.dataset.theme;
    else root.dataset.theme = theme;
    setPrinting(null);
  };
  flushSync(() => setPrinting(id));
  root.dataset.theme = 'light';
  window.addEventListener('afterprint', finish);
  try {
    browser.print();
  } finally {
    // A dialog that returned has closed; one still open finishes on `afterprint`.
    if (!window.matchMedia?.('print').matches) finish();
  }
}

/** The button that prints a printable, or saves it as a PDF from the same dialog. */
export function PrintButton({ printable, label }: { printable: string; label?: string }) {
  const { t } = useLanguage();
  return (
    <Button variant="secondary" icon={<Icon icon={Printer} />} onClick={() => print(printable)}>
      {label ?? t('print.button')}
    </Button>
  );
}

/**
 * What a sheet says before its content (spec M18): the tenant's legal name, what it is, its period
 * and filters, whose records the reader's role reaches, and when it was printed.
 */
function PrintHead({ title, details }: { title: string; details: readonly string[] }) {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const settings = useConfig(client, queryClient).data?.bundle.settings;
  const organisation = useOrganisation();
  const me = useMe(client);
  const legalName =
    settings?.legalName || organisation.data?.name || client.session?.tenant.name || '';
  return (
    <header className="ks-print-head">
      <span className="ks-print-org">{legalName}</span>
      <span className="ks-print-title">{title}</span>
      <ul className="ks-print-meta">
        {details.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {me.data ? (
          <li>
            {t('print.read_by', {
              name: me.data.name,
              scope: t(`scope.${me.data.scope}`),
            })}
          </li>
        ) : null}
        <li>{t('print.printed_at', { time: dates.dateTime(new Date().toISOString()) })}</li>
      </ul>
    </header>
  );
}

/**
 * Something that can be printed (M18, decision D99): the report on screen, an order, an account's
 * statement. While it prints, a copy with its heading is drawn straight under the page's body, and
 * the print layout (`ks-print-sheet` in the design system) prints that copy alone, without the
 * portal's frame or controls. What prints is what the screen shows.
 */
export function Printable({
  id,
  title,
  details,
  children,
}: {
  id: string;
  title: string;
  /** Lines under the title: the period, the filters. */
  details: readonly string[];
  children: ReactNode;
}) {
  const { client } = useApp();
  // The heading's reader and organisation are read now, so they are there when the dialog opens.
  useMe(client);
  useOrganisation();
  const active = usePrinting() === id;
  return (
    <>
      {children}
      {active
        ? createPortal(
            <div className="ks ks-print-sheet" data-printable={id} aria-hidden inert>
              <PrintHead title={title} details={details} />
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
