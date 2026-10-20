import type { RelyingParty } from '@taleart/server-access';

/**
 * The relying party passkeys are bound to, from RP_ID and RP_ORIGIN. The
 * defaults fit local development: the dashboard on http://localhost:4200.
 */
export function relyingPartyFromEnv(env: NodeJS.ProcessEnv = process.env): RelyingParty {
  return {
    name: 'TaleArt',
    id: env['RP_ID'] || 'localhost',
    origin: env['RP_ORIGIN'] || 'http://localhost:4200',
  };
}

/** Cookies are `Secure` when the dashboard is served over https. */
export function secureCookiesFor(rp: RelyingParty): boolean {
  return rp.origin.startsWith('https:');
}
