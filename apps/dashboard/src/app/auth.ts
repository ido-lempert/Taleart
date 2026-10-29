import { computed, inject, Injectable, signal } from '@angular/core';
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
  type InvitationPreview,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type PasskeyResponse,
  type PasswordResetPreview,
  type SignedIn,
  type User,
} from '@taleart/contract/core';
import { catchError, firstValueFrom, throwError, type Observable } from 'rxjs';
import { API_BASE, DashboardStore } from './dashboard.store';
import {
  errorCode,
  errorText,
  normalizeUsername,
  retryAfterSeconds,
  type PasswordRefusal,
} from './sign-in-methods';

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

// True for the API's 410 invitation_invalid.
function invitationGone(err: unknown): boolean {
  return err instanceof HttpErrorResponse && isErrorBody(err.error) && err.error.error.code === ErrorCodes.invitationInvalid;
}

// A refused password step as the form shows it: which field the API's code belongs to, and whether the link is gone.
function passwordRefusal(err: unknown, fallback: string): PasswordRefusal {
  const message = errorText(err, fallback);
  switch (errorCode(err)) {
    case ErrorCodes.usernameTaken:
      return { message, field: 'username' };
    case ErrorCodes.passwordRejected:
      return { message, field: 'password' };
    case ErrorCodes.invitationInvalid:
    case ErrorCodes.passwordResetInvalid:
      return { message, invalid: true };
    default:
      return { message };
  }
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
  /** Admins create projects and invitations; content managers do not. */
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
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

  /** The project an invitation link is for, or null when the link is no longer valid. Other failures throw. */
  async invitation(token: string): Promise<InvitationPreview | null> {
    try {
      return await firstValueFrom(this.http.get<InvitationPreview>(`${AUTH_BASE}/invitations/${encodeURIComponent(token)}`));
    } catch (err) {
      if (invitationGone(err)) return null;
      throw err;
    }
  }

  /**
   * Registers an invitee's passkey through the invitation link and signs them in
   * as a content manager. Resolves to '' or the message to show; `invalid` is
   * true when the link stopped working meanwhile.
   */
  async join(token: string, name: string, email: string): Promise<{ message: string; invalid: boolean }> {
    const base = `${AUTH_BASE}/invitations/${encodeURIComponent(token)}`;
    try {
      const options = await firstValueFrom(this.http.post<PasskeyCreationOptions>(`${base}/options`, { name, email }));
      const response = await this.passkeys.register(options);
      const { user } = await firstValueFrom(this.http.post<SignedIn>(`${base}/verify`, response));
      this.apply({ setupRequired: false, user });
      return { message: '', invalid: false };
    } catch (err) {
      return { message: passkeyErrorMessage(err, 'Joining did not finish. Try again.'), invalid: invitationGone(err) };
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

  /**
   * Signs in with a username and password. Resolves to null when signed in, else to what to show:
   * the same words for a wrong password and an unknown username, and the wait when throttled.
   */
  async signInWithPassword(username: string, password: string): Promise<PasswordRefusal | null> {
    try {
      const { user } = await firstValueFrom(
        this.http.post<SignedIn>(`${AUTH_BASE}/password/sign-in`, { username: normalizeUsername(username), password }),
      );
      this.apply({ setupRequired: false, user });
      return null;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 429) {
        const retryAfter = retryAfterSeconds(err.headers.get('Retry-After'));
        return {
          message: retryAfter
            ? `Too many attempts for this username. Wait ${retryAfter} seconds, then try again.`
            : 'Too many attempts for this username. Wait a few minutes, then try again.',
          ...(retryAfter === null ? {} : { retryAfter }),
        };
      }
      if (errorCode(err) === ErrorCodes.signInFailed) return { message: 'The username or password is not right.' };
      return { message: errorText(err, 'Sign-in did not finish. Try again.') };
    }
  }

  /**
   * Registers the first admin with a username and password, and signs them in. Resolves to null on
   * success; `closed` when someone else finished setup first.
   */
  async setUpWithPassword(name: string, email: string, username: string, password: string): Promise<PasswordRefusal | null> {
    try {
      const { user } = await firstValueFrom(
        this.http.post<SignedIn>(`${AUTH_BASE}/setup/password`, {
          name,
          email,
          username: normalizeUsername(username),
          password,
        }),
      );
      this.apply({ setupRequired: false, user });
      return null;
    } catch (err) {
      if (errorCode(err) === ErrorCodes.setupClosed) {
        this.apply({ setupRequired: false, user: null });
        return { ...passwordRefusal(err, 'Setup is already finished.'), closed: true };
      }
      return passwordRefusal(err, 'Setup did not finish. Try again.');
    }
  }

  /**
   * Joins through an invitation with a username and password, and signs the invitee in as a content
   * manager. Resolves to null on success.
   */
  async joinWithPassword(
    token: string,
    name: string,
    email: string,
    username: string,
    password: string,
  ): Promise<PasswordRefusal | null> {
    try {
      const { user } = await firstValueFrom(
        this.http.post<SignedIn>(`${AUTH_BASE}/invitations/${encodeURIComponent(token)}/password`, {
          name,
          email,
          username: normalizeUsername(username),
          password,
        }),
      );
      this.apply({ setupRequired: false, user });
      return null;
    } catch (err) {
      return passwordRefusal(err, 'Joining did not finish. Try again.');
    }
  }

  /** Whose password a reset link sets, or null when the link no longer works. Other failures throw. */
  async passwordReset(token: string): Promise<PasswordResetPreview | null> {
    try {
      return await firstValueFrom(this.http.get<PasswordResetPreview>(`${AUTH_BASE}/password-resets/${encodeURIComponent(token)}`));
    } catch (err) {
      if (errorCode(err) === ErrorCodes.passwordResetInvalid) return null;
      throw err;
    }
  }

  /**
   * Sets the password through a reset link and signs the user in. `username` is sent only when the
   * preview asked for one. Resolves to null on success.
   */
  async redeemPasswordReset(token: string, password: string, username?: string): Promise<PasswordRefusal | null> {
    try {
      const body = username === undefined ? { password } : { username: normalizeUsername(username), password };
      const { user } = await firstValueFrom(
        this.http.post<SignedIn>(`${AUTH_BASE}/password-resets/${encodeURIComponent(token)}/redeem`, body),
      );
      this.apply({ setupRequired: false, user });
      return null;
    } catch (err) {
      if (errorCode(err) === ErrorCodes.validationFailed) return { message: errorText(err, 'Check the username.'), field: 'username' };
      return passwordRefusal(err, 'The password was not set. Try again.');
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

  // The methods on are the server's answer to /auth/state: a session change keeps the list last read.
  private apply(next: Omit<AuthState, 'methods'> & { methods?: AuthState['methods'] }): void {
    const previous = this.user();
    const state: AuthState = { ...next, methods: next.methods ?? this.state()?.methods ?? [] };
    this.state.set(state);
    this.user.set(state.user);
    // Signed out, or someone else signed in on this browser (joining by invitation): drop the old data.
    if (!state.user || (previous && previous.id !== state.user.id)) this.store.reset();
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
  // A provider callback that failed lands here with ?auth_error=<code>: keep it for the sign-in page.
  const authError = routerState.root.queryParamMap.get('auth_error');
  const queryParams = { returnUrl: routerState.url, ...(authError ? { auth_error: authError } : {}) };
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
