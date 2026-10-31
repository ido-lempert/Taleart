import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectFont } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { FontsPage } from './fonts';

const listUrl = `${API_BASE}/projects/p1/fonts`;

const font = (over: Partial<ProjectFont> = {}): ProjectFont => ({
  id: '0f0e0d0c-0000-4000-8000-00000000000a',
  projectId: 'p1',
  family: 'Brand Sans',
  weight: 700,
  style: 'italic',
  fallback: 'serif',
  sizeBytes: 40 * 1024,
  licenceConfirmedBy: { id: 'u1', name: 'Ada Admin' },
  licenceConfirmedAt: '2026-10-22T10:00:00.000Z',
  inUse: true,
  ...over,
});

// A file with a WOFF2 header whose total length is its size.
function woff2File(size = 64, name = 'brand.woff2'): File {
  const data = new Uint8Array(size);
  data.set([0x77, 0x4f, 0x46, 0x32]);
  data[8] = (size >>> 24) & 0xff;
  data[9] = (size >>> 16) & 0xff;
  data[10] = (size >>> 8) & 0xff;
  data[11] = size & 0xff;
  return new File([data], name);
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('FontsPage (story 7.17)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<FontsPage>;
  let root: HTMLElement;
  const field = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;

  async function open(fonts: ProjectFont[] = []): Promise<void> {
    fixture = TestBed.createComponent(FontsPage);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.detectChanges();
    http.expectOne(listUrl).flush(fonts);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
  }

  async function fill(file: File | null, family: string, licence: boolean): Promise<void> {
    const input = field<HTMLInputElement>('font-file');
    Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
    input.dispatchEvent(new Event('change'));
    const name = field<HTMLInputElement>('font-family');
    name.value = family;
    name.dispatchEvent(new Event('input'));
    const box = field<HTMLInputElement>('font-licence');
    if (box.checked !== licence) box.click();
    await settle(fixture);
  }

  async function submit(): Promise<void> {
    (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FontsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(DashboardStore).projects.set([{ id: 'p1', name: 'Acme', role: 'publisher' }]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('lists each family with its faces, drawn in the face, with the uploader and whether a tale uses it', async () => {
    await open([
      font(),
      font({ id: '0f0e0d0c-0000-4000-8000-00000000000b', weight: 400, style: 'normal', inUse: false }),
    ]);
    const families = [...root.querySelectorAll('.fonts-family')].map((h) => h.textContent?.trim());
    expect(families).toEqual(['Brand Sans']);
    const faces = [...root.querySelectorAll('.fonts-face')];
    expect(faces).toHaveLength(2);
    expect(faces[0].textContent).toContain('Bold italic');
    expect(faces[0].textContent).toContain('Ada Admin');
    expect(faces[0].textContent).toContain('Used by a tale, so it cannot be deleted.');
    expect(faces[1].textContent).toContain('Not used by any tale.');
    // The sample is drawn under the font's alias with its fallback, and hidden from screen readers.
    const sample = faces[0].querySelector('.fonts-sample') as HTMLElement;
    expect(sample.getAttribute('aria-hidden')).toBe('true');
    expect(sample.style.fontFamily).toContain('taleart-font-0f0e0d0c-0000-4000-8000-00000000000a');
    expect(sample.style.fontFamily).not.toContain('Brand');
    expect(faces[0].querySelector('button')?.getAttribute('aria-label')).toBe('Delete Brand Sans Bold italic');
  });

  it('labels every control', async () => {
    await open();
    for (const control of root.querySelectorAll<HTMLElement>('form input, form select')) {
      const label = control.closest('label') ?? root.querySelector(`label[for="${control.id}"]`);
      expect(label?.textContent?.trim(), control.id).toBeTruthy();
    }
  });

  it('refuses an upload without the licence confirmed, naming the field, and sends nothing', async () => {
    await open();
    await fill(woff2File(), 'Brand Sans', false);
    await submit();
    const box = field<HTMLInputElement>('font-licence');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe('font-licence-error');
    expect(root.querySelector('#font-licence-error')?.textContent).toContain('may use and distribute');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('not uploaded');
    expect(document.activeElement).toBe(box);
    http.expectNone(listUrl);
  });

  it('refuses a family that is a CSS keyword or a list, a file that is not WOFF2, and one over 500 KB', async () => {
    await open();
    await fill(woff2File(), 'inherit', true);
    await submit();
    expect(field('font-family').getAttribute('aria-invalid')).toBe('true');
    await fill(woff2File(), 'Brand, Arial', true);
    await submit();
    expect(root.querySelector('#font-family-error')?.textContent).toContain('no commas');

    const ttf = new File([new Uint8Array([0, 1, 0, 0, ...new Array(60).fill(0)])], 'renamed.woff2');
    await fill(ttf, 'Brand Sans', true);
    await submit();
    expect(root.querySelector('#font-file-error')?.textContent).toContain('not a WOFF2 font file');
    expect(field('font-family').getAttribute('aria-invalid')).toBeNull();

    await fill(woff2File(600 * 1024), 'Brand Sans', true);
    await submit();
    expect(root.querySelector('#font-file-error')?.textContent).toContain('at most 500 KB');
    http.expectNone((req) => req.method === 'POST');
  });

  it('uploads a WOFF2 face with its family, weight, style, fallback and the licence, then lists it', async () => {
    await open();
    await fill(woff2File(), 'Brand Sans', true);
    const weight = field<HTMLSelectElement>('font-weight');
    weight.value = '700';
    weight.dispatchEvent(new Event('change'));
    const style = field<HTMLSelectElement>('font-style');
    style.value = 'italic';
    style.dispatchEvent(new Event('change'));
    await submit();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === listUrl);
    expect(req.request.params.get('family')).toBe('Brand Sans');
    expect(req.request.params.get('weight')).toBe('700');
    expect(req.request.params.get('style')).toBe('italic');
    expect(req.request.params.get('fallback')).toBe('sans');
    expect(req.request.params.get('licence')).toBe('confirmed');
    expect(req.request.body).toBeInstanceOf(File);
    req.flush(font({ inUse: false }));
    await settle(fixture);
    http.expectOne(listUrl).flush([font({ inUse: false })]);
    await settle(fixture);
    expect(root.querySelector('.fonts-saved')?.textContent).toContain('Brand Sans Bold italic uploaded.');
    expect(root.querySelectorAll('.fonts-face')).toHaveLength(1);
    // The form is empty again; the confirmation is asked again for the next file.
    expect(field<HTMLInputElement>('font-licence').checked).toBe(false);
    expect(field<HTMLInputElement>('font-family').value).toBe('');
    expect(field<HTMLSelectElement>('font-weight').value).toBe('400');
    expect(field<HTMLSelectElement>('font-style').value).toBe('normal');
  });

  it('marks the required fields', async () => {
    await open();
    for (const id of ['font-file', 'font-family', 'font-licence']) {
      expect(field(id).getAttribute('aria-required'), id).toBe('true');
    }
  });

  it('sends one upload however often it is submitted', async () => {
    await open();
    await fill(woff2File(), 'Brand Sans', true);
    const form = root.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    await settle(fixture);
    const posts = http.match((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    posts[0].flush(font({ inUse: false }));
    await settle(fixture);
    http.expectOne(listUrl).flush([]);
    await settle(fixture);
  });

  it.each([
    [409, 'font_exists', 'This project already has a font with this family, weight and style.', 'font-family'],
    [415, 'unsupported_media_type', 'Upload a WOFF2 font file.', 'font-file'],
    [413, 'font_storage_full', "A project's font files take at most 10 MB together.", 'font-file'],
    [409, 'font_limit_reached', 'A project holds at most 50 fonts.', 'font-file'],
  ])('ties a %i %s refusal to its field and moves focus there', async (status, code, message, id) => {
    await open();
    await fill(woff2File(), 'Brand Sans', true);
    await submit();
    http.expectOne((r) => r.method === 'POST').flush({ error: { code, message } }, { status, statusText: 'No' });
    await settle(fixture);
    const control = field(id);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(control.getAttribute('aria-describedby')).toContain(`${id}-error`);
    expect(root.querySelector(`#${id}-error`)?.textContent).toContain(message);
    expect(root.querySelector('[role=alert]')?.textContent).toContain(message);
    expect(document.activeElement).toBe(control);
  });

  it('disables Delete for a face a tale uses, and says why', async () => {
    await open([font()]);
    const button = root.querySelector('.fonts-face button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = root.querySelector(`#${button.getAttribute('aria-describedby')}`);
    expect(reason?.textContent).toContain('cannot be deleted');
    button.click();
    await settle(fixture);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of a font a tale started using meanwhile, and keeps it in the list", async () => {
    await open([font({ inUse: false })]);
    (root.querySelector('.fonts-face button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Brand Sans Bold italic'));
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(
        { error: { code: 'font_in_use', message: 'This font is used by the tale "Beach".' } },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('used by the tale "Beach"');
    expect(root.querySelectorAll('.fonts-face')).toHaveLength(1);
  });
});
