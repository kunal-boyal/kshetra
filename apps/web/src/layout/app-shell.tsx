import { Button, Icon } from '@kshetra/ui-web';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { House, LogOut, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { savedTenants } from '../preferences';
import { Brand } from './brand';
import { LanguagePicker, ThemePicker } from './preferences-menu';

/**
 * The portal's frame (spec 8.2): navigation on the left, the tenant and the person's choices on
 * top. Navigation shows only what the person may use; each module adds its entry when it arrives.
 */
export function AppShell() {
  const { client, queryClient } = useApp();
  const navigate = useNavigate();
  const { t, setTerms } = useLanguage();
  const config = useConfig(client, queryClient);
  const [error, setError] = useState<string>();
  const tenant = client.session?.tenant;
  const others = savedTenants().filter((choice) => choice.id !== tenant?.id);

  useEffect(() => {
    setTerms(config.data?.bundle.terminology);
  }, [config.data, setTerms]);

  /** Runs a menu action; when it fails, the person is still signed in and sees why. */
  function act(work: () => Promise<void>) {
    setError(undefined);
    work().catch((caught: unknown) => setError(errorMessage(caught, t)));
  }

  async function switchTo(tenantId: string) {
    await client.switchTenant(tenantId);
    queryClient.clear();
    await navigate({ to: '/' });
  }

  return (
    <div className="ks min-h-screen md:grid md:grid-cols-[var(--nav-web)_1fr]">
      <a href="#content" className="sr-only focus:not-sr-only">
        {t('shell.skip')}
      </a>
      <nav
        aria-label={t('shell.navigation')}
        className="flex flex-col gap-6 border-[var(--border)] bg-[var(--surface)] p-4 md:min-h-screen md:border-r"
      >
        <Brand />
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              to="/"
              className="ks-btn ghost block justify-start"
              activeProps={{ 'aria-current': 'page', className: 'tonal' }}
            >
              <Icon icon={House} />
              {t('shell.home')}
            </Link>
          </li>
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
          <p className="heading-md">{tenant?.name}</p>
          <div className="flex flex-wrap items-center gap-2" aria-label={t('shell.account_menu')}>
            <LanguagePicker />
            <ThemePicker />
            {others.map((choice) => (
              <Button
                key={choice.id}
                size="sm"
                variant="ghost"
                icon={<Icon icon={Repeat} size="sm" />}
                onClick={() => act(() => switchTo(choice.id))}
              >
                {t('shell.switch_organisation')}: {choice.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              icon={<Icon icon={LogOut} size="sm" />}
              onClick={() => act(() => client.signOut())}
            >
              {t('shell.sign_out')}
            </Button>
          </div>
          {error ? (
            <p className="ks-help error w-full" role="alert">
              {error}
            </p>
          ) : null}
        </header>
        <main id="content" className="mx-auto w-full max-w-[var(--content-max)] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
