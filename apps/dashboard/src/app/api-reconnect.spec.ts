import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_RETRY_TIMING, ApiReconnect, apiRetryDelay, FALLBACK_RETRY_MS } from './api-reconnect';
import { AuthStore } from './auth';
import { DashboardStore } from './dashboard.store';

const user = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' };

describe('apiRetryDelay', () => {
  it('waits 2, 4, 8 and 16 s, then 30 s', () => {
    const delays = [2_000, 4_000, 8_000, 16_000, 30_000];
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => apiRetryDelay(n, delays))).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('waits 30 s when no delays are given', () => {
    expect(apiRetryDelay(0, [])).toBe(FALLBACK_RETRY_MS);
    expect(FALLBACK_RETRY_MS).toBe(30_000);
  });

  it('defaults to the backoff, a 15 s try timeout and a 5 s announcement', () => {
    expect(TestBed.inject(API_RETRY_TIMING)).toEqual({
      delaysMs: [2_000, 4_000, 8_000, 16_000, 30_000],
      tryTimeoutMs: 15_000,
      announceMs: 5_000,
    });
  });
});

describe('ApiReconnect', () => {
  // Stand-ins for the stores: the API is down and a user is signed in, unless a test says otherwise.
  let store: {
    apiDown: ReturnType<typeof signal<boolean>>;
    refresh: ReturnType<typeof vi.fn>;
    loadFor: ReturnType<typeof vi.fn>;
  };
  let auth: {
    state: ReturnType<typeof signal<object | null>>;
    user: ReturnType<typeof signal<object | null>>;
    ensure: ReturnType<typeof vi.fn>;
  };
  let reconnect: ApiReconnect;
  let hidden = false;

  /** A refresh that answers: `up` clears the banner, else it stays. */
  const answer = (up: boolean) => async () => {
    if (up) store.apiDown.set(false);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    store = { apiDown: signal(false), refresh: vi.fn(answer(false)), loadFor: vi.fn(answer(false)) };
    auth = { state: signal<object | null>({ setupRequired: false, user }), user: signal<object | null>(user), ensure: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DashboardStore, useValue: store },
        { provide: AuthStore, useValue: auth },
      ],
    });
    reconnect = TestBed.inject(ApiReconnect);
    TestBed.tick();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    delete (document as { hidden?: boolean }).hidden;
    vi.restoreAllMocks();
  });

  async function goDown(): Promise<void> {
    store.apiDown.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('tries after 2 s, then 4 s, while the API stays down', async () => {
    await goDown();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(store.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.refresh).toHaveBeenCalledTimes(2);
  });

  it('gives up on a try after 15 s, so a hung request does not stall the retries', async () => {
    store.refresh.mockImplementationOnce(() => new Promise(() => undefined));
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    // No new try is scheduled while the first one waits...
    await vi.advanceTimersByTimeAsync(14_999);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    // ...until it times out; then the next waits 4 s.
    await vi.advanceTimersByTimeAsync(1 + 4_000);
    expect(store.refresh).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh try when the browser comes online during a hung one, and the old one schedules nothing', async () => {
    store.refresh.mockImplementationOnce(() => new Promise(() => undefined));
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.refresh).toHaveBeenCalledTimes(2);
    // The fresh try failed: the backoff starts again (2 s, 4 s, 8 s)...
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(store.refresh).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(store.refresh).toHaveBeenCalledTimes(5);
    // ...and the hung try's timeout (at 17 s) adds no try of its own: the next is 16 s later.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.refresh).toHaveBeenCalledTimes(5);
  });

  it('skips tries while the tab is hidden and tries at once when it shows again', async () => {
    await goDown();
    hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.refresh).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('skips tries while offline and tries at once when back online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await goDown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.refresh).not.toHaveBeenCalled();
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('says the API answered again for 5 s after a try that reached it', async () => {
    store.refresh.mockImplementation(answer(true));
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(reconnect.reconnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconnect.reconnected()).toBe(false);
    // Nothing more is tried.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the announcement on navigation and when the user signs out', async () => {
    store.refresh.mockImplementation(answer(true));
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(true);
    await TestBed.inject(Router).navigateByUrl('/elsewhere').catch(() => undefined);
    expect(reconnect.reconnected()).toBe(false);

    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(true);
    auth.user.set(null);
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(false);
  });

  it('announces nothing when the banner goes because the user signed out', async () => {
    await goDown();
    // Sign-out resets the store, which clears the banner without reaching the API.
    auth.user.set(null);
    store.apiDown.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconnect.reconnected()).toBe(false);
    expect(store.refresh).not.toHaveBeenCalled();
  });

  it('announces nothing when a try ends in a 401 that signs the user out', async () => {
    store.refresh.mockImplementation(async () => {
      auth.user.set(null);
      store.apiDown.set(false);
    });
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(false);
  });

  it('reads the auth state first when it was never read, and loads the signed-in user once', async () => {
    auth.state.set(null);
    auth.ensure.mockResolvedValueOnce(null).mockResolvedValueOnce({ setupRequired: false, user });
    store.loadFor.mockImplementation(answer(true));
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(auth.ensure).toHaveBeenCalledTimes(1);
    expect(store.loadFor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(store.loadFor).toHaveBeenCalledWith(user);
    expect(store.refresh).not.toHaveBeenCalled();
    TestBed.tick();
    expect(reconnect.reconnected()).toBe(true);
  });

  it('opens sign-in, with the way back, when the API answers and nobody is signed in', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    auth.state.set(null);
    auth.ensure.mockResolvedValue({ setupRequired: false, user: null });
    await goDown();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.apiDown()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], { queryParams: { returnUrl: '/' } });
  });

  it('clears its timer when destroyed', async () => {
    await goDown();
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.refresh).not.toHaveBeenCalled();
  });
});
