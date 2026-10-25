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
import { webClient } from './client';
import { LanguageProvider } from './i18n';
import { applyBrand, applySavedBrand } from './brand';
import { applyLocale, applyTheme, forgetTenants, savedLocale, savedTheme } from './preferences';
import { createAppRouter } from './router';
import { PRODUCT_NAME } from './layout/brand';

// Language and theme apply before the first paint, so nothing flashes.
applyLocale(savedLocale());
applyTheme(savedTheme());
applySavedBrand();
document.title = PRODUCT_NAME;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: true } },
});
// Signing out, or a session the server ends, forgets the person's data and returns to sign-in.
const client = webClient(() => {
  queryClient.clear();
  forgetTenants();
  applyBrand(null);
  // Someone already there stays, with any reason single sign-on came back with (decision D91).
  if (window.location.pathname !== '/sign-in') void router.navigate({ to: '/sign-in' });
});
const router = createAppRouter({ client, queryClient });

// The access token lives in memory only, so a reload asks the directory's cookie for a new one.
await client.restore().catch(() => null);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
