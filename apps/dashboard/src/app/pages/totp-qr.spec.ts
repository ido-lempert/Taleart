import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TotpQr } from './totp-qr';

const URI = 'otpauth://totp/TaleArt:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TaleArt';

@Component({
  imports: [TotpQr],
  template: `<app-totp-qr [uri]="uri()" />`,
})
class Host {
  readonly uri = signal(URI);
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

describe('TotpQr: the QR code of the otpauth address', () => {
  let fixture: ComponentFixture<Host>;
  const img = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('img');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('renders an image with a data: source and the scan alt text for the given uri', async () => {
    await settle(fixture);
    const image = img();
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\//);
    expect(image?.alt).toBe('QR code to scan with your authenticator app');
  });

  it('shows nothing until the image is ready', () => {
    expect(img()).toBeNull();
  });

  it('draws the code again when the uri changes', async () => {
    await settle(fixture);
    const first = img()?.getAttribute('src');
    fixture.componentInstance.uri.set('otpauth://totp/TaleArt:grace@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=TaleArt');
    fixture.detectChanges();
    await settle(fixture);
    expect(img()?.getAttribute('src')).toMatch(/^data:image\//);
    expect(img()?.getAttribute('src')).not.toBe(first);
  });
});
