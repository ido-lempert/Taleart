import { inject, Injectable, signal } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  ErrorCodes,
  isErrorBody,
  type AuthState,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type PasskeyResponse,
  type SignedIn,
  type User,
} from '@taleart/contract';
import { catchError, firstValueFrom, throwError, type Observable } from 'rxjs';
import { API_BASE, DashboardStore } from './dashboard.store';

const AUTH_BASE = `${API_BASE}/auth`;

/** The browser side of WebAuthn, behind a service so tests can stand in for the authenticator. */
@Injectable({ providedIn: 'root' })
export class PasskeyClient {
  supported(): boolean {
    return typeof window !== 'undefined' && browserSupportsWebAuthn();
  }

  async register(options: PasskeyCreationOptions): Promise<PasskeyResponse> {
    const optionsJSON = options as unknown as PublicKeyCredentialCreationOptionsJSON;
    return (await startRegistration({ optionsJSON })) as unknown as PasskeyResponse;
  }

  async authenticate(options: PasskeyRequestOptions): Promise<PasskeyResponse> {
    const optionsJSON = options as unknown as PublicKeyCredentialRequestOptionsJSON;
    return (await startAuthentication({ optionsJSON })) as unknown as PasskeyResponse;
  }
}

// The message to show for a failed passkey step: the API's own, the browser's
// when the person cancelled, or the fallback.
function passkeyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (isErrorBody(err.error)) return err.error.error.message;
    if (err.status === 0) return 'Could not reach the API. Try again.';
    return fallback;
  }
  if (err instanceof WebAuthnError || (err instanceof Error && err.name === 'NotAllowedError')) {
    return 'The passkey request was cancelled or timed out. Try again.';
  }
  return fallback;
}

/** Only same-site paths are followed after sign-in. */
export function safeReturnUrl(url: string | null | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : '/zones';
}

/** Who is signed in, and setup, sign-in and sign-out (AD-9). Each action resolves to '' or the message to show. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly http = inject(HttpClient);
  private readonly passkeys = inject(PasskeyClient);
  private readonly store = inject(DashboardStore);

  /** The auth state, or null until it was read (or when the API could not be reached). */
  readonly state = signal<AuthState | null>(null);
  readonly user = signal<User | null>(null);
  private loading: Promise<AuthState | null> | null = null;

  /** The auth state, read from the API once; null when the API could not be reached. */
  ensure(): Promise<AuthState | null> {
    const known = this.state();
    if (known) return Promise.resolve(known);
    this.loading ??= firstValueFrom(this.http.get<AuthState>(`${AUTH_BASE}/state`))
      .then((state) => {
        this.apply(state);
        return state;
      })
      .catch(() => null)
      .finally(() => (this.loading = null));
    return this.loading;
  }

  /** Forgets the signed-in user, for example after the API answered 401. */
  signedOut(): void {
    this.apply({ setupRequired: this.state()?.setupRequired ?? false, user: null });
  }

  /** Registers the first admin's passkey and signs them in. */
  async setUp(name: string, email: string): Promise<string> {
    try {
      const options = await firstValueFrom(
        this.http.post<PasskeyCreationOptions>(`${AUTH_BASE}/setup/options`, { name, email }),
      );
      const response = await this.passkeys.register(options);
      const { user } = await firstValueFrom(this.http.post<SignedIn>(`${AUTH_BASE}/setup/verify`, response));
      this.apply({ setupRequired: false, user });
      return '';
    } catch (err) {
      if (err instanceof HttpErrorResponse && isErrorBody(err.error) && err.error.error.code === ErrorCodes.setupClosed) {
        this.apply({ setupRequired: false, user: null });
      }
      return passkeyErrorMessage(err, 'Setup did not finish. Try again.');
    }
  }

  /** Signs in with a passkey stored on this device or in a password manager. */
  async signIn(): Promise<string> {
    try {
      const options = await firstValueFrom(this.http.post<PasskeyRequestOptions>(`${AUTH_BASE}/sign-in/options`, {}));
      const response = await this.passkeys.authenticate(options);
      const { user } = await firstValueFrom(this.http.post<SignedIn>(`${AUTH_BASE}/sign-in/verify`, response));
      this.apply({ setupRequired: false, user });
      return '';
    } catch (err) {
      return passkeyErrorMessage(err, 'Sign-in did not finish. Try again.');
    }
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>(`${AUTH_BASE}/sign-out`, {}));
    } catch {
      // The session is forgotten here either way; the cookie expires on its own.
    }
    this.signedOut();
  }

  private apply(state: AuthState): void {
    this.state.set(state);
    this.user.set(state.user);
    if (!state.user) this.store.reset();
  }
}

/** Shell pages need a signed-in user: otherwise setup (empty install) or sign-in, then back here. */
export const authGuard: CanActivateFn = async (_route, routerState): Promise<boolean | UrlTree> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const store = inject(DashboardStore);
  const state = await auth.ensure();
  if (!state) {
    // The API is unreachable: show the shell with its banner rather than a sign-in that cannot work.
    store.apiDown.set(true);
    return true;
  }
  if (state.user) return true;
  const queryParams = { returnUrl: routerState.url };
  return router.createUrlTree([state.setupRequired ? '/setup' : '/sign-in'], { queryParams });
};

/** The setup page exists only while setup is required. */
export const setupGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const auth = inject(AuthStore);
  const state = await auth.ensure();
  if (!state || state.setupRequired) return true;
  if (state.user) return router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
  return router.createUrlTree(['/sign-in'], { queryParams: route.queryParams });
};

/** The sign-in page sends to setup on an empty install, and away when already signed in. */
export const signInGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const auth = inject(AuthStore);
  const state = await auth.ensure();
  if (!state) return true;
  if (state.setupRequired) return router.createUrlTree(['/setup'], { queryParams: route.queryParams });
  if (state.user) return router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
  return true;
};

/** A 401 from a Management API call (not the auth calls) means the session ended: go to sign-in, then back. */
export const unauthorizedInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        req.url.startsWith(API_BASE) &&
        !req.url.startsWith(AUTH_BASE) &&
        auth.user()
      ) {
        const returnUrl = router.url;
        auth.signedOut();
        void router.navigate(['/sign-in'], { queryParams: { returnUrl } });
      }
      return throwError(() => err);
    }),
  );
};
