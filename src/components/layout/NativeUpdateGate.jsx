import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
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
 * OPEN — if the version can't be read for any reason, the app is allowed through.
 *
 * After the user installs the new APK, Android relaunches the app on the new version, so
 * the gate clears on its own. We also re-check on app resume, so if the app is still alive
 * when they return it updates without any manual "restart" action.
 */
export default function NativeUpdateGate({ children }) {
  const [blocked, setBlocked] = useState(false);
  const [installedBuild, setInstalledBuild] = useState(null);

  const checkVersion = useCallback(async () => {
    if (!isNativeApp()) return;
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      const build = parseInt(info?.build, 10) || 0;
      setInstalledBuild(build);
      setBlocked(build < REQUIRED_NATIVE_BUILD);
    } catch {
      setBlocked(false); // can't read version → don't lock anyone out
    }
  }, []);

  useEffect(() => {
    checkVersion();
    if (!isNativeApp()) return;
    let remove;
    (async () => {
      const { App } = await import('@capacitor/app');
      const sub = await App.addListener('resume', () => { checkVersion(); });
      remove = () => sub.remove();
    })();
    return () => { remove && remove(); };
  }, [checkVersion]);

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
            A new version of the LL Floor app is ready. Tap below to download it — after it
            installs, the app reopens on the new version automatically.
          </p>
        </div>
        <a
          href={LATEST_APK_URL}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-base px-6 py-4 active:opacity-90"
        >
          <Download className="w-5 h-5" /> Download update
        </a>
        {installedBuild != null && (
          <p className="text-[11px] text-muted-foreground/70">
            Installed build {installedBuild} · required {REQUIRED_NATIVE_BUILD}
          </p>
        )}
      </div>
    </div>
  );
}
