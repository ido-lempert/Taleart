---
type: epic
title: "Two-factor authentication with authenticator apps"
parent: initiative-taleart
covers: []
sources:
  - _bmad-output/initiative-taleart/sign-in-methods/spec.md
companions: []
after: []
refined: false
risk: medium
---

# Two-factor authentication with authenticator apps

## Description

An admin can require a second sign-in step for password and provider accounts: a one-time code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy, and any RFC 6238 app), or a recovery code. Passkey sign-in stays as it is. This epic adds 2FA to the sign-in methods in `sign-in-methods/spec.md`.

## Outcome

A team that signs in with a password or a provider can protect its install with a second step that works with the authenticator app they already use, and an admin can decide per install whether it is off, optional, or required.

## Requirements

- R14 (owner request): a user with a password, or who signs in by an external provider, adds an authenticator app by scanning a QR code (the manual key stays available as the fallback). Self-service: the user does it on their own account. Shows it was met: enrolment completes only after a current code from the app is entered; a wrong code is refused.
- R15 (owner request): on completing enrolment the user sees ten single-use recovery codes once. Shows it was met: each code signs in once, and regenerating the set invalidates the earlier codes.
- R16 (owner request): password and provider sign-in for an account with 2FA creates a session only after a current code or an unused recovery code. Shows it was met: a correct password alone does not sign in; a current code does.
- R17 (owner request): passkey sign-in is unchanged. Shows it was met: a passkey sign-in never asks for a code, before or after this epic.
- R18 (owner request): an admin sets 2FA per install to off, optional, or required. Shows it was met: each setting takes effect at the next sign-in, with no restart.
- R19 (owner request): a user disables 2FA on their own account after a current code or a recovery code. Self-service, so no admin reset in this epic. Shows it was met: after disabling, a password sign-in needs no code.

## Constraints

- Second-step secrets are encrypted with `TALEART_SECRET_KEY`, as provider secrets are. Losing that key means users must enrol again.
- Recovery codes are stored only as hashes.
- A TOTP code (RFC 6238, SHA-1, 6 digits, 30-second step) is accepted once per window, and one step of clock tolerance is allowed either side.
- A failed second-step code counts toward the same per-username throttle as a wrong password.
- No SMS or email codes: the product has no mail sender.

## Done when

- A user who signs in with a password enrols an authenticator app, signs out, and signs in with a code from that app.
- A recovery code signs in once and then is refused.
- A passkey sign-in works exactly as before, with no code asked.
- An admin switches the install between off, optional, and required, and the change applies to the next sign-in.

## Boundaries

- Out: SMS codes, email codes, WebAuthn or passkeys as a second factor, remember-this-device.
- Out: cloud backup of authenticator secrets; they live only in the database, encrypted.
- Must not change: passkey sign-in, invitation redemption, the invitation rules.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`; new requirement ids R14 to R19 extend its numbering and need adding there when this epic is adopted.
- sign-in-methods — `_bmad-output/initiative-taleart/sign-in-methods/spec.md`, sections Methods, Accounts and identities, Provider flow (the password and provider rules this extends).

## Notes

- Open question: in required mode, are existing password or provider users who have not enrolled blocked at sign-in until they enrol, or prompted after sign-in? Answer: the owner decides; the sign-in spec does not say.
- Decision (2026-11-26): 2FA is self-service; an admin does not reset a user's 2FA in this epic. Enrolment uses a QR code.
- Assumption: R14 to R19 extend the initiative's numbering after R13.
- Unknown: the epic's position in `tickets.toml` (build order) is not set; it waits on the owner's call.
