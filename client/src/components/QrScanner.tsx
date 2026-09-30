import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from './ui';

/**
 * Scans a QR with the device camera (html5-qrcode, loaded on demand), or
 * accepts the code typed/pasted, e.g. from a USB scanner that acts as a keyboard.
 */
export function QrScanner({
  label,
  onScan,
  disabled,
}: {
  label: string;
  onScan: (code: string) => void;
  disabled?: boolean;
}) {
  const regionId = `qr-${useId().replace(/:/g, '')}`;
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [typed, setTyped] = useState('');
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    void (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        const s = new Html5Qrcode(regionId);
        scanner = s;
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => {
            setCamera(false);
            onScanRef.current(text);
          },
          () => {},
        );
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Camera unavailable');
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      void scanner
        ?.stop()
        .then(() => scanner?.clear())
        .catch(() => {});
    };
  }, [camera, regionId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    onScan(typed.trim());
    setTyped('');
  }

  return (
    <div className="space-y-3">
      <div
        id={regionId}
        className={camera ? 'overflow-hidden rounded-lg border border-gray-700' : 'hidden'}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setCameraError('');
            setCamera(!camera);
          }}
        >
          {camera ? 'Stop camera' : 'Scan with camera'}
        </Button>
      </div>
      {cameraError && (
        <p className="text-sm text-yellow-300">Camera: {cameraError}. Type the code instead.</p>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">{label}</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled}
            placeholder={label}
            aria-label={label}
            className="block w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 outline-none transition focus:border-brand-400/70 focus:ring-4 focus:ring-brand-500/15 font-mono text-sm"
          />
        </label>
        <Button type="submit" disabled={disabled || !typed.trim()}>
          Go
        </Button>
      </form>
    </div>
  );
}
