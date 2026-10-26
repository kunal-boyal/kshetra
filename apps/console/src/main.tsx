// Mukta, the design system's face (decision D72), drawn for Latin and Devanagari alike.
import '@fontsource/mukta/400.css';
import '@fontsource/mukta/500.css';
import '@fontsource/mukta/600.css';
import '@fontsource/mukta/700.css';
import './app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT_NAME } from './brand';
import { consoleClient } from './client';
import { ConsoleProvider } from './context';
import { LanguageProvider } from './i18n';
import { applyLocale, applyTheme, savedLocale, savedTheme } from './preferences';
import { createConsoleRouter } from './router';
import { startErrorReports } from './error-reports';

startErrorReports();
applyLocale(savedLocale());
applyTheme(savedTheme());
document.title = `${PRODUCT_NAME} console`;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: true } },
});
// Signing out, or a session the server ends, forgets what was read and returns to sign-in.
const client = consoleClient(() => {
  queryClient.clear();
  void router.navigate({ to: '/sign-in' });
});
const context = { client, queryClient };
const router = createConsoleRouter(context);

// The access token lives in memory only, so a reload asks the cookie for a new one.
await client.restore().catch(() => null);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ConsoleProvider value={context}>
          <RouterProvider router={router} />
        </ConsoleProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
