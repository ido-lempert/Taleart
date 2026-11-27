---
tracker_id: ""
id: 0
type: story
title: "Dark mode on the user profile: the appearance follows the device by default"
parent: none
covers: []
sources: []
companions: []
after: []
assignee: ""
refined: false
hitl: false
risk: low
---

## Description

A signed-in user can set the dashboard's appearance on their profile: System (the default), Light or Dark. Until they choose, the dashboard follows the appearance of their device, so a user whose system is in dark mode sees the dark dashboard without touching any setting.

## Requirements

1. **Appearance choice** (R1)
   **Given** a signed-in user on the profile page
   **When** they open the Appearance control
   **Then** it offers System, Light and Dark, with System selected for a user who has not chosen
   **And** choosing one applies it at once

2. **Device default** (R2)
   **Given** the appearance is System
   **When** the device is in dark appearance, and then changes to light
   **Then** the dashboard shows dark, then light, without a reload
   **And** a user who has never chosen sees this with no action

3. **Explicit choice wins and persists** (R3)
   **Given** the user chose Light or Dark
   **When** the device setting differs, and the user reloads or signs in again on the same account
   **Then** the chosen appearance is shown, not the device's

4. **Dark covers the dashboard** (R4)
   **Given** Dark is in effect
   **When** the dashboard shell and the profile page are shown
   **Then** every text and control meets WCAG AA contrast (4.5:1 for text) and no page area stays light

## Constraints

- The appearance is per user, not per project: the project's tale and zone theme (the Management API's theme, the Web SDK) is not changed by it.

## Done when

- A user whose device is in dark appearance, with no setting chosen, sees the dark dashboard on first visit.
- Choosing Light on a dark device shows Light and still shows Light after reload.
- The appearance is stored on the user's account, so a second device signed in as the same user shows the same choice.

## Boundaries

- Out: the project theme of tales and zones, the Web SDK and native SDKs, the docs site, and emails.
- Out: a per-device-only setting (unless the open question below says so).

## References

- parent — none (standalone; not yet placed in an epic)

## Notes

- Decision (2026-11-27): "user profile" means the signed-in dashboard account/profile page, not a visitor's profile in the Web SDK or Tale Studio.
- Decision (2026-11-27): the choice is stored on the user's account on the server, so it follows the user across devices; localStorage alone is not enough.
- Decision (2026-11-27): standalone backlog item, not an epic under the initiative.
