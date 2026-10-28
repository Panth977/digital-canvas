/** Public Google OAuth settings shared by the web app and the functions. */
export const GOOGLE_CLIENT_ID = '753251746130-766vmq0fhocia6s45c9e1aqfqeo708k1.apps.googleusercontent.com';

/** Sign-in identity plus access to only the files this app creates or the user opens with it. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

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
