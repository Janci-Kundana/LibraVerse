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
