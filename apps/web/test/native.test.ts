import { describe, expect, it } from 'vitest';
import { nativeAuthUrl, parseAppAuthUrl } from '../src/lib/native/oauth.ts';
import { isFunctionsUrl } from '../src/lib/native/http.ts';
import { galleryKind } from '../src/lib/native/files.ts';
import { GOOGLE_CLIENT_ID } from '@digital-canvas/backend/google';

describe('native sign-in', () => {
  it('asks Google for an offline code for the hosted callback', () => {
    const u = new URL(nativeAuthUrl({ consent: true, hint: 'a@b.c' }, 'dcapp.1'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = Object.fromEntries(u.searchParams);
    expect(q).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: 'https://digital-canvas-p977.web.app/auth/callback',
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      login_hint: 'a@b.c',
      state: 'dcapp.1',
    });
    expect(q.scope!.split(' ')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(q.scope!.split(' ')).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(new URL(nativeAuthUrl({}, 's')).searchParams.get('prompt')).toBe('select_account');
  });

  it('reads the bounced app URL', () => {
    expect(parseAppAuthUrl('com.panth977.digitalcanvas://auth?state=dcapp.9&code=4%2Fxy')).toEqual({ state: 'dcapp.9', code: '4/xy', error: undefined });
    expect(parseAppAuthUrl('com.panth977.digitalcanvas://auth?state=dcapp.9&error=access_denied')?.error).toBe('access_denied');
    expect(parseAppAuthUrl('com.panth977.digitalcanvas://auth?state=other&code=1')).toBeNull();
    expect(parseAppAuthUrl('https://evil.example/auth?state=dcapp.9&code=1')).toBeNull();
  });
});

describe('native fetch routing', () => {
  it('sends only Cloud Functions through native HTTP', () => {
    expect(isFunctionsUrl('https://asia-south1-digital-canvas-p977.cloudfunctions.net/googleSignIn')).toBe(true);
    expect(isFunctionsUrl('https://drivetoken-abc123-el.a.run.app')).toBe(true);
    expect(isFunctionsUrl('https://www.googleapis.com/upload/drive/v3/files')).toBe(false);
    expect(isFunctionsUrl('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken')).toBe(false);
    expect(isFunctionsUrl('/relative')).toBe(false);
  });
});

describe('photo picker', () => {
  it('uses the photo library only for image/video lists', () => {
    expect(galleryKind('image/png,image/jpeg,image/webp,image/gif')).toBe('photo');
    expect(galleryKind('image/png,video/mp4')).toBe('all');
    expect(galleryKind('video/mp4,.mov')).toBe('video');
    expect(galleryKind('image/png,audio/mpeg')).toBeNull();
    expect(galleryKind('.dcanvas,application/vnd.digital-canvas+zip')).toBeNull();
    expect(galleryKind('')).toBeNull();
  });
});
