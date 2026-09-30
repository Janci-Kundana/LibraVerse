import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { isStaff, type PaymentUpdatedEvent, type Role } from '@libraverse/shared';
import { env } from '../config/env';
import { runWithTenant } from '../core/tenant';
import { ACCESS_COOKIE, verifyAccess, verifySocketToken } from '../modules/auth/tokens';
import { PaymentModel } from '../modules/payments/model';

// Rooms: user:<id> (auto), library:<id> (staff, auto), payment:<id> (on request,
// only for the payment's member or that library's staff).

interface SocketAuth {
  userId: string;
  role: Role;
  libraryId: string | null;
}

let io: Server | null = null;

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function attachRealtime(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.CLIENT_URL, credentials: true } });

  io.use((socket, next) => {
    try {
      // Same-origin: the access cookie. Cross-origin (e.g. Vercel → Render):
      // a 5-minute token from GET /api/auth/socket-token in handshake.auth.
      const cookie = cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
      const handshakeToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      let claims;
      if (cookie) claims = verifyAccess(cookie);
      else if (typeof handshakeToken === 'string') claims = verifySocketToken(handshakeToken);
      else throw new Error('no token');
      socket.data.auth = {
        userId: claims.sub,
        role: claims.role,
        libraryId: claims.lib,
      } satisfies SocketAuth;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const auth = socket.data.auth as SocketAuth;
    void socket.join(`user:${auth.userId}`);
    if (auth.libraryId && isStaff(auth.role)) void socket.join(`library:${auth.libraryId}`);

    socket.on('payment:join', async (paymentId: unknown, ack?: (res: { ok: boolean }) => void) => {
      const ok = await canWatchPayment(auth, paymentId);
      if (ok) await socket.join(`payment:${String(paymentId)}`);
      ack?.({ ok });
    });
  });

  return io;
}

async function canWatchPayment(auth: SocketAuth, paymentId: unknown): Promise<boolean> {
  if (!auth.libraryId || typeof paymentId !== 'string' || !/^[a-f\d]{24}$/i.test(paymentId))
    return false;
  // Tenant-scoped: a payment from another library is simply not found.
  const payment = await runWithTenant(auth.libraryId, () =>
    PaymentModel.findById(paymentId).select('memberId').lean(),
  );
  if (!payment) return false;
  return String(payment.memberId) === auth.userId || isStaff(auth.role);
}

export function emitPaymentUpdated(libraryId: string, event: PaymentUpdatedEvent) {
  io?.to([`payment:${event.paymentId}`, `user:${event.memberId}`, `library:${libraryId}`]).emit(
    'payment:updated',
    event,
  );
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function closeRealtime() {
  void io?.close();
  io = null;
}
