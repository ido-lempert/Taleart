# Plan: legal pages (terms of service, privacy policy, accessibility statement)

Ticket 17 in `tickets.toml`. Added at the owner's request on 2026-10-31 so that the owner is not exposed to claims,
demands or lawsuits by accident.

## Decision (2026-10-31)

The owner decided not to wait for a lawyer: the project is unfunded, non-profit for now and run by one person, and the
goal is that the owner is not exposed to claims by accident. The agent wrote the three texts from what the code does.
They are the owner's best-effort texts, not legal advice, and the owner may have them reviewed later.

Assumptions for the owner to confirm: the owner is named as an individual (Ido Lempert); the governing law and courts are
those of the State of Israel; the only contact is GitHub issues (no e-mail address or phone is published).

## Content covered

- **Terms of service:** who may use the product, acceptable use, accounts and keys, no warranty, limitation of liability,
  termination, governing law, changes to the terms, the SDK licence (Apache-2.0) and third-party notices.
- **Privacy policy:** what the dashboard, the API and the SDKs collect (account data, analytics events, external user ID in a
  header, viewer properties kept on the device and never sent to the server, visitor ID), roles of controller and processor,
  retention and deletion, cookies and local storage in the Web SDK and the native SDKs, sub-processors, user rights, contact.
- **Accessibility statement:** the conformance target (WCAG 2.2 AA), the real results of the a11y checks, known gaps, how to
  report a problem and the response time.
- **Disclaimers:** no guarantee of availability, content responsibility sits with the customer, the customer is responsible
  for consent to analytics in their own app.

## Where it appears

- Dashboard sign-in, setup, invitation and password reset pages (a line with links to the Terms and the Privacy policy).
- Docs site footer and a docs page per text; Web SDK README; npm, Maven POM and Swift package pages.

## Done when

The verify line of ticket 17 holds. Pages: `apps/docs/src/app/pages/legal-terms.ts`, `legal-privacy.ts` and `legal-accessibility.ts`.
