import { defineConfig } from '@panth977/icebase/config';
import { schema } from './icebase/schema.ts';
import { api } from './icebase/api.ts';
import { REGION } from './google.ts';

export default defineConfig({
  name: 'digital-canvas',
  schema,
  api,
  rules: { firestore: 'icebase/rules/firestore.rules' },
  functions: { source: 'functions', runtime: 'nodejs22', region: REGION },
  hosting: { public: '../apps/web/dist', spa: true },
  firebase: {
    projectId: 'digital-canvas-p977',
    // Public web config (safe to ship in the bundle).
    webConfig: {
      apiKey: 'AIzaSyAPFN_2lNqC2mHpJLMU-hC6lHqIP4lroPQ',
      authDomain: 'digital-canvas-p977.firebaseapp.com',
      projectId: 'digital-canvas-p977',
      storageBucket: 'digital-canvas-p977.firebasestorage.app',
      messagingSenderId: '753251746130',
      appId: '1:753251746130:web:5abf59d904592abfa47a8b',
    },
  },
  emulator: { dataDir: '.icebase', port: 4400 },
  environments: { local: { mode: 'emulator' }, prod: { mode: 'firebase' } },
});
