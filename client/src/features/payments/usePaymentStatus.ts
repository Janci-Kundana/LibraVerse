import { useEffect, useState } from 'react';
import type { PaymentStatus, PaymentUpdatedEvent } from '@libraverse/shared';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';

/**
 * Follows one payment live: joins its Socket.io room and, as a fallback,
 * polls every 5 s. `statusUrl` returns an object with `status`.
 */
export function usePaymentStatus(
  paymentId: string | null,
  initial: PaymentStatus,
  statusUrl: string | null,
) {
  const [status, setStatus] = useState<PaymentStatus>(initial);

  useEffect(() => {
    if (!paymentId) return;
    const socket = getSocket();
    const onUpdate = (e: PaymentUpdatedEvent) => {
      if (e.paymentId === paymentId) setStatus(e.status);
    };
    const join = () => socket.emit('payment:join', paymentId);
    socket.on('payment:updated', onUpdate);
    socket.on('connect', join);
    if (socket.connected) join();

    const poll = statusUrl
      ? setInterval(() => {
          api<{ status: PaymentStatus }>(statusUrl)
            .then((p) => setStatus(p.status))
            .catch(() => {});
        }, 5000)
      : undefined;

    return () => {
      socket.off('payment:updated', onUpdate);
      socket.off('connect', join);
      if (poll) clearInterval(poll);
    };
  }, [paymentId, statusUrl]);

  return [status, setStatus] as const;
}

/** Seconds left until `expiresAt`, re-rendering every second. */
export function useCountdown(expiresAt: string | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return secondsUntil(expiresAt);
}

function secondsUntil(iso: string | null) {
  return iso ? Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000)) : 0;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
