import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The router restores scroll positions, which jsdom can't do; it only logs that it can't.
window.scrollTo = () => {};

// Testing Library cleans up by itself only with Vitest's globals, which these tests don't use.
// Saved preferences, such as the language, are cleared too, so no test sees another's choices.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
