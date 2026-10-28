import { describe, expect, it } from 'vitest';
import { fromDrive, notYetImported, pickedFiles, type LibraryAsset } from '../src/index.ts';

const asset = (id: string, mime: string, createdTime: string, driveFileId?: string): LibraryAsset => ({ id, fileId: `file-${id}`, mime, createdTime, ...(driveFileId ? { driveFileId } : {}) });

describe('picked Drive files', () => {
  it('keeps the media of a Picker answer, once each, in pick order', () => {
    expect(pickedFiles([
      { id: 'a', name: 'cat.png', mimeType: 'image/png', sizeBytes: '1200' },
      { id: 'f', name: 'Photos', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'd', name: 'Notes', mimeType: 'application/vnd.google-apps.document' },
      { id: 'b', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 0 },
      { id: 'a', name: 'cat.png', mimeType: 'image/png' },
      { id: 'c', mimeType: 'audio/mpeg' },
      { name: 'no id', mimeType: 'image/png' },
    ])).toEqual([
      { id: 'a', name: 'cat.png', mimeType: 'image/png', size: 1200 },
      { id: 'b', name: 'clip.mp4', mimeType: 'video/mp4' },
      { id: 'c', name: 'c', mimeType: 'audio/mpeg' },
    ]);
    expect(pickedFiles(undefined)).toEqual([]);
  });

  it('"From Google Drive" lists uploads picked from Drive, newest first, by kind', () => {
    const uploads = [
      asset('1.png', 'image/png', '2026-10-01', 'd1'),
      asset('2.png', 'image/png', '2026-10-03'), // uploaded from the computer
      asset('3.mp4', 'video/mp4', '2026-10-02', 'd3'),
      asset('4.png', 'image/png', '2026-09-01', 'd1'), // same Drive file, older copy
    ];
    expect(fromDrive(uploads).map((a) => a.id)).toEqual(['3.mp4', '1.png']);
    expect(fromDrive(uploads, 'image').map((a) => a.id)).toEqual(['1.png']);
    expect(fromDrive(uploads, 'audio')).toEqual([]);
  });

  it('downloads only files not picked before', () => {
    const uploads = [asset('1.png', 'image/png', '2026-10-01', 'd1')];
    const picked = pickedFiles([{ id: 'd1', name: 'a.png', mimeType: 'image/png' }, { id: 'd2', name: 'b.png', mimeType: 'image/png' }]);
    expect(notYetImported(picked, uploads).map((p) => p.id)).toEqual(['d2']);
    expect(notYetImported(picked, [])).toHaveLength(2);
  });
});
