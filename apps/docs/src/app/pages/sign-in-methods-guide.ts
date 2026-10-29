import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

const KEY_SAMPLE = `# Generate a key once, and keep it with your other secrets:
openssl rand -base64 32

# Set the output as TALEART_SECRET_KEY on the API, then restart the API:
TALEART_SECRET_KEY=<the output of openssl rand -base64 32>`;

const SETUP_PASSWORD_SAMPLE = `# On an empty install only: the first admin may set up with a username and password.
TALEART_SETUP_PASSWORD=true`;

const REDIRECT_SAMPLE = 'https://api.example.com/api/v1/auth/callback/google';

@Component({
  selector: 'docs-sign-in-methods-guide',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Sign-in methods</h1>
    <p class="lede">
      This guide turns on the ways people sign in to TaleArt: a passkey (on by default), a username and password, and an
      identity provider such as Google, Apple or your own OpenID Connect provider. An admin does the setup in the dashboard,
      step by step. The rules behind each method are in the
      <a routerLink="/reference/sign-in-methods">Sign-in methods reference</a>. The people and invitations side is in
      <a routerLink="/projects-and-team">Projects, team and sign-in</a>.
    </p>

    <h2 id="before-you-start">Before you start: the secret key</h2>
    <p>
      A provider's client secret, and an Apple private key, are stored encrypted. The key that encrypts them is an
      environment variable of the API, <code>TALEART_SECRET_KEY</code>: 32 random bytes, base64-encoded. Without it the API
      still runs, but it refuses to save a secret, so a provider that needs one cannot be used.
    </p>
    <pre tabindex="0" role="region" aria-label="Generate the secret key"><code>{{ keySample }}</code></pre>
    <p>
      Keep the key with your other secrets. If it is lost, the stored secrets cannot be read, and each provider's secret must
      be entered again. When the key is missing, the Sign-in methods page shows the notice <em>Provider secrets cannot be
      saved yet</em>, and saving a provider's secret is refused with the same reason.
    </p>

    <h2 id="steps">Set up the methods</h2>
    <ol class="steps">
      <li>
        <strong>Open Settings > Sign-in methods.</strong> An admin finds the page in <em>Settings</em>, in the
        <em>Sign-in methods</em> tab. The Methods section lists <em>Passkey</em>, on from a fresh install, and
        <em>Username and password</em>, off. The Providers section below it is empty until you add one. Only admins see the
        tab. API tokens are unchanged by any of this.
        <figure>
          <img
            src="/images/signin-shot-01-methods.png"
            alt="The Sign-in methods page of Settings on a fresh install. A red notice, Provider secrets cannot be saved yet, sits above the Methods section. Passkey is on, Username and password is off, and the Providers section is empty."
            width="1000"
            height="900"
          />
          <figcaption>The Sign-in methods page before the secret key is set, a real screenshot of the dashboard. The red notice says provider secrets cannot be saved until TALEART_SECRET_KEY is set.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Turn on username and password.</strong> Switch <em>Username and password sign-in</em> on. Each person who
        joins by invitation then chooses a username and a password. People who already have an account set a password under
        <em>My sign-in methods</em>. Keep the passkey on until another admin can sign in with the new method.
        <p>
          On an empty install, the first admin can also set up with a username and password, but only when the server runs
          with <code>TALEART_SETUP_PASSWORD=true</code>. Without it, the setup screen offers the passkey alone.
        </p>
        <pre tabindex="0" role="region" aria-label="Allow a password for the first admin"><code>{{ setupPasswordSample }}</code></pre>
        <figure>
          <img
            src="/images/signin-shot-02-password.png"
            alt="The Methods section with Username and password switched on. Both Passkey and Username and password read On; the notice about the secret key is still shown above."
            width="1000"
            height="900"
          />
          <figcaption>The same page after turning username and password on, a real screenshot of the dashboard.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Add Google.</strong> In the Google Cloud console, create an OAuth client of type <em>Web application</em>, and
        copy its client ID and client secret. In TaleArt choose <em>Add a provider</em>, then <em>Google</em>. Enter the
        <em>Button name</em>, the client ID and the client secret, then choose <em>Save provider</em>. The secret is stored
        encrypted and is never shown again. After saving, copy the <em>Redirect URI</em> from the drawer. It has the form
        <code>{{ redirectSample }}</code>. Add it as an authorized redirect URI of the client in Google, then choose
        <em>Test</em>: the check passes when the provider's settings work.
        <figure>
          <img
            src="/images/signin-shot-03-google-drawer.png"
            alt="The Add a sign-in provider drawer with Google chosen. Button name is Google, Client ID holds an example value, and the client secret is masked. The redirect URI note says it appears once the provider is saved."
            width="420"
            height="900"
          />
          <figcaption>The Google drawer filled with example values, a real screenshot. Nothing is saved: the client secret stays masked as it is typed.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Add a generic OpenID Connect provider.</strong> Choose <em>Add a provider</em>, then <em>Generic OpenID
        Connect</em>. Enter a slug, such as <code>company-sso</code>. The method is then <code>oidc:company-sso</code>. Enter
        the issuer URL, such as <code>https://id.example.com</code>: its discovery document, at
        <code>/.well-known/openid-configuration</code>, must name exactly this issuer. Enter the client ID and the client
        secret, save, copy the redirect URI into the provider, then choose <em>Test</em>. A failed check says why, for example
        <em>The provider did not pass the check: discovery_failed</em>.
        <figure>
          <img
            src="/images/signin-shot-04-oidc-test.png"
            alt="The Edit Company SSO drawer of a saved generic OpenID Connect provider. Its client secret shows only as Secret is set, the redirect URI is visible, and Test reports that the provider settings work, with the issuer and the endpoints found."
            width="420"
            height="900"
          />
          <figcaption>A saved provider after Test, a real screenshot. The secret is never shown, only that it is set. The issuer is a local test issuer.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Add Apple.</strong> In your Apple developer account, create a Services ID for Sign in with Apple, and a key
        with Sign in with Apple enabled. Note your 10-character team ID and the key's 10-character key ID. In TaleArt choose
        <em>Add a provider</em>, then <em>Apple</em>. Enter the Services ID as the client ID, the team ID, the key ID, and paste
        the private key file (.p8) as PEM text into <em>Private key (.p8)</em>. Save, copy the redirect URI, and register it as
        the Services ID's return URL. Apple sends the user back with a form post, which TaleArt accepts at the same address.
        The private key is stored encrypted, like a client secret.
        <figure>
          <img
            src="/images/signin-shot-05-apple-drawer.png"
            alt="The Add a sign-in provider drawer with Apple chosen. Client ID, Team ID and Key ID hold example values, and the Private key (.p8) field holds the placeholder text. Nothing is saved."
            width="420"
            height="900"
          />
          <figcaption>The Apple drawer filled with example values, a real screenshot. The private key field holds placeholder text; nothing is saved.</figcaption>
        </figure>
      </li>

      <li>
        <strong>See the methods on the sign-in page.</strong> Open the dashboard in a private window, where you are signed out.
        The sign-in page shows <em>Sign in with a passkey</em>, a form under <em>With a username and password</em>, and one
        <em>Continue with</em> button per provider that is on and usable. A provider is usable when it is on, its secret is
        stored, and the server has its key. A method that is off is not shown at all.
        <figure>
          <img
            src="/images/signin-shot-06-sign-in.png"
            alt="The sign-in page for a signed-out browser: the Sign in heading, Sign in with a passkey, a username and password form, and a Continue with Company SSO button for the provider."
            width="1000"
            height="900"
          />
          <figcaption>The sign-in page with the enabled methods, a real screenshot of the dashboard for a signed-out visitor.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Invite someone to join with a provider or a password.</strong> In the project, choose <em>Invite</em>. The link,
        <code>/invite/&lt;token&gt;</code>, is one-time and valid for 7 days, and it is shown only once. The admin does not enter an
        email: the person opens the link, enters their name and email, and then chooses a passkey, a username and password, or
        a provider. With a provider, the email the provider verified must equal the email typed on the invitation page.
        Otherwise the join is refused with <code>email_mismatch</code>, or with <code>email_not_verified</code> when the provider
        did not verify the address. A provider never creates an account by
        itself: it can only join an invitation or be linked by a user who is signed in.
      </li>

      <li>
        <strong>Let each user manage their own methods.</strong> A signed-in user opens <em>Settings > My sign-in methods</em>.
        There they see their passkeys, their password (its username, never the password itself), and their linked providers.
        They set or change the password (the current one is needed when one is set), remove a passkey, unlink a provider, or
        choose <em>Link a provider</em> to attach one to the account. A method can be removed only while another one remains.
        <figure>
          <img
            src="/images/signin-shot-08-my-methods.png"
            alt="The My sign-in methods page of an admin: Passkeys says No passkeys, Username and password shows the username and Change password and Remove password buttons, and Linked providers offers Continue with Company SSO under Link a provider."
            width="1000"
            height="900"
          />
          <figcaption>My sign-in methods, a real screenshot of the dashboard. The username is an example.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Issue a one-time reset link for a user who forgot the password.</strong> An admin opens <em>Settings > Users</em>
        and chooses <em>Issue reset link</em> on the user's row. The button is available while username and password sign-in is
        on. Choose <em>Create link</em>, then <em>Copy link</em>. The link is shown only once, and it works once, for 24 hours.
        Share it with the user. The user opens it, sees <em>Set a new password for</em> their name, enters a password of 12 to
        128 characters, and chooses <em>Set password and sign in</em>. Signing in there ends the user's other sessions. A new
        link replaces the earlier unused ones.
        <figure>
          <img
            src="/images/signin-shot-09-reset-link.png"
            alt="The Reset link for Sam Example dialog. The Password reset link field is blurred, and a note says the link works once until a date and is shown only now. Copy link and Done are below it."
            width="420"
            height="900"
          />
          <figcaption>The one-time reset link dialog, a real screenshot. The link is blurred: it is shown once and works once.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Turn a method off safely.</strong> On Settings > Sign-in methods, switch the method off. TaleArt refuses a change
        that would leave an admin with no way to sign in, and says so: <em>That would leave an admin with no way to sign in.
        Every admin needs a passkey, a password, or a linked provider that is on. Give each admin one of those first, then try
        again.</em> It also refuses to turn off the last method on, with <em>Keep at least one sign-in method on. Turn another
        method on first.</em> Deleting a provider that sign-in depends on is refused the same way. Turn the new method on, check
        that each admin signs in with it, and only then turn the old one off.
        <figure>
          <img
            src="/images/signin-shot-10-lockout.png"
            alt="The Sign-in methods page with the passkey switched off. A red message reads: That would leave an admin with no way to sign in. Every admin needs a passkey, a password, or a linked provider that is on."
            width="1000"
            height="900"
          />
          <figcaption>The lock-out guard, a real screenshot of the dashboard. TaleArt refuses to turn the passkey off when no admin keeps another usable method.</figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="notes">Notes</h2>
    <ul>
      <li>Registration stays by invitation, plus the first admin on an empty install. There is no open sign-up.</li>
      <li>A provider's redirect URI is always <code>PUBLIC_API_URL</code> plus <code>/api/v1/auth/callback/</code> and the slug.</li>
      <li>API tokens are unchanged: a script still calls the Management API with its token, and sign-in methods are never reached with a token.</li>
    </ul>
  `,
})
export class SignInMethodsGuidePage {
  protected readonly keySample = KEY_SAMPLE;
  protected readonly setupPasswordSample = SETUP_PASSWORD_SAMPLE;
  protected readonly redirectSample = REDIRECT_SAMPLE;
}
