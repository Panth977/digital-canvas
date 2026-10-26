// The only IceBase setup in the web app.
import { initializeApp } from '@panth977/icebase/app';
import { getAuth } from '@panth977/icebase/auth';
import { callable, getFunctions } from '@panth977/icebase/functions';
import config from '@digital-canvas/backend/config';
import { api } from '@digital-canvas/backend/api';

export const app = initializeApp(config, 'prod');
export const auth = getAuth(app);
const functions = getFunctions(app);

export const googleSignIn = callable(functions, api.googleSignIn);
export const driveToken = callable(functions, api.driveToken);
