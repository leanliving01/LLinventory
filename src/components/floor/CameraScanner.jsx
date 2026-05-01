import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Camera, X, SwitchCamera, RefreshCw, Loader2 } from 'lucide-react';

/**
 * Camera-based barcode scanner using html5-qrcode.
 * Designed for broad device compatibility — tablets, phones, older Android, iOS Safari.
 *
 * Key fixes:
 * - No forced aspectRatio (prevents over-zoom on tablets)
 * - Responsive qrbox (percentage-based, adapts to viewport)
 * - Explicit camera enumeration fallback for devices that reject facingMode constraints
 * - Graceful error recovery with retry
 *
 * Props:
 *  - onScan(code: string) — called once per unique scan
 *  - onClose() — called when user dismisses
 *  - active (boolean) — whether to mount/start the scanner
 */
export default function CameraScanner({ onScan, onClose, active = true }) {
  const scannerRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);
  const mountedRef = useRef(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [useFront, setUseFront] = useState(false);

  // Responsive scan region — 80% of the smaller viewport dimension, capped
  const getQrBox = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const shorter = Math.min(vw, vh);
    const width = Math.min(Math.round(shorter * 0.8), 400);
    const height = Math.min(Math.round(width * 0.45), 180);
    return { width, height };
  }, []);

  /**
   * Try to find a suitable camera ID by enumerating devices.
   * Fallback for devices that fail with facingMode constraints (common on older Android WebViews).
   */
  const getCameraId = useCallback(async (preferFront) => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) return null;

      if (devices.length === 1) return devices[0].id;

      // Heuristic: "back"/"rear"/"environment" keywords = rear camera
      const rearCam = devices.find(d =>
        /back|rear|environment/i.test(d.label)
      );
      const frontCam = devices.find(d =>
        /front|user|face/i.test(d.label)
      );

      if (preferFront) return frontCam?.id || devices[0].id;
      return rearCam?.id || devices[devices.length - 1].id; // last device is often rear on Android
    } catch {
      return null;
    }
  }, []);

  const startScanner = useCallback(async (preferFront) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    // Clean up any existing instance
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    // Ensure the container exists in DOM
    const el = document.getElementById('floor-camera-scanner');
    if (!el) {
      setError('Scanner container not ready');
      setLoading(false);
      return;
    }
    // Clear any leftover DOM from previous instance
    el.innerHTML = '';

    const scanner = new Html5Qrcode('floor-camera-scanner', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ],
      verbose: false,
    });
    scannerRef.current = scanner;

    const config = {
      fps: 10,
      qrbox: getQrBox(),
      disableFlip: false,
    };

    const onSuccess = (decodedText) => {
      const now = Date.now();
      if (decodedText === lastCodeRef.current && now - lastTimeRef.current < 2000) return;
      lastCodeRef.current = decodedText;
      lastTimeRef.current = now;
      onScan(decodedText);
    };

    const onFailure = () => {}; // normal — no barcode in frame

    // Strategy 1: Try facingMode constraint (works on most modern devices)
    const facing = preferFront ? 'user' : 'environment';
    try {
      await scanner.start({ facingMode: facing }, config, onSuccess, onFailure);
      if (mountedRef.current) setLoading(false);
      return;
    } catch (e1) {
      console.warn('[CameraScanner] facingMode failed:', e1);
    }

    // Strategy 2: Enumerate cameras and pick by ID (fallback for WebViews / older browsers)
    try {
      const cameraId = await getCameraId(preferFront);
      if (cameraId) {
        await scanner.start(cameraId, config, onSuccess, onFailure);
        if (mountedRef.current) setLoading(false);
        return;
      }
    } catch (e2) {
      console.warn('[CameraScanner] camera ID fallback failed:', e2);
    }

    // Strategy 3: Try with minimal constraints (last resort)
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 5, qrbox: getQrBox() }, onSuccess, onFailure);
      if (mountedRef.current) setLoading(false);
      return;
    } catch (e3) {
      console.warn('[CameraScanner] minimal fallback failed:', e3);
    }

    // All strategies failed
    if (mountedRef.current) {
      setLoading(false);
      setError('Could not access camera. Please check camera permissions in your browser settings, then tap Retry.');
    }
  }, [onScan, getQrBox, getCameraId]);

  useEffect(() => {
    mountedRef.current = true;
    if (active) {
      const timer = setTimeout(() => startScanner(useFront), 300);
      return () => {
        clearTimeout(timer);
        mountedRef.current = false;
        if (scannerRef.current) {
          scannerRef.current.stop().catch(() => {});
          try { scannerRef.current.clear(); } catch {}
          scannerRef.current = null;
        }
      };
    }
    return () => { mountedRef.current = false; };
  }, [active, useFront, startScanner]);

  const handleFlip = () => setUseFront(prev => !prev);

  const handleRetry = () => {
    setError(null);
    startScanner(useFront);
  };

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10 safe-area-pt">
        <span className="text-white text-sm font-medium">Scan Barcode</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-white h-11 w-11" onClick={handleFlip}>
            <SwitchCamera className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white h-11 w-11" onClick={onClose}>
            <X className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* Scanner viewport */}
      <div className="flex-1 relative overflow-hidden">
        <div id="floor-camera-scanner" className="w-full h-full" />

        {/* Loading overlay */}
        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-white/70">Starting camera…</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white p-6 text-center gap-4">
            <Camera className="w-12 h-12 text-white/40" />
            <p className="text-sm max-w-xs">{error}</p>
            <Button variant="outline" size="lg" onClick={handleRetry} className="gap-2 h-12 px-6">
              <RefreshCw className="w-4 h-4" /> Retry
            </Button>
          </div>
        )}
      </div>

      {/* Guide text */}
      <div className="bg-black/80 px-4 py-4 text-center safe-area-pb">
        <p className="text-white/70 text-xs">Point camera at barcode · Scans automatically</p>
      </div>
    </div>
  );
}