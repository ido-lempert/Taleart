import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE } from '../dashboard.store';
import { ProfilePage } from './profile';

const url = `${API_BASE}/me/preferences`;
const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' as const };

function device(dark: boolean): void {
  const query = { matches: dark, addEventListener: () => undefined, removeEventListener: () => undefined };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('ProfilePage: Settings > Profile (dashboard dark mode)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ProfilePage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const radio = (value: string) => root().querySelector<HTMLInputElement>(`#appearance-${value}`) as HTMLInputElement;
  const painted = () => document.documentElement.dataset['theme'];

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(ProfilePage);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
  }

  beforeEach(async () => {
    device(false);
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    fixture?.destroy();
    root().remove();
  });

  it('shows System selected for a user who has not chosen, and the three choices', async () => {
    await open();
    expect(radio('system').checked).toBe(true);
    expect(radio('light').checked).toBe(false);
    expect(radio('dark').checked).toBe(false);
  });

  it('applies a choice at once and keeps it on the account', async () => {
    await open();
    radio('dark').checked = true;
    radio('dark').dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(painted()).toBe('dark');
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ appearance: 'dark' });
    req.flush({ ...USER, appearance: 'dark' });
    await settle(fixture);

    expect(radio('dark').checked).toBe(true);
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it('brings the previous choice back and says so when the save fails', async () => {
    device(true);
    await open();
    expect(painted()).toBe('dark');

    radio('light').checked = true;
    radio('light').dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(painted()).toBe('light');

    http.expectOne(url).flush({ error: { code: 'internal', message: 'boom' } }, { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    expect(painted()).toBe('dark');
    expect(radio('system').checked).toBe(true);
    expect(root().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Could not save appearance. Try again.');
  });
});
