import type { PasskeyCreationOptions, PasskeyRequestOptions } from '@taleart/contract';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PasskeyFailedError } from './errors';

/** A passkey the authenticator just created, ready to store. */
export interface NewPasskey {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
}

/** A stored passkey, as the verifier needs it to check a sign-in. */
export interface StoredPasskey {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
}

/**
 * Creates WebAuthn options and checks authenticator responses. The access
 * module reaches WebAuthn only through this port, so tests can inject a fake.
 * A failed check throws {@link PasskeyFailedError}.
 */
export interface PasskeyVerifier {
  /** Creation options for a new discoverable passkey; `userHandle` is base64url. */
  creationOptions(user: { userHandle: string; name: string; email: string }): Promise<PasskeyCreationOptions>;
  verifyRegistration(response: unknown, expectedChallenge: string): Promise<NewPasskey>;
  /** Request options without allowCredentials: the passkey is discoverable. */
  requestOptions(): Promise<PasskeyRequestOptions>;
  /** Checks a sign-in with `passkey`; resolves to the authenticator's new signature counter. */
  verifyAuthentication(response: unknown, expectedChallenge: string, passkey: StoredPasskey): Promise<number>;
}

/** The relying party: the site passkeys are bound to. */
export interface RelyingParty {
  name: string;
  /** The domain, such as `localhost` or `taleart.example.com`. */
  id: string;
  /** The dashboard origin, such as `http://localhost:4200`. */
  origin: string;
}

const failure = (err: unknown) =>
  new PasskeyFailedError(err instanceof Error && err.message ? err.message : 'The passkey could not be verified');

/** The real adapter, over `@simplewebauthn/server`. User verification and resident keys are required. */
export class SimpleWebAuthnVerifier implements PasskeyVerifier {
  constructor(private readonly rp: RelyingParty) {}

  async creationOptions(user: { userHandle: string; name: string; email: string }): Promise<PasskeyCreationOptions> {
    return (await generateRegistrationOptions({
      rpName: this.rp.name,
      rpID: this.rp.id,
      userID: Uint8Array.from(Buffer.from(user.userHandle, 'base64url')),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    })) as unknown as PasskeyCreationOptions;
  }

  async verifyRegistration(response: unknown, expectedChallenge: string): Promise<NewPasskey> {
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.id,
        requireUserVerification: true,
      });
    } catch (err) {
      throw failure(err);
    }
    if (!result.verified) throw failure(null);
    const { credential } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
    };
  }

  async requestOptions(): Promise<PasskeyRequestOptions> {
    return (await generateAuthenticationOptions({
      rpID: this.rp.id,
      userVerification: 'required',
    })) as unknown as PasskeyRequestOptions;
  }

  async verifyAuthentication(response: unknown, expectedChallenge: string, passkey: StoredPasskey): Promise<number> {
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.id,
        credential: {
          id: passkey.credentialId,
          publicKey: Uint8Array.from(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports,
        },
        requireUserVerification: true,
      });
    } catch (err) {
      throw failure(err);
    }
    if (!result.verified) throw failure(null);
    return result.authenticationInfo.newCounter;
  }
}
