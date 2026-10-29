import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AccountMethods,
  AuthProvider,
  AuthSettings,
  PasswordResetLink,
  SaveAuthProviderRequest,
  SetPasswordRequest,
  UpdateAuthSettingsRequest,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';
import { providerTestUrl, type ProviderTestResult } from './sign-in-methods';

const AUTH = `${API_BASE}/auth`;

/**
 * The calls behind Settings > Sign-in methods (admins) and Settings > My sign-in methods. Each call
 * returns the API's answer or throws the HttpErrorResponse; the pages turn the error into text.
 */
@Injectable({ providedIn: 'root' })
export class SignInMethodsApi {
  private readonly http = inject(HttpClient);

  settings(): Promise<AuthSettings> {
    return firstValueFrom(this.http.get<AuthSettings>(`${AUTH}/settings`));
  }

  saveSettings(body: UpdateAuthSettingsRequest): Promise<AuthSettings> {
    return firstValueFrom(this.http.put<AuthSettings>(`${AUTH}/settings`, body));
  }

  providers(): Promise<AuthProvider[]> {
    return firstValueFrom(this.http.get<AuthProvider[]>(`${AUTH}/providers`));
  }

  saveProvider(slug: string, body: SaveAuthProviderRequest): Promise<AuthProvider> {
    return firstValueFrom(this.http.put<AuthProvider>(`${AUTH}/providers/${encodeURIComponent(slug)}`, body));
  }

  deleteProvider(slug: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${AUTH}/providers/${encodeURIComponent(slug)}`));
  }

  /** Runs discovery against the stored settings of the provider. */
  testProvider(slug: string): Promise<ProviderTestResult> {
    return firstValueFrom(this.http.post<ProviderTestResult>(providerTestUrl(slug), {}));
  }

  accountMethods(): Promise<AccountMethods> {
    return firstValueFrom(this.http.get<AccountMethods>(`${AUTH}/account/methods`));
  }

  setPassword(body: SetPasswordRequest): Promise<void> {
    return firstValueFrom(this.http.put<void>(`${AUTH}/account/password`, body));
  }

  removePassword(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${AUTH}/account/password`));
  }

  removePasskey(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${AUTH}/account/passkeys/${encodeURIComponent(id)}`));
  }

  unlinkIdentity(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${AUTH}/account/identities/${encodeURIComponent(id)}`));
  }

  /** A one-time reset link for a user, shown once (admins only). */
  issuePasswordReset(userId: string): Promise<PasswordResetLink> {
    return firstValueFrom(
      this.http.post<PasswordResetLink>(`${AUTH}/users/${encodeURIComponent(userId)}/password-reset`, {}),
    );
  }
}
