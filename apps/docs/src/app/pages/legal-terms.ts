import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-legal-terms',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Terms of service</h1>
    <p class="lede">
      These terms say how you may use the TaleArt documentation site, the TaleArt software and the SDKs, and any
      TaleArt workspace you are invited to. Version of 31 October 2026.
    </p>
    <p class="muted">
      The owner wrote these texts personally. They are not legal advice, and the owner may have them reviewed by a lawyer
      later. If you do not agree with them, do not use TaleArt.
    </p>

    <h2 id="about">1. Who offers TaleArt</h2>
    <p>
      TaleArt is a one-person, unfunded, non-commercial project by Ido Lempert, an individual developer in Israel
      ("the owner", "we"). TaleArt is software for showing tales (stories and promo banners) on a website or in an app.
      It is self-hosted: whoever runs the dashboard and the API (the "operator") decides who may sign in, and keeps the
      data. The owner runs the documentation site at taleart.lempert.site, publishes the software and the SDKs, and may
      run workspaces for the owner's own use or for people the owner invites. In these terms, "the Service" means those three things. The
      owner is not a company and has no employees or support organisation.
    </p>

    <h2 id="who-may-use">2. Who may use it</h2>
    <ul>
      <li>
        You must be at least 18 years old, or have the permission of a parent or guardian, and be able to enter into
        a binding agreement. If you use TaleArt for an organisation, you confirm that you may bind it.
      </li>
      <li>
        Workspaces are by invitation only. You may sign in to a workspace only with an invitation from, or an account
        made by, its operator. An invitation is personal and expires; do not pass it on.
      </li>
      <li>
        Reading the documentation and using the published SDKs in your own site or app needs no account.
      </li>
      <li>You must follow the law that applies to you, including privacy, consumer and advertising law.</li>
    </ul>

    <h2 id="licence">3. Software licence and third-party notices</h2>
    <p>
      The source code, including the Web SDK, the Android SDK and the iOS SDK, is licensed under the Apache License,
      version 2.0. The licence text is the
      <a href="https://github.com/ido-lempert/Taleart/blob/main/LICENSE">LICENSE file</a> in the repository. That
      licence, and not these terms, governs copying, changing and redistributing the code. These terms govern your use
      of the documentation site and of any workspace the owner runs.
    </p>
    <p>
      TaleArt includes and depends on third-party components, which keep their own licences. Their notices are in the
      repository, for example in the
      <a href="https://github.com/ido-lempert/Taleart/tree/main/apps/docs/public/swagger-ui">Swagger UI folder</a>
      the API reference uses, and in the package metadata of each dependency. The names, logos and marks of other
      companies belong to their owners.
    </p>

    <h2 id="accounts-and-keys">4. Accounts, keys and tokens</h2>
    <ul>
      <li>
        Keep your sign-in methods (passkey, password, or an external provider account) and your API tokens, site keys
        and zone keys safe. You are responsible for what is done with them, and you must tell the operator if one is
        lost or misused.
      </li>
      <li>
        A zone key is a credential for reading its zone and is meant to be visible in a page or app: anyone who sees
        it can read what the zone shows. Do not put anything secret in a tale.
      </li>
      <li>Give accurate account information and do not share one account between several people.</li>
    </ul>

    <h2 id="acceptable-use">5. Acceptable use</h2>
    <p>You may not use TaleArt to:</p>
    <ul>
      <li>break the law, or help someone else to;</li>
      <li>
        show or store content that is unlawful, defamatory, hateful, sexually exploitative (including any content
        involving minors), infringing on others' rights, deceptive, or that spreads malware or phishing;
      </li>
      <li>
        try to get into accounts, workspaces or data that are not yours, probe or test the security of a workspace you
        do not operate, or get around the access checks and rate limits;
      </li>
      <li>
        send traffic that is meant to, or does, disturb the service (floods, scraping at a high rate, automated
        sign-up attempts);
      </li>
      <li>
        collect personal data of viewers in a way the law or the viewers' platform rules do not allow, or use the
        external user ID or the viewer properties for profiling that your own privacy notice does not cover;
      </li>
      <li>pretend to be the owner or to speak for the project.</li>
    </ul>

    <h2 id="customer-content">6. Your content and your end-users</h2>
    <p>
      You keep the rights to the images, video, text, fonts and other content you upload or write in TaleArt (your
      "content"). You give the operator the permission needed to store it, process it and deliver it to your viewers
      for the purpose of running your zones.
    </p>
    <ul>
      <li>
        You alone are responsible for your content: that you own it or have the right to use it, that it is lawful,
        and that it is accurate. The owner does not review content and is not responsible for it.
      </li>
      <li>
        Tale media is delivered from public addresses so that viewers can see it. Do not upload anything private.
      </li>
      <li>
        If you place a TaleArt zone on your site or in your app, <strong>you</strong> are the controller of your
        end-users' data. You must tell them what is collected (see the
        <a routerLink="/legal/privacy" fragment="sdk">Privacy policy</a> for what the SDKs store and send), have a legal basis,
        and obtain any consent that your law or your platform's rules require before the SDK stores an identifier on
        a device or sends an analytics event. You can turn analytics off in the SDK.
      </li>
      <li>
        Use only opaque external user IDs. Do not send e-mail addresses, phone numbers, health, financial or other
        sensitive data as an ID or as a viewer property.
      </li>
    </ul>
    <p>
      The owner may remove content or suspend a workspace that the owner reasonably believes breaks these terms or the law,
      with or without notice, and may report unlawful content to the authorities.
    </p>

    <h2 id="no-warranty">7. No warranty</h2>
    <p>
      TaleArt is free and is provided <strong>"as is" and "as available"</strong>, without any promise of any kind,
      express or implied, to the maximum extent permitted by law. That includes any promise of fitness for a purpose,
      merchantability, accuracy, security, non-infringement, uninterrupted or error-free operation, or that a tale
      will always be shown. Parts of TaleArt are marked as not yet tested on devices (see the project's README), and
      the software may contain mistakes. You use it at your own risk and are responsible for testing it, and for
      backing up your content and data.
    </p>

    <h2 id="availability">8. No availability guarantee, no support</h2>
    <p>
      The owner does not promise that the documentation site, a workspace, the API or the SDK download will be
      available at any time, that they will be kept up to date, or that any feature will continue to exist. The owner
      may change, limit or stop any part of TaleArt at any time. Support is given, if at all, through
      <a href="https://github.com/ido-lempert/Taleart/issues">GitHub issues</a>, as time allows. Do not rely on TaleArt
      for anything where an outage, a wrong tale or a lost tale could cause harm or serious loss.
    </p>

    <h2 id="liability">9. Limitation of liability</h2>
    <p>
      To the maximum extent permitted by law, the owner is not liable to you or to anyone else for any indirect,
      incidental, special, consequential or punitive damage, or for loss of profit, revenue, business, data,
      goodwill or reputation, however caused and whatever the legal theory (contract, tort including negligence, or
      otherwise), even if the owner was told it could happen. To the maximum extent permitted by law, the owner's total
      liability for all claims relating to TaleArt is limited to the amount you paid the owner for it in the twelve
      months before the claim. Because TaleArt is free, that amount is zero.
    </p>
    <p>
      Nothing in these terms excludes or limits liability that cannot be excluded or limited by law, such as liability
      for intentional harm or for gross negligence where the law does not allow it to be excluded. If you are a
      consumer and the law of your country gives you rights that cannot be waived, these terms do not take them
      away; they apply to the extent the law permits.
    </p>
    <p>
      To the extent permitted by law, you will cover the owner for any claim, loss or cost (including reasonable legal
      fees) that a third party brings against the owner because of your content, your use of TaleArt in breach of these
      terms, or your own handling of your end-users' data.
    </p>

    <h2 id="termination">10. Suspension and termination</h2>
    <p>
      You may stop using TaleArt at any time. The owner, or the operator of a workspace, may suspend or end your
      access at any time, for example if you break these terms, if the account is inactive, if it is needed for
      security, or if the owner stops the service. After that, sections that by their nature continue (your
      responsibility for your content, no warranty, liability, governing law) continue to apply. See the
      <a routerLink="/legal/privacy" fragment="retention">Privacy policy</a> for what happens to data.
    </p>

    <h2 id="changes">11. Changes to these terms</h2>
    <p>
      The owner may change these terms. The current version, with its date, is always on this page, and earlier
      versions are in the repository's history on GitHub. A change applies from the date shown. If you keep using
      TaleArt after that date, you accept the new version; if you do not accept it, stop using TaleArt. For a change
      that is materially worse for account holders, the owner will put a notice on the dashboard sign-in page or on
      this site before it applies.
    </p>

    <h2 id="governing-law">12. Governing law and courts</h2>
    <p>
      These terms and any dispute about TaleArt are governed by the laws of the State of Israel, without regard to its
      rules on conflict of laws. The competent courts in Israel have exclusive jurisdiction, except where a mandatory
      consumer-protection rule of your country gives you the right to go to a court there, or to rely on that
      country's law. Please contact the owner first and give the owner a chance to settle the matter.
    </p>

    <h2 id="general">13. General</h2>
    <p>
      If a part of these terms is found invalid, the rest stays in force. Not enforcing a part is not a waiver of it.
      These terms, with the <a routerLink="/legal/privacy">Privacy policy</a> and the Apache License, are the whole
      agreement between you and the owner about TaleArt. You may not transfer your rights under them; the owner may
      transfer the owner's rights to someone who takes over the project.
    </p>

    <h2 id="contact">14. Contact</h2>
    <p>
      The contact for everything in these terms is the project's
      <a href="https://github.com/ido-lempert/Taleart/issues">GitHub issues</a>. Please do not post secrets, personal
      data or security details in a public issue: open an issue that asks for a private way to talk, and the owner will
      answer there. See also the <a routerLink="/legal/privacy">Privacy policy</a> and the
      <a routerLink="/legal/accessibility">Accessibility statement</a>.
    </p>
  `,
})
export class LegalTermsPage {}
