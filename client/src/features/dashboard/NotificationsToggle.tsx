import { useState } from 'react';
import { Button } from '../../components/ui';
import { api, post } from '../../lib/api';

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** FR-24: turn on phone/desktop push notifications for this browser. */
export function NotificationsToggle() {
  const supported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'blocked' | 'unavailable'>(
    !supported ? 'unavailable' : Notification.permission === 'denied' ? 'blocked' : 'idle',
  );

  async function enable() {
    setState('busy');
    try {
      const { enabled, publicKey } = await api<{ enabled: boolean; publicKey: string | null }>(
        '/api/push/public-key',
      );
      if (!enabled || !publicKey) return setState('unavailable');
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await post('/api/push/subscribe', sub.toJSON());
      setState('on');
    } catch {
      setState('unavailable');
    }
  }

  if (state === 'unavailable')
    return (
      <p className="text-sm text-gray-500">
        Push notifications are not available in this browser. Install the app from your browser menu
        to get them.
      </p>
    );
  if (state === 'blocked')
    return (
      <p className="text-sm text-gray-500">Notifications are blocked in your browser settings.</p>
    );
  if (state === 'on')
    return <p className="text-sm text-emerald-400">Notifications are on for this device.</p>;
  return (
    <Button variant="secondary" busy={state === 'busy'} onClick={() => void enable()}>
      Turn on notifications
    </Button>
  );
}
