import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
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
