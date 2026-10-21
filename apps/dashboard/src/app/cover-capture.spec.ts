import { centredSquare, clipUploadType, CLIP_BITS_PER_SECOND, CLIP_LENGTHS, formatBytes, recorderType } from './cover-capture';

describe('cover capture helpers', () => {
  it('crops a frame to its centred square', () => {
    expect(centredSquare(1920, 1080)).toEqual({ sx: 420, sy: 0, side: 1080 });
    expect(centredSquare(720, 1280)).toEqual({ sx: 0, sy: 280, side: 720 });
    expect(centredSquare(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });

  it('uploads a recording as WebM, or MP4 where the browser records only that', () => {
    expect(clipUploadType('video/webm;codecs=vp9')).toBe('video/webm');
    expect(clipUploadType('video/webm')).toBe('video/webm');
    expect(clipUploadType('video/mp4;codecs=avc1')).toBe('video/mp4');
  });

  it('keeps the longest clip under the 300 KB cap at the recording bit rate', () => {
    const longest = Math.max(...CLIP_LENGTHS);
    expect((CLIP_BITS_PER_SECOND / 8) * longest).toBeLessThan(300 * 1024);
  });

  it('formats sizes as people read them', () => {
    expect(formatBytes(200 * 1024)).toBe('200 KB');
    expect(formatBytes(10)).toBe('1 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });

  it('reports that a browser without MediaRecorder cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    try {
      expect(recorderType()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('picks the first recording type the browser supports', () => {
    const original = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = vi.fn() as unknown as typeof original;
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => type === 'video/webm;codecs=vp8' || type === 'video/mp4' });
    try {
      expect(recorderType()).toBe('video/webm;codecs=vp8');
    } finally {
      vi.unstubAllGlobals();
      HTMLCanvasElement.prototype.captureStream = original;
    }
  });
});
