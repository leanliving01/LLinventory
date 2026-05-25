import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Camera, X, SwitchCamera, RefreshCw, Loader2 } from 'lucide-react';

/**
 * Camera-based barcode scanner.
 *
 * When running inside the native Android app (Capacitor), uses ML Kit via
 * @capacitor-mlkit/barcode-scanning for reliable native camera access.
 *
 * Falls back to html5-qrcode when running in a browser.
 *
 * Props:
 *  - onScan(code: string) — called once per unique scan
 *  - onClose() — called when user dismisses
 *  - active (boolean) — whether to mount/start the scanner
 */

function isNativePlatform() {
  try {
    return !!(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

// ─── Native (Capacitor ML Kit) scanner ────────────────────────────────────────

function NativeBarcodeScanner({ onScan, onClose }) {
  const [status, setStatus] = useState('requesting'); // requesting | scanning | error
  const [error, setError] = useState(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function startNativeScan() {
      try {
        const { BarcodeScanner, LensFacing } = await import('@capacitor-mlkit/barcode-scanning');

        // Request camera permission
        const { camera } = await BarcodeScanner.requestPermissions();
        if (camera !== 'granted' && camera !== 'limited') {
          setError('Camera permission denied. Go to Settings → Apps → LL Floor → Permissions → Camera → Allow.');
          setStatus('error');
          return;
        }

        if (cancelled) return;
        setStatus('scanning');
        scanningRef.current = true;

        // Start scanning — this opens the native camera view
        const listener = await BarcodeScanner.addListener('barcodeScanned', (event) => {
          if (cancelled) return;
          const code = event.barcode?.rawValue || event.barcode?.displayValue;
          if (code) {
            onScan(code);
          }
        });

        await BarcodeScanner.startScan({ lensFacing: LensFacing.Back });

        return () => {
          listener.remove();
        };
      } catch (err) {
        if (!cancelled) {
          setError('Failed to start scanner: ' + (err?.message || String(err)));
          setStatus('error');
        }
      }
    }

    const cleanup = startNativeScan();

    return () => {
      cancelled = true;
      scanningRef.current = false;
      import('@capacitor-mlkit/barcode-scanning').then(({ BarcodeScanner }) => {
        BarcodeScanner.stopScan().catch(() => {});
        cleanup.then(fn => fn?.()).catch(() => {});
      });
    };
  }, [onScan]);

  const handleRetry = () => {
    setStatus('requesting');
    setError(null);
  };

  if (status === 'scanning') {
    // Native scanner overlays the full screen — just show a close button
    return (
      <div className="fixed inset-0 z-50 flex flex-col pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 bg-black/60 pointer-events-auto safe-area-pt">
          <span className="text-white text-sm font-medium">Scan Barcode</span>
          <Button variant="ghost" size="icon" className="text-white h-11 w-11" onClick={onClose}>
            <X className="w-6 h-6" />
          </Button>
        </div>
        <div className="flex-1" />
        <div className="bg-black/60 px-4 py-4 text-center pointer-events-auto safe-area-pb">
          <p className="text-white/70 text-xs">Point camera at barcode · Scans automatically</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-6 text-center gap-4">
        <Camera className="w-12 h-12 text-white/40" />
        <p className="text-white text-sm max-w-xs">{error}</p>
        <Button variant="outline" size="lg" onClick={handleRetry} className="gap-2 h-12 px-6">
          <RefreshCw className="w-4 h-4" /> Retry
        </Button>
        <Button variant="ghost" className="text-white/70" onClick={onClose}>Cancel</Button>
      </div>
    );
  }

  // requesting permissions
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-white" />
      <p className="text-white/70 text-sm">Requesting camera access…</p>
      <Button variant="ghost" className="text-white/70 mt-4" onClick={onClose}>Cancel</Button>
    </div>
  );
}

// ─── Web (html5-qrcode) scanner ───────────────────────────────────────────────

function WebBarcodeScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);
  const mountedRef = useRef(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [useFront, setUseFront] = useState(false);

  const getQrBox = useCallback(() => {
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    const width = Math.min(Math.round(shorter * 0.8), 400);
    const height = Math.min(Math.round(width * 0.45), 180);
    return { width, height };
  }, []);

  const getCameraId = useCallback(async (preferFront) => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices?.length) return null;
      if (devices.length === 1) return devices[0].id;
      const rearCam = devices.find(d => /back|rear|environment/i.test(d.label));
      const frontCam = devices.find(d => /front|user|face/i.test(d.label));
      return preferFront ? (frontCam?.id || devices[0].id) : (rearCam?.id || devices[devices.length - 1].id);
    } catch { return null; }
  }, []);

  const startScanner = useCallback(async (preferFront) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    const el = document.getElementById('floor-camera-scanner');
    if (!el) { setError('Scanner container not ready'); setLoading(false); return; }
    el.innerHTML = '';
    const scanner = new Html5Qrcode('floor-camera-scanner', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
      ],
      verbose: false,
    });
    scannerRef.current = scanner;
    const config = { fps: 10, qrbox: getQrBox(), disableFlip: false };
    const onSuccess = (code) => {
      const now = Date.now();
      if (code === lastCodeRef.current && now - lastTimeRef.current < 2000) return;
      lastCodeRef.current = code; lastTimeRef.current = now;
      onScan(code);
    };
    // Try facingMode first, then camera ID, then minimal fallback
    for (const attempt of [
      () => scanner.start({ facingMode: preferFront ? 'user' : 'environment' }, config, onSuccess, () => {}),
      async () => { const id = await getCameraId(preferFront); if (id) return scanner.start(id, config, onSuccess, () => {}); throw new Error('no camera id'); },
      () => scanner.start({ facingMode: 'environment' }, { fps: 5, qrbox: getQrBox() }, onSuccess, () => {}),
    ]) {
      try { await attempt(); if (mountedRef.current) setLoading(false); return; } catch { /* try next */ }
    }
    if (mountedRef.current) { setLoading(false); setError('Could not access camera. Check camera permissions then tap Retry.'); }
  }, [onScan, getQrBox, getCameraId]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = setTimeout(() => startScanner(useFront), 300);
    return () => {
      clearTimeout(timer);
      mountedRef.current = false;
      if (scannerRef.current) { scannerRef.current.stop().catch(() => {}); try { scannerRef.current.clear(); } catch {} scannerRef.current = null; }
    };
  }, [useFront, startScanner]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10 safe-area-pt">
        <span className="text-white text-sm font-medium">Scan Barcode</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-white h-11 w-11" onClick={() => setUseFront(v => !v)}>
            <SwitchCamera className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white h-11 w-11" onClick={onClose}>
            <X className="w-6 h-6" />
          </Button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <div id="floor-camera-scanner" className="w-full h-full" />
        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-white/70">Starting camera…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white p-6 text-center gap-4">
            <Camera className="w-12 h-12 text-white/40" />
            <p className="text-sm max-w-xs">{error}</p>
            <Button variant="outline" size="lg" onClick={() => { setError(null); startScanner(useFront); }} className="gap-2 h-12 px-6">
              <RefreshCw className="w-4 h-4" /> Retry
            </Button>
          </div>
        )}
      </div>
      <div className="bg-black/80 px-4 py-4 text-center safe-area-pb">
        <p className="text-white/70 text-xs">Point camera at barcode · Scans automatically</p>
      </div>
    </div>
  );
}

// ─── Unified export ────────────────────────────────────────────────────────────

export default function CameraScanner({ onScan, onClose, active = true }) {
  if (!active) return null;
  if (isNativePlatform()) return <NativeBarcodeScanner onScan={onScan} onClose={onClose} />;
  return <WebBarcodeScanner onScan={onScan} onClose={onClose} />;
}
