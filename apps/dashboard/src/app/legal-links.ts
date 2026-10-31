import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The docs site's legal pages, which the sign-in, registration and invitation pages link to. */
export const LEGAL_TERMS_URL = 'https://taleart.lempert.site/legal/terms';
export const LEGAL_PRIVACY_URL = 'https://taleart.lempert.site/legal/privacy';

/**
 * The short line under the sign-in, setup, invitation and password reset forms: by continuing, the person
 * accepts the Terms and has read the Privacy policy. The links open in the same tab, with plain text names.
 */
@Component({
  selector: 'app-legal-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="auth-card__legal">
      By continuing you agree to the
      <a [href]="terms" rel="noopener">Terms of service</a> and confirm you have read the
      <a [href]="privacy" rel="noopener">Privacy policy</a>.
    </p>
  `,
})
export class LegalLinks {
  protected readonly terms = LEGAL_TERMS_URL;
  protected readonly privacy = LEGAL_PRIVACY_URL;
}
