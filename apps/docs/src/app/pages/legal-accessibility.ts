import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-legal-accessibility',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Accessibility statement</h1>
    <p class="lede">
      TaleArt aims for WCAG 2.2 level AA. This page says what that covers, what the project's own checks show, what is
      known to fall short, and how to report a problem. Statement of 31 October 2026.
    </p>
    <p class="muted">
      This is a self-assessment by the owner, a single developer. No independent audit has been done, and the text is
      not legal advice.
    </p>

    <h2 id="target">1. Target and status</h2>
    <p>
      The target is the Web Content Accessibility Guidelines (WCAG) 2.2, level AA. TaleArt is <strong>partially
      conformant</strong>: the automated checks below pass, some criteria cannot be checked by a script and have been
      checked by hand only on some screens, and the known gaps in <a routerLink="/legal/accessibility" fragment="gaps">section 4</a> remain.
    </p>

    <h2 id="scope">2. What is covered</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Coverage table">
      <table>
        <caption class="visually-hidden">Parts of TaleArt and how their accessibility is checked</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Checks in the repository</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>This documentation site</td>
            <td>
              An axe-core scan for WCAG 2.0, 2.1 and 2.2 A and AA rules on every docs page, in the light and the dark
              theme, in Chromium. Also the API reference with an operation open, tried, and the Authorize dialog open,
              and a check that the API reference reflows at 320 CSS px.
            </td>
          </tr>
          <tr>
            <td>The dashboard (including Tale Studio)</td>
            <td>
              A scan (<code>dashboard-e2e</code>, <code>a11y</code>) that signs in, builds a zone with tale groups in
              each state and scans every screen with axe-core plus targeted checks for focus visible (2.4.7), focus not
              obscured (2.4.11), target size (2.5.8), reflow at 320 px (1.4.10) and text spacing (1.4.12). Further
              end-to-end tests drive Tale Studio by keyboard.
            </td>
          </tr>
          <tr>
            <td>Web SDK (the bar, banner, viewer and interactive components)</td>
            <td>
              Unit tests for the design rules below (target size, contrast, right-to-left layout, reduced motion).
              There is no automated axe scan of the SDK's output on a customer page, because the page around it is the
              customer's.
            </td>
          </tr>
          <tr>
            <td>Android SDK and iOS SDK (the same shared Compose code)</td>
            <td>
              Compose UI tests of the viewer, bar, banner and components, which check semantics, sizes and layout
              direction in part. There is no automated accessibility scanner for native screens.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="results">3. What the checks show</h2>
    <ul>
      <li>
        <strong>Documentation site:</strong> every docs page, including the three legal pages, has no violation of the
        axe-core WCAG 2.2 AA rules in the light and the dark theme in Chromium, when this statement was written.
      </li>
      <li>
        <strong>Dashboard:</strong> the scan above is part of the repository and is meant to be run before a release. It
        was not run again for this statement, so this statement makes no claim about its latest result.
      </li>
      <li>
        <strong>Contrast.</strong> The design rule for the SDK is text at 4.5:1 or better on any background. Text on an
        accent colour picks white or dark automatically. The docs and the dashboard use text and focus colours that
        axe-core accepts in both themes.
      </li>
      <li>
        <strong>Target size.</strong> The web viewer's controls are 44 px; its dots are 24 px targets. The bar layouts set a
        44 px minimum height. The native viewer's controls are 48 dp targets with a 44 dp visible disc. The dashboard
        is checked for the 24 by 24 px minimum of WCAG 2.2 criterion 2.5.8.
      </li>
      <li>
        <strong>Right-to-left.</strong> The web SDK uses logical CSS properties, mirrors arrows, progress and carousels,
        and keeps numbers, percentages and countdown digits left-to-right. The native SDK uses the platform's layout
        direction. The Android guide shows a Hebrew right-to-left viewer.
      </li>
      <li>
        <strong>Motion.</strong> The motion in the viewer, bar and components stops under
        <code>prefers-reduced-motion</code> on the web and under the Reduce Motion setting on iOS. On Android the SDK
        follows the system's "Remove animations" setting (animation scale off).
      </li>
      <li>
        <strong>Screen reader actions.</strong> The Rating component has a "Send rating" action that a screen reader
        user can run without dragging; the viewer announces the tale's progress in a polite live region on the web.
      </li>
      <li>
        <strong>Keyboard.</strong> The docs site has a skip link, a labelled landmark structure, visible focus, a menu
        button that works by keyboard, and moves focus to the page heading after a navigation. The dashboard's menus,
        tabs, switches and reordering are checked by keyboard in the scan above.
      </li>
    </ul>

    <h2 id="gaps">4. Known gaps</h2>
    <p>These are known, and the owner does not claim otherwise:</p>
    <ul>
      <li>
        <strong>No real screen reader testing on devices.</strong> TalkBack on Android and VoiceOver on iOS were not
        used to walk the native SDKs. The Web SDK and the dashboard were not walked with NVDA, JAWS or VoiceOver
        either. Semantics are set in the code and unit tested, but how they sound has not been verified.
      </li>
      <li>
        <strong>Automated checks run in Chromium only.</strong> Firefox, Safari and mobile browsers are not scanned.
      </li>
      <li>
        <strong>Native sizes and contrast are not measured on devices.</strong> The Android and iOS SDKs have been
        run on the Android emulator and the iOS simulator, not on a range of physical devices. The frosted backdrop blur behind the viewer
        controls is not drawn natively, so a plain translucent disc is used there, and its contrast was not measured
        on real media.
      </li>
      <li>
        <strong>The desktop viewer shows neighbouring tale groups</strong> beside the current one. Those neighbours are
        not scanned separately from the current tale, and their reading order has not been checked with a screen
        reader.
      </li>
      <li>
        <strong>Android Reduce Motion is all or nothing.</strong> The Android SDK reduces motion only when the system's
        animation scale is switched fully off. A reduced but non-zero scale does not change the SDK's motion.
      </li>
      <li>
        <strong>Customers' content.</strong> A tale is the customer's images, video, text and colours. TaleArt cannot
        write alternative text, captions, transcripts or good contrast for them. The customer is responsible for the
        content, and for running the SDK in a way that fits their own accessibility duties.
      </li>
      <li>
        <strong>The API reference</strong> uses the third-party Swagger UI. It passes the scan and was patched to label
        its controls, but it is not as polished as the rest of the site.
      </li>
      <li>
        <strong>Limited criteria by hand.</strong> Criteria that scripts cannot judge (meaningful sequence, consistent
        help, clear error text, drag alternatives) have been checked by hand on some screens only.
      </li>
    </ul>

    <h2 id="report">5. Report a problem</h2>
    <p>
      If something in the docs, the dashboard or an SDK is hard or impossible to use with your assistive technology, please
      open an issue at <a href="https://github.com/ido-lempert/Taleart/issues">GitHub issues</a> with the title
      "Accessibility", the page or screen, what you tried, the browser or device, and the assistive technology you
      use. Do not put personal data in a public issue.
    </p>
    <p>
      The owner will try to acknowledge a report within 14 days and to fix real barriers as time allows. This is a
      best-effort project with a single maintainer, so no fixed response time is promised. If you do not get a
      satisfactory answer, you may contact the relevant authority in your country (in Israel, the Commission for Equal
      Rights of Persons with Disabilities).
    </p>

    <h2 id="date">6. Date</h2>
    <p>
      This statement was written on 31 October 2026, from the code and tests in the repository on that date. See also
      the <a routerLink="/legal/terms">Terms of service</a> and the <a routerLink="/legal/privacy">Privacy policy</a>.
    </p>
  `,
})
export class LegalAccessibilityPage {}
