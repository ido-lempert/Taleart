import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectMedia, ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { mediaChoiceName } from './tale-media';
import { TaleStudioPage } from './tale-studio';

const url = `${API_BASE}/tales/t1/document`;
const mediaUrl = `${API_BASE}/projects/p1/media`;
const tale = {
  id: 't1',
  taleGroupId: 'g1',
  projectId: 'p1',
  title: 'Beach',
  position: 0,
  status: 'live',
  storedStatus: 'live',
  startsAt: null,
  endsAt: null,
  media: null,
};
const group = { id: 'g1', name: 'Summer', projectId: 'p1', tales: [tale] } as unknown as ZoneTaleGroup;
const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const VIDEO = 'media/0b7c9d4e-1111-4222-8333-944455556667.mp4';
const media = (key: string, kind: 'image' | 'video', extra: Partial<ProjectMedia> = {}): ProjectMedia => ({
  key,
  kind,
  contentType: kind === 'image' ? 'image/png' : 'video/mp4',
  url: `/api/v1/projects/p1/media/file?key=${encodeURIComponent(key)}`,
  source: 'upload',
  createdAt: '2026-10-22T10:00:00.000Z',
  sizeBytes: 100,
  ...extra,
});
const LIBRARY = [media(IMAGE, 'image'), media(VIDEO, 'video')];
const empty: TaleDocument = { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

const WAIT_FOR_TEST = { debounceMs: 3_600_000, maxWaitMs: 3_600_000, retryDelaysMs: [3_600_000] };

describe('Tale Studio images and video (epic Tale Studio R5)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  async function open(document: TaleDocument | null = null, revision = 0): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document, revision, published: { document: null, revision: 0 } });
    http
      .expectOne(`${API_BASE}/projects/p1/theme`)
      .flush({ projectId: 'p1', theme: {}, resolved: { ...DEFAULT_THEME, fontFamily: null } });
    http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const live = () => root.querySelector('[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();

  // Opens the picker from `button` and picks the item named `name` from the project's media.
  async function pickFrom(button: string, name: string, library: ProjectMedia[] = LIBRARY): Promise<void> {
    q<HTMLButtonElement>(button).click();
    await settle(fixture);
    http.expectOne(mediaUrl).flush(library);
    await settle(fixture);
    const choice = [...root.querySelectorAll<HTMLButtonElement>('.media-choice')].find(
      (b) => b.getAttribute('aria-label') === name,
    );
    if (!choice) throw new Error(`No choice ${name}`);
    choice.click();
    await settle(fixture);
  }

  async function saveNow(revision: number): Promise<TaleDocument> {
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    req.flush({ document: body.document, revision });
    expect(await leaving).toBe(true);
    await settle(fixture);
    return body.document;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('names media in the picker by where it comes from', () => {
    expect(mediaChoiceName(media(IMAGE, 'image'))).toBe('Uploaded image, Oct 22, 2026');
    expect(mediaChoiceName(media(VIDEO, 'video', { source: 'tale', taleTitle: 'Intro' }))).toBe(
      'The video of the tale “Intro”',
    );
    expect(mediaChoiceName(media(IMAGE, 'image', { source: 'document' }))).toBe('An image used in a tale');
  });

  it('adds an image from the project media, which needs alt text, and saves it by its key', async () => {
    await open();
    await pickFrom('#studio-add-image', 'Use Uploaded image, Oct 22, 2026');
    const el = q<HTMLButtonElement>('button.el');
    expect(el.getAttribute('aria-label')).toBe('Image: Image 1');
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/v1/projects/p1/media/file?key=${encodeURIComponent(IMAGE)}`);
    expect(img.style.objectFit).toBe('cover');
    expect(root.querySelector('.layer__state')?.textContent).toContain('Needs alt text');
    expect(live()).toContain('Image added');
    // The picker lists images only.
    const alt = q<HTMLTextAreaElement>(`#media-alt-${doc().elements[0].id}`);
    expect(alt.getAttribute('aria-invalid')).toBe('true');
    alt.value = 'A red bicycle';
    alt.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(root.querySelector('.layer__state')?.textContent).not.toContain('Needs alt text');
    expect(q<HTMLButtonElement>('button.el').getAttribute('aria-label')).toBe('Image: A red bicycle');
    const saved = await saveNow(1);
    expect(saved.elements[0]).toEqual({
      id: expect.any(String),
      type: 'image',
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { label: 'A red bicycle' },
      props: { mediaKey: IMAGE, fit: 'cover' },
    });
  });

  it('holds one video: a second is refused, the duration gives way to the video, and it is not duplicated', async () => {
    await open();
    await pickFrom('#studio-add-video', 'Use Uploaded video, Oct 22, 2026');
    const video = q<HTMLVideoElement>('button.el video');
    expect(video.muted).toBe(true);
    expect(video.getAttribute('aria-hidden')).toBe('true');
    const add = q<HTMLButtonElement>('#studio-add-video');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(q<HTMLElement>('#studio-video-hint').textContent).toContain('one video');
    add.click();
    await settle(fixture);
    http.expectNone(mediaUrl);
    expect(live()).toContain('A tale holds one video');
    const duration = q<HTMLInputElement>('#studio-duration');
    expect(duration.readOnly).toBe(true);
    expect(q<HTMLElement>('#studio-duration-hint').textContent).toContain("video's length");
    const el = q<HTMLButtonElement>('button.el');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(doc().elements).toHaveLength(1);
    expect(live()).toContain('cannot be duplicated');
  });

  it('uploads a file from the picker and adds it; a refused type stays on the field', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-image').click();
    await settle(fixture);
    http.expectOne(mediaUrl).flush([]);
    await settle(fixture);
    expect(root.textContent).toContain('No images in this project yet');
    const input = q<HTMLInputElement>('#media-upload');
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    const pick = (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    pick(new File(['x'], 'evil.svg', { type: 'image/svg+xml' }));
    await settle(fixture);
    expect(root.querySelector('app-tale-media-picker [role=alert]')?.textContent).toContain(
      'Choose a JPEG, PNG, WebP or GIF image',
    );
    http.expectNone(mediaUrl);
    pick(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }));
    await settle(fixture);
    const upload = http.expectOne((r) => r.url === mediaUrl && r.method === 'POST');
    expect(upload.request.headers.get('Content-Type')).toBe('image/png');
    upload.flush(media(IMAGE, 'image'));
    await settle(fixture);
    expect(doc().elements[0]).toMatchObject({ type: 'image', props: { mediaKey: IMAGE } });
    expect(root.querySelector('app-tale-media-picker')).toBeNull();
  });

  it('refuses a file over the size limit before uploading it', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-image').click();
    await settle(fixture);
    http.expectOne(mediaUrl).flush([]);
    await settle(fixture);
    const input = q<HTMLInputElement>('#media-upload');
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    Object.defineProperty(input, 'files', { value: [big] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    http.expectNone((r) => r.method === 'POST');
    expect(root.querySelector('app-tale-media-picker [role=alert]')?.textContent).toContain(
      'The file is larger than 10 MB',
    );
  });

  it('warns about a video longer than 15 s: only its first 15 s will play', async () => {
    const element = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'video' as const,
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { label: 'Runway' },
      props: { mediaKey: VIDEO, fit: 'cover' as const },
    };
    await open({ ...empty, elements: [element] }, 1);
    const video = q<HTMLVideoElement>('button.el video');
    Object.defineProperty(video, 'duration', { value: 22.5 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await settle(fixture);
    expect(root.querySelector('.layer__state')?.textContent).toContain('Longer than 15 s');
    q<HTMLButtonElement>('button.el').click();
    await settle(fixture);
    expect(root.querySelector('app-tale-media-style [role=status]')?.textContent).toContain(
      'This video is 22.5 s long: only the first 15 s will play.',
    );
  });

  it('selects the element the refused draft names, even after the layers moved meanwhile', async () => {
    const image = (n: number, a11y: Record<string, unknown>) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      type: 'image' as const,
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y,
      props: { mediaKey: IMAGE, fit: 'cover' as const },
    });
    await open({ ...empty, elements: [image(1, {}), image(2, { label: 'Cat' })] }, 1);
    q<HTMLButtonElement>('#studio-publish').click();
    await settle(fixture);
    const publish = http.expectOne(`${url}/publish`);
    // While the publish is on its way, the first image is sent to the front.
    const first = root.querySelectorAll<HTMLButtonElement>('button.el')[0];
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true, bubbles: true }));
    await settle(fixture);
    expect(doc().elements[1].id).toBe(image(1, {}).id);
    publish.flush(
      {
        error: {
          code: 'invalid_tale_document',
          message: '"Image 1" needs alt text.',
          pointer: '/elements/0/a11y/label',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    const selected = root.querySelector('button.el[aria-pressed=true]');
    expect(selected?.id).toBe(`studio-el-${image(1, {}).id}`);
    // The reorder is kept and saves after the publish.
    expect((await saveNow(2)).elements[1].id).toBe(image(1, {}).id);
  });

  it('shows an upload refused by the server in the picker', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-video').click();
    await settle(fixture);
    http.expectOne(mediaUrl).flush([]);
    await settle(fixture);
    const input = q<HTMLInputElement>('#media-upload');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    http
      .expectOne((r) => r.url === mediaUrl && r.method === 'POST')
      .flush(
        { error: { code: 'unsupported_media_type', message: 'The file is not a valid video/mp4 file' } },
        { status: 415, statusText: 'Unsupported' },
      );
    await settle(fixture);
    expect(root.querySelector('app-tale-media-picker [role=alert]')?.textContent).toContain(
      'The file is not a valid video/mp4 file',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(doc().elements).toHaveLength(0);
  });

  it('resizes, rotates, rounds and fades an image and sets its fit, each a step', async () => {
    const element = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'image' as const,
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { label: 'Cat' },
      props: { mediaKey: IMAGE, fit: 'cover' as const },
    };
    await open({ ...empty, elements: [element] }, 1);
    q<HTMLButtonElement>('button.el').click();
    await settle(fixture);
    expect(q<HTMLElement>('legend').textContent).toContain('Selected image');
    const set = async (id: string, value: string) => {
      const field = q<HTMLInputElement | HTMLSelectElement>(id);
      field.value = value;
      field.dispatchEvent(new Event('change'));
      await settle(fixture);
    };
    await set('#studio-w', '50');
    expect(live()).toBe('Image width set to 50%');
    await set('#studio-h', '150');
    expect(q<HTMLInputElement>('#studio-h').value).toBe('100');
    await set('#studio-rotation', '-30');
    expect(live()).toBe('Image rotated to -30°');
    await set('#studio-rotation', '400');
    expect(q<HTMLInputElement>('#studio-rotation').value).toBe('180');
    await set(`#media-fit-${element.id}`, 'contain');
    await set(`#media-radius-${element.id}`, '5');
    await set(`#media-opacity-${element.id}`, '40');
    const el = q<HTMLButtonElement>('button.el');
    expect(el.style.transform).toBe('rotate(180deg)');
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.borderRadius).toBe('5cqh');
    expect(img.style.opacity).toBe('0.4');
    const saved = await saveNow(2);
    expect(saved.elements[0].box).toEqual({ x: 0.1, y: 0, w: 0.5, h: 1, rotation: 180 });
    expect(saved.elements[0].props).toEqual({ mediaKey: IMAGE, fit: 'contain', radius: 0.05, opacity: 0.4 });
  });

  it('marks an image decorative, which keeps its alt text field disabled', async () => {
    await open();
    await pickFrom('#studio-add-image', 'Use Uploaded image, Oct 22, 2026');
    const id = doc().elements[0].id;
    const box = root.querySelector<HTMLInputElement>('app-tale-media-style input[type=checkbox]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(doc().elements[0].a11y).toEqual({ decorative: true });
    expect(q<HTMLTextAreaElement>(`#media-alt-${id}`).disabled).toBe(true);
    expect(root.querySelector('.layer__state')?.textContent).not.toContain('Needs alt text');
    await saveNow(1);
  });

  it('sets the duration from 3 to 15 seconds', async () => {
    await open(empty, 1);
    const duration = q<HTMLInputElement>('#studio-duration');
    expect(duration.value).toBe('7');
    duration.value = '5';
    duration.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(doc().durationMs).toBe(5000);
    duration.value = '30';
    duration.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(duration.value).toBe('15');
    expect(doc().durationMs).toBe(15000);
    expect(live()).toBe('Duration set to 15 seconds, as far as it goes');
    duration.value = 'x';
    duration.dispatchEvent(new Event('change'));
    expect(duration.value).toBe('15');
    expect((await saveNow(2)).durationMs).toBe(15000);
  });

  it('sets a background image with a fit over the band colour, and removes it', async () => {
    await open(empty, 1);
    await pickFrom('#studio-bg-media', 'Use Uploaded image, Oct 22, 2026');
    expect(doc().canvas.background).toEqual({ type: 'media', mediaKey: IMAGE, fit: 'cover', color: '#000000' });
    const bg = root.querySelector('.canvas > img.canvas__media') as HTMLImageElement;
    expect(bg.getAttribute('src')).toContain(encodeURIComponent(IMAGE));
    expect(bg.alt).toBe('');
    const fit = q<HTMLSelectElement>('#studio-bg-fit');
    fit.value = 'contain';
    fit.dispatchEvent(new Event('change'));
    await settle(fixture);
    // The colour is the band colour now, and keeps the image.
    const hex = q<HTMLInputElement>('#studio-bg-hex');
    hex.value = '#112233';
    hex.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(doc().canvas.background).toEqual({ type: 'media', mediaKey: IMAGE, fit: 'contain', color: '#112233' });
    q<HTMLButtonElement>('#studio-bg-media-remove').click();
    await settle(fixture);
    expect(doc().canvas.background).toEqual({ type: 'color', color: '#112233' });
    await saveNow(2);
  });

  it('shows a publish refused for missing alt text, naming the image, and selects it', async () => {
    const element = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'image' as const,
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { mediaKey: IMAGE, fit: 'cover' as const },
    };
    await open({ ...empty, elements: [element] }, 1);
    q<HTMLButtonElement>('#studio-publish').click();
    await settle(fixture);
    const message = '"Image 1" needs alt text, or must be marked decorative, before the tale is published.';
    http
      .expectOne(`${url}/publish`)
      .flush(
        { error: { code: 'invalid_tale_document', message, pointer: '/elements/0/a11y/label' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    expect(root.querySelector('.studio-alert[role=alert]')?.textContent).toContain(message);
    const el = q<HTMLButtonElement>('button.el');
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(q<HTMLElement>('legend').textContent).toContain('Selected image');
  });
});
