/** Public Google OAuth settings shared by the web app and the functions. */
export const GOOGLE_CLIENT_ID = '753251746130-766vmq0fhocia6s45c9e1aqfqeo708k1.apps.googleusercontent.com';

/** Access to only the files this app creates or the user opens with it (Picker, "Open with"). */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/**
 * Lists Digital Canvas in the user's Drive under "Open with" and "New" (Drive UI integration,
 * Cloud console › Google Drive API › Drive UI integration). Grants no access to any file.
 */
export const DRIVE_INSTALL_SCOPE = 'https://www.googleapis.com/auth/drive.install';

/** Sign-in identity, drive.file, and drive.install (so Drive offers "Open with → Digital Canvas"). */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE, DRIVE_INSTALL_SCOPE];

export const REGION = 'asia-south1';

/** Project number of digital-canvas-p977: Google Picker's App ID (picked files are granted to this app). */
export const GOOGLE_APP_ID = '753251746130';

/**
 * Browser API key for Google Picker (Uploads → Google Drive). Not a secret:
 * restricted to the Picker API and to the referrers https://digital-canvas-p977.web.app/*,
 * https://digital-canvas-p977.firebaseapp.com/* and http://localhost:*
 * (key "Digital Canvas Picker (browser)" in the Cloud console).
 */
export const PICKER_API_KEY = 'AIzaSyB-9H6XW6rs6RAFgaLvHNee8OnCwkhCRgw';

/**
 * Browser API key for reading designs and assets shared "anyone with the link" (Share, the public
 * /view page): `files.get?alt=media&key=`. Defaults to the Picker key; that key must also allow the
 * Google Drive API (Cloud console › Credentials › API restrictions). As of 2026-10-29 it is restricted
 * to the Picker API only, so Drive answers 403 until "Google Drive API" is added there.
 * Override with `VITE_DRIVE_API_KEY`.
 */
export const DRIVE_API_KEY = PICKER_API_KEY;
