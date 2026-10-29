import { PasswordThrottle, passwordWaitMs, PASSWORD_WAIT_MAX_MS } from './throttle';

describe('password throttle', () => {
  it('lets the first five failures through and then waits 30 s, doubling, up to 15 minutes', () => {
    expect([0, 1, 2, 3, 4].map(passwordWaitMs)).toEqual([0, 0, 0, 0, 0]);
    expect(passwordWaitMs(5)).toBe(30_000);
    expect(passwordWaitMs(6)).toBe(60_000);
    expect(passwordWaitMs(7)).toBe(120_000);
    expect(passwordWaitMs(9)).toBe(480_000);
    expect(passwordWaitMs(10)).toBe(PASSWORD_WAIT_MAX_MS);
    expect(passwordWaitMs(50)).toBe(PASSWORD_WAIT_MAX_MS);
  });

  it('waits after the fifth failure and not before', () => {
    let t = 1_000_000;
    const throttle = new PasswordThrottle(() => t);
    for (let i = 0; i < 4; i++) throttle.failed('ada');
    expect(throttle.waitMs('ada')).toBe(0);
    throttle.failed('ada');
    expect(throttle.waitMs('ada')).toBe(30_000);
    t += 29_999;
    expect(throttle.waitMs('ada')).toBe(1);
    t += 1;
    expect(throttle.waitMs('ada')).toBe(0);
  });

  it('counts each username on its own', () => {
    const throttle = new PasswordThrottle(() => 0);
    for (let i = 0; i < 5; i++) throttle.failed('ada');
    expect(throttle.waitMs('ada')).toBeGreaterThan(0);
    expect(throttle.waitMs('grace')).toBe(0);
  });

  it('clears a username after a success', () => {
    const throttle = new PasswordThrottle(() => 0);
    for (let i = 0; i < 6; i++) throttle.failed('ada');
    throttle.succeeded('ada');
    expect(throttle.waitMs('ada')).toBe(0);
  });

  it('forgets failures after an hour without a new one', () => {
    let t = 0;
    const throttle = new PasswordThrottle(() => t);
    for (let i = 0; i < 9; i++) throttle.failed('ada');
    t += 60 * 60_000;
    expect(throttle.waitMs('ada')).toBe(0);
    throttle.failed('ada');
    expect(throttle.waitMs('ada')).toBe(0);
  });
});
