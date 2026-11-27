import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';

/**
 * The QR code of an authenticator app's otpauth address, drawn in the browser: the address never leaves the page.
 * Nothing shows until the image is ready; the typed key beside it stays the fallback.
 */
@Component({
  selector: 'app-totp-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .totp-qr {
      display: block;
      width: 192px;
      height: 192px;
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: #fff;
    }
  `,
  template: `
    @if (dataUrl(); as src) {
      <img class="totp-qr" [src]="src" width="192" height="192" alt="QR code to scan with your authenticator app" />
    }
  `,
})
export class TotpQr {
  /** The otpauth address the QR code carries. */
  readonly uri = input.required<string>();

  /** The image's data URL once drawn; null until then. */
  protected readonly dataUrl = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const uri = this.uri();
      let current = true;
      onCleanup(() => (current = false));
      this.dataUrl.set(null);
      QRCode.toDataURL(uri, { margin: 1, width: 192 })
        .then((url) => {
          if (current) this.dataUrl.set(url);
        })
        .catch(() => {
          if (current) this.dataUrl.set(null);
        });
    });
  }
}
