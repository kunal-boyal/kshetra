import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library cleans up by itself only with Vitest's globals, which these tests don't use.
afterEach(cleanup);
