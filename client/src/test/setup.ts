import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// No real Socket.io connections in tests; a test may override this mock.
vi.mock('../lib/socket', () => ({
  getSocket: () => ({ connected: false, on: () => {}, off: () => {}, emit: () => {} }),
  disconnectSocket: () => {},
}));

// jsdom lacks IntersectionObserver (used by scroll-in animations); every
// browser has it. A minimal stand-in that reports elements as visible.
class TestIntersectionObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb(
      [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??=
  TestIntersectionObserver as unknown as typeof IntersectionObserver;

// findBy* waits up to 5 s: the client and server suites run in parallel, and a
// file's first render (loading the page modules) can pass 1 s under that load.
configure({ asyncUtilTimeout: 5000 });
