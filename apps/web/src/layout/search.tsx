import { formatNumber } from '@thelamp/i18n';
import { SearchResult } from '@thelamp/shared';
import { Avatar, Icon } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileText, type LucideIcon, Search, ShoppingCart, Store } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from '../context';
import { useLanguage } from '../i18n';
import { read } from '../people/data';

/** A screen the person may open, from the rail. */
export interface Screen {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface Option {
  id: string;
  to: string;
  params?: Record<string, string>;
  label: string;
  meta?: string;
  lead: ReactNode;
}

/** The fewest characters the server searches with (`SearchQuery`). */
const MIN = 2;
/** How long typing rests before the server is asked. */
const DEBOUNCE_MS = 250;

/** The words typed, once they have rested. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/** Whether a key press is typing into something, so `/` is a character there, not a shortcut. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Search across the product in the app bar (phase 4 step A1, decision D110): the screens the
 * person may open, and the people, accounts, orders and forms the server finds within their scope,
 * as a combobox over a grouped list box. `/` focuses it from anywhere but a field; the arrow keys
 * move through the matches, Enter opens one, Escape closes the list.
 */
export function SearchBox({ screens }: { screens: readonly Screen[] }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const words = text.trim();
  const settled = useSettled(words);
  const found = useQuery({
    queryKey: ['search', settled],
    queryFn: () => read(client, `/v1/search?q=${encodeURIComponent(settled)}`, SearchResult),
    enabled: settled.length >= MIN,
    staleTime: 30_000,
  });

  useEffect(() => {
    const focus = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || typing(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', focus);
    return () => document.removeEventListener('keydown', focus);
  }, []);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const groups = useMemo(() => {
    const lower = words.toLocaleLowerCase();
    const data = settled === words ? found.data : undefined;
    const shown: { key: string; label: string; options: Option[] }[] = [];
    const add = (key: string, label: string, options: Option[]) => {
      if (options.length > 0) shown.push({ key, label, options });
    };
    add(
      'screens',
      t('search.group_screens'),
      words.length === 0
        ? []
        : screens
            .filter((screen) => screen.label.toLocaleLowerCase().includes(lower))
            .slice(0, 5)
            .map((screen) => ({
              id: `screen-${screen.to}`,
              to: screen.to,
              label: screen.label,
              lead: <Icon icon={screen.icon} size="sm" />,
            })),
    );
    add(
      'people',
      t('search.group_people'),
      (data?.people ?? []).map((person) => ({
        id: `person-${person.id}`,
        to: '/people/$userId',
        params: { userId: person.id },
        label: person.name,
        meta: person.code,
        lead: <Avatar name={person.name} id={person.id} size="sm" />,
      })),
    );
    add(
      'accounts',
      t('search.group_accounts'),
      (data?.accounts ?? []).map((account) => ({
        id: `account-${account.id}`,
        to: '/accounts/$accountId',
        params: { accountId: account.id },
        label: account.name,
        meta: account.code,
        lead: <Icon icon={Store} size="sm" />,
      })),
    );
    add(
      'orders',
      t('search.group_orders'),
      (data?.orders ?? []).map((order) => ({
        id: `order-${order.id}`,
        to: '/orders/$orderId',
        params: { orderId: order.id },
        label: t('search.order', { number: formatNumber(order.number, { locale }) }),
        meta: order.account.name,
        lead: <Icon icon={ShoppingCart} size="sm" />,
      })),
    );
    add(
      'forms',
      t('search.group_forms'),
      (data?.forms ?? []).map((form) => ({
        id: `form-${form.id}`,
        to: '/settings/forms/$formId',
        params: { formId: form.id },
        label: form.name[locale].one,
        lead: <Icon icon={FileText} size="sm" />,
      })),
    );
    return shown;
  }, [found.data, locale, screens, settled, t, words]);

  const options = groups.flatMap((group) => group.options);
  const current = options[Math.min(active, options.length - 1)];
  const waiting = words.length >= MIN && (settled !== words || found.isFetching);
  const listId = `${id}-results`;
  const optionId = (option: Option) => `${id}-${option.id}`;

  function go(option: Option) {
    setOpen(false);
    setText('');
    input.current?.blur();
    void navigate({ to: option.to, ...(option.params ? { params: option.params } : {}) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(
        (at) => (Math.min(at, options.length - 1) + step + options.length) % options.length,
      );
    } else if (event.key === 'Enter' && open && current) {
      event.preventDefault();
      go(current);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        setText('');
      }
    }
  }

  const note =
    words.length === 0
      ? null
      : waiting && options.length === 0
        ? t('search.searching')
        : options.length === 0 && words.length >= MIN
          ? t('search.nothing', { q: words })
          : options.length === 0
            ? t('search.more_letters')
            : null;
  const showing = open && words.length > 0;

  return (
    <div ref={root} className="ks-search ks-no-print">
      <div className="ks-affix">
        <span aria-hidden="true">
          <Icon icon={Search} size="sm" />
        </span>
        <input
          ref={input}
          className="ks-input"
          type="search"
          role="combobox"
          aria-label={t('search.label')}
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing && current ? optionId(current) : undefined}
          aria-keyshortcuts="/"
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="ks-search-results" hidden={!showing}>
        <div id={listId} role="listbox" aria-label={t('search.results')}>
          {groups.map((group) => (
            <div
              key={group.key}
              role="group"
              aria-labelledby={`${id}-${group.key}`}
              className="ks-search-group"
            >
              <p className="ks-rail-label" id={`${id}-${group.key}`}>
                {group.label}
              </p>
              {group.options.map((option) => (
                <div
                  key={option.id}
                  id={optionId(option)}
                  role="option"
                  aria-selected={option === current}
                  className="ks-search-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(options.indexOf(option))}
                  onClick={() => go(option)}
                >
                  {option.lead}
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.meta ? <span className="ks-meta">{option.meta}</span> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
        {note ? (
          <p className="ks-meta ks-search-note" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
