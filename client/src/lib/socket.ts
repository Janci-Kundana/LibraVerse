import { io, type Socket } from 'socket.io-client';

// One authenticated connection per tab. In development the socket is same
// origin (Vite proxy) and the httpOnly access cookie authenticates it. In
// production the site may be served from a different host than the API (Vercel
// cannot proxy WebSockets), so VITE_SOCKET_URL points at the API and the
// handshake carries a 5-minute token fetched through the same-origin /api.
let socket: Socket | null = null;

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL as string | undefined;

export function getSocket(): Socket {
  socket ??= SOCKET_URL
    ? io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        auth: (cb) => {
          fetch('/api/auth/socket-token', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : { token: null }))
            .then((d: { token: string | null }) => cb({ token: d.token }))
            .catch(() => cb({ token: null }));
        },
      })
    : io('/', { withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
