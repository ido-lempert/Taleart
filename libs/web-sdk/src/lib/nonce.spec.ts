import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, init } from './config';
import { applyNonce } from './nonce';

afterEach(() => {
  init({ nonce: null });
  vi.restoreAllMocks();
});

describe('CSP nonce', () => {
  it('gives the SDK style sheets the nonce set with init', () => {
    init({ nonce: 'abcDEF123_-+/=' });
    expect(getConfig().nonce).toBe('abcDEF123_-+/=');
    const style = document.createElement('style');
    applyNonce(style);
    expect(style.nonce).toBe('abcDEF123_-+/=');
  });

  it('leaves a style sheet alone when no nonce is set', () => {
    init({ nonce: null });
    const style = document.createElement('style');
    applyNonce(style);
    expect(style.nonce).toBe('');
  });

  it('refuses a nonce that is not base64 and keeps the previous one, with a warning', () => {
    init({ nonce: 'abcDEF123456' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    init({ nonce: 'has spaces and <tags>' });
    expect(getConfig().nonce).toBe('abcDEF123456');
    expect(warn).toHaveBeenCalled();
  });
});
