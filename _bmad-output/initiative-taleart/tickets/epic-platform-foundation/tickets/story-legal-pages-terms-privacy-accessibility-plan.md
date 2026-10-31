# Plan: legal pages (terms of service, privacy policy, accessibility statement)

Ticket 17 in `tickets.toml`. Added at the owner's request on 2026-10-31 so that the owner is not exposed to claims,
demands or lawsuits by accident.

## Owner's part (cannot be done by the model)

- Engage a qualified lawyer for the owner's jurisdiction; they approve every text before it is published.
- Decide the legal entity name, the jurisdiction, the contact address and the support e-mail that the texts name.

## Content to cover (outline for the lawyer, not legal advice)

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

- Dashboard sign-in and registration pages (links and acceptance where the lawyer requires it).
- Docs site footer and a docs page per text; Web SDK README; npm, Maven POM and Swift package pages.

## Done when

The lawyer has approved the texts, and the verify line of ticket 17 holds.
