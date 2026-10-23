---
type: epic
title: "Native mobile: the Taller app and SDK show zones on Android and iOS"
parent: initiative-taleart
id: 9
covers: [R9, R11, R13]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md]
after: []
refined: true
risk: medium
---

# Native mobile: the Taller app and SDK show zones on Android and iOS

## Description

Native iOS and Android were post-MVP; the owner started them on 2026-10-23. They read the same dashboard-defined data through the same Delivery API as the Web SDK (site key plus zone slug), with no model change.

Owner direction (2026-10-23):
- Start from the latest Kotlin Multiplatform wizard (https://kmp.jetbrains.com/?android=true&ios=true&iosui=compose&includeTests=true) or the JetBrains GitHub template, not hand-written Gradle.
- Package name `site.lempert.taleart` (app `site.lempert.taleart.taller`, SDK `site.lempert.taleart.sdk`).
- One shared Compose Multiplatform UI for Android and iOS.

`apps/taller` is the sample host app (the native `sdk-sample`); `libs/mobile-sdk` holds the shared SDK (client, models, Compose UI); `libs/android-sdk` and `libs/ios-sdk` are the thin platform entry points.

## Outcome

A developer adds the SDK to an Android or iOS app with a site key and a zone slug and sees the same tale groups and tales the Web SDK shows on the sample page, in the same bar or banner display, with the same visibility rule.
