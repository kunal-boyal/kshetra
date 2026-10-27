import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The router restores scroll positions, which jsdom can't do; it only logs that it can't.
window.scrollTo = () => {};

// A screen's first render loads the whole router; on a busy CI runner that takes over the one
// second findBy… waits by default, so they wait up to five.
configure({ asyncUtilTimeout: 5000 });

// Testing Library cleans up by itself only with Vitest's globals, which these tests don't use.
// Saved preferences, such as the language, are cleared too, so no test sees another's choices.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
