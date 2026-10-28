// The only IceBase setup in the web app.
import { initializeApp } from '@panth977/icebase/app';
import { getAuth } from '@panth977/icebase/auth';
import { callable, getFunctions } from '@panth977/icebase/functions';
import config from '@digital-canvas/backend/config';
import { api } from '@digital-canvas/backend/api';
import { initializeApp as initializeFirebaseApp } from 'firebase/app';
import { indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { isNative } from './native/platform.ts';

export const app = initializeApp(config, 'prod');
// In the native shell (WKWebView / Android WebView) Firebase's default getAuth()
// waits forever on its popup/redirect helper iframe, so onAuthStateChanged never
// fires. Initialise the same Firebase app's Auth first with IndexedDB persistence
// and no popup resolver (we never use Firebase popups: sign-in is a custom token);
// IceBase's getAuth() then picks up this instance.
if (isNative()) initializeAuth(initializeFirebaseApp(config.firebase!.webConfig!, `icebase:${app.name}`), { persistence: indexedDBLocalPersistence });
export const auth = getAuth(app);
const functions = getFunctions(app);

export const googleSignIn = callable(functions, api.googleSignIn);
export const driveToken = callable(functions, api.driveToken);
export const aiSettings = callable(functions, api.aiSettings);
