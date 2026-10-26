# 6. iOS SDK

Status: **reviewed against the source, not run on a device or simulator.** Steps come from the KDoc in `libs/ios-sdk/src/iosMain/kotlin/site/lempert/taleart/sdk/ios/TaleartViewController.kt`. This guide does not give a package or framework name because no published artifact was confirmed.

`TaleartZoneView` shows the zone with slug `zone`, read from `apiUrl` with the project's `siteKey`.

```swift
let zone = TaleartZoneView(apiUrl: url, siteKey: key, zone: "home-top")
// embed zone.viewController as a child view controller,
// or wrap it in UIViewControllerRepresentable for SwiftUI
```

## Notes
- Keep the `TaleartZoneView` object as long as its view controller.
- `reload()` reads the zone again and keeps the display on screen until the new one arrives.
- The bar scrolls sideways (at most 126 points tall). The banner's height follows its width and aspect ratio. `height` and `onHeightChange` tell you the current size so you can size the container.
- A tap on a group opens the full-screen viewer modally over the top view controller; Close or a swipe down dismisses it. Set `opensViewer` to false to handle taps yourself.
- The visitor id is stored in the `taleart-sdk` NSUserDefaults suite.
