import type { CapacitorConfig } from '@capacitor/cli';

// Always-live: the native shell loads the deployed web app on each launch, so any
// change pushed to production is live the next time the floor app is opened — no APK
// rebuild/reinstall needed. `webDir: 'dist'` stays as the offline fallback bundle that
// MainActivity shows if the device can't reach the server at launch.
const PRODUCTION_URL = 'https://ll-inventory-antigravity-build-new.vercel.app';

const config: CapacitorConfig = {
  appId: 'za.co.leanliving.floor',
  appName: 'LL Floor',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: PRODUCTION_URL,
    // Only allow navigation within our own app + the auth/data origins it talks to.
    allowNavigation: [
      'll-inventory-antigravity-build-new.vercel.app',
      '*.vercel.app',
      '*.supabase.co',
    ],
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
