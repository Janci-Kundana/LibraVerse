import { io, type Socket } from 'socket.io-client';

// One authenticated connection per tab (the httpOnly access cookie rides along
// with the handshake). Same origin in dev via the Vite proxy.
let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= io(import.meta.env.VITE_API_URL ?? '/', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
