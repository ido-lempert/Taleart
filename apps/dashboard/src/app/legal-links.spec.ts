import { TestBed } from '@angular/core/testing';
import { LegalLinks, LEGAL_PRIVACY_URL, LEGAL_TERMS_URL } from './legal-links';

describe('LegalLinks', () => {
  it('links the Terms and the Privacy policy on the docs site, with plain link text', () => {
    const fixture = TestBed.createComponent(LegalLinks);
    fixture.detectChanges();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'));
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Terms of service', 'https://taleart.lempert.site/legal/terms'],
      ['Privacy policy', 'https://taleart.lempert.site/legal/privacy'],
    ]);
    expect(LEGAL_TERMS_URL).toBe('https://taleart.lempert.site/legal/terms');
    expect(LEGAL_PRIVACY_URL).toBe('https://taleart.lempert.site/legal/privacy');
  });
});
