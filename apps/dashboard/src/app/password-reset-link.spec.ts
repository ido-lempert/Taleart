import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { API_BASE } from './dashboard.store';
import { PasswordResetLinkDrawer } from './password-reset-link';

const URL_ONCE = 'https://app.example.com/password-reset/abc123';
const ISSUED = {
  id: 'l1',
  userId: 'u2',
  url: URL_ONCE,
  expiresAt: '2026-10-30T10:00:00.000Z',
};

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('PasswordResetLinkDrawer: a one-time reset link for a user', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PasswordResetLinkDrawer>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');

  function open(): void {
    fixture = TestBed.createComponent(PasswordResetLinkDrawer);
    fixture.componentRef.setInput('userId', 'u2');
    fixture.componentRef.setInput('userName', 'Grace');
    document.body.appendChild(root());
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordResetLinkDrawer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('explains what the link does before it is created, and creates nothing until asked', () => {
    open();
    expect(text()).toContain('Create a one-time link for Grace');
    expect(text()).toContain('works for 24 hours');
    expect(root().querySelector('#reset-link-url')).toBeNull();
    http.expectNone(`${API_BASE}/auth/users/u2/password-reset`);
  });

  it('creates the link and shows it once, read-only, with a Copy button', async () => {
    open();
    root().querySelector<HTMLButtonElement>('#reset-link-create')?.click();
    const req = http.expectOne(`${API_BASE}/auth/users/u2/password-reset`);
    expect(req.request.method).toBe('POST');
    req.flush(ISSUED, { status: 201, statusText: 'Created' });
    await settle(fixture);
    const url = root().querySelector<HTMLInputElement>('#reset-link-url');
    expect(url?.value).toBe(URL_ONCE);
    expect(url?.readOnly).toBe(true);
    expect(text()).toContain('It works once, until');
    expect(text()).toContain('This link is shown only now.');
    expect(root().querySelector('#reset-link-copy')?.textContent).toContain('Copy link');
  });

  it('copies the link with the clipboard, and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    root().querySelector<HTMLButtonElement>('#reset-link-create')?.click();
    http.expectOne(`${API_BASE}/auth/users/u2/password-reset`).flush(ISSUED, { status: 201, statusText: 'Created' });
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#reset-link-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(URL_ONCE);
    expect(text()).toContain('Link copied');
  });

  it('forgets the link on Done: it is not shown again', async () => {
    open();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    root().querySelector<HTMLButtonElement>('#reset-link-create')?.click();
    http.expectOne(`${API_BASE}/auth/users/u2/password-reset`).flush(ISSUED, { status: 201, statusText: 'Created' });
    await settle(fixture);
    const done = [...root().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Done',
    );
    done?.click();
    await settle(fixture);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(root().querySelector('#reset-link-url')).toBeNull();
    expect(root().innerHTML).not.toContain('abc123');
  });

  it('explains a refused request, and keeps the drawer for a retry', async () => {
    open();
    root().querySelector<HTMLButtonElement>('#reset-link-create')?.click();
    http
      .expectOne(`${API_BASE}/auth/users/u2/password-reset`)
      .flush({ error: { code: 'not_found', message: 'No such user.' } }, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('No such user.');
    expect(root().querySelector('#reset-link-create')).not.toBeNull();
  });
});
