import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { REQUIRED_NATIVE_BUILD, LATEST_APK_URL } from '@/config/nativeApp';

// True only inside the Capacitor native shell (Android/iOS), false in any browser.
function isNativeApp() {
  try {
    return !!(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * Blocks the installed native app from running when its APK is older than the minimum
 * required build (REQUIRED_NATIVE_BUILD). Web/browser usage is never affected. Fails
 * OPEN — if the version can't be read for any reason, the app is allowed through rather
 * than locked out.
 */
export default function NativeUpdateGate({ children }) {
  const [blocked, setBlocked] = useState(false);
  const [installedBuild, setInstalledBuild] = useState(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const build = parseInt(info?.build, 10) || 0;
        if (active && build < REQUIRED_NATIVE_BUILD) {
          setInstalledBuild(build);
          setBlocked(true);
        }
      } catch {
        // Can't determine version (e.g. plugin missing) — don't lock anyone out.
      }
    })();
    return () => { active = false; };
  }, []);

  if (!blocked) return children;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background p-6 text-center">
      <div className="max-w-sm flex flex-col items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
          <span className="text-2xl font-black text-primary-foreground">LL</span>
        </div>
        <div>
          <h2 className="text-xl font-bold">Update required</h2>
          <p className="text-sm text-muted-foreground mt-2">
            A new version of the LL Floor app is needed before you can continue. Tap below to
            download and install it.
          </p>
        </div>
        <a
          href={LATEST_APK_URL}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-base px-6 py-4 active:opacity-90"
        >
          <Download className="w-5 h-5" /> Download update
        </a>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline"
        >
          <RefreshCw className="w-3.5 h-3.5" /> I've installed it — restart
        </button>
        {installedBuild != null && (
          <p className="text-[11px] text-muted-foreground/70">
            Installed build {installedBuild} · required {REQUIRED_NATIVE_BUILD}
          </p>
        )}
      </div>
    </div>
  );
}
