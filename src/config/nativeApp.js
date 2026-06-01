// Native app version gate.
//
// The floor app loads this web code from the server (always latest), so these two
// values are how the *always-live* web app tells an *installed APK* whether it is too
// old to keep running. 99% of changes are web-only and need none of this. But when a
// NATIVE change ships (new Capacitor plugin, MainActivity/permissions/config change),
// a fresh APK must be installed — and that can't happen over-the-air.
//
// To force an update after a native change:
//   1. Bump `versionCode` in android/app/build.gradle (e.g. 1 -> 2).
//   2. Build the new APK and upload it to the Supabase bucket, overwriting the file at
//      LATEST_APK_URL (keep the filename stable so this URL never changes).
//   3. Bump REQUIRED_NATIVE_BUILD below to match the new versionCode and deploy the web app.
// Next launch, any device on an older APK is blocked with a "Download update" screen.

// Minimum Android versionCode allowed to run. Installed APKs below this are forced to update.
export const REQUIRED_NATIVE_BUILD = 1;

// Stable public link to the latest APK (Supabase Storage, public bucket "app-releases").
// Overwrite the file in place on each release so this URL stays constant.
export const LATEST_APK_URL =
  'https://cpzkmzcohujpybcocipe.supabase.co/storage/v1/object/public/app-releases/ll-floor-latest.apk';
