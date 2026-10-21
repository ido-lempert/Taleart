import {
  centredSquare,
  clipUploadType,
  CLIP_BITS_PER_SECOND,
  CLIP_LENGTHS,
  formatBytes,
  recordClip,
  recorderType,
  seekTo,
} from './cover-capture';

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

describe('seekTo', () => {
  afterEach(() => vi.useRealTimers());

  function video(): HTMLVideoElement {
    const el = document.createElement('video');
    Object.defineProperty(el, 'readyState', { value: 4, configurable: true });
    return el;
  }

  it('resolves once the video has moved', async () => {
    const el = video();
    const done = seekTo(el, 2);
    el.dispatchEvent(new Event('seeked'));
    await expect(done).resolves.toBeUndefined();
  });

  it.each(['emptied', 'abort', 'error'])('rejects when the video fires %s', async (type) => {
    const el = video();
    const done = seekTo(el, 2);
    el.dispatchEvent(new Event(type));
    await expect(done).rejects.toThrow('The video could not be read.');
  });

  it('rejects when the seek does not finish in time', async () => {
    vi.useFakeTimers();
    const done = seekTo(video(), 2, 1000);
    const check = expect(done).rejects.toThrow('The video could not be read.');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
  });
});

describe('recordClip', () => {
  const track = { stop: vi.fn() };
  let recorders: FakeRecorder[] = [];

  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'video/webm';
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start = vi.fn(() => {
      this.state = 'recording';
    });
    stop = vi.fn(() => {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array(5)]) });
      this.onstop?.();
    });
    constructor() {
      recorders.push(this);
    }
  }

  const original = {
    captureStream: HTMLCanvasElement.prototype.captureStream,
    getContext: HTMLCanvasElement.prototype.getContext,
  };

  function video(): HTMLVideoElement {
    const el = document.createElement('video');
    Object.defineProperties(el, {
      readyState: { value: 4 },
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
      play: { value: vi.fn(() => Promise.resolve()), configurable: true },
      pause: { value: vi.fn() },
    });
    return el;
  }

  beforeEach(() => {
    recorders = [];
    track.stop.mockClear();
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    // Animation frames never come, as in a hidden tab.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({ getTracks: () => [track] })) as never;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    HTMLCanvasElement.prototype.captureStream = original.captureStream;
    HTMLCanvasElement.prototype.getContext = original.getContext;
  });

  it('ends on the timer when animation frames stop, and returns the recording', async () => {
    vi.useFakeTimers();
    const done = recordClip(video(), 0, 2);
    await vi.advanceTimersByTimeAsync(7000);
    const blob = await done;
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBe(5);
    expect(recorders[0].start).toHaveBeenCalledTimes(1);
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the recorder and its tracks and rejects when aborted', async () => {
    const abort = new AbortController();
    const done = recordClip(video(), 0, 2, abort.signal);
    const check = expect(done).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve));
    abort.abort();
    await check;
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('does not start when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(recordClip(video(), 0, 2, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(recorders).toEqual([]);
  });

  it('stops only an active recorder when starting fails, and still stops the tracks', async () => {
    const el = video();
    Object.defineProperty(el, 'play', { value: vi.fn(() => Promise.reject(new Error('play refused'))) });
    await expect(recordClip(el, 0, 2)).rejects.toThrow('play refused');
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });
});
