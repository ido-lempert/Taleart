import type express from 'express';

/** The cookies of a request, by name. Malformed pairs are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A value that is not valid percent-encoding is ignored.
    }
  }
  return cookies;
}

/** One cookie of the request, or undefined. */
export function readCookie(req: express.Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

export interface CookieOptions {
  /** Seconds until the cookie expires; 0 deletes it. */
  maxAge: number;
  path: string;
  secure: boolean;
}

/** Appends an http-only, SameSite=Strict cookie to the response. */
export function setCookie(res: express.Response, name: string, value: string, options: CookieOptions): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (options.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (options.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
