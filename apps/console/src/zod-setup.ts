import { config } from 'zod';

// zod checks schemas without compiling them: its probe for `new Function` would break the
// Content-Security-Policy, which allows no eval (decision D101). Imported first by main.tsx,
// so it runs before any module makes a schema.
config({ jitless: true });
