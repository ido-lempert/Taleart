# 5. Android SDK

Status: **reviewed against the source, not run on a device or emulator.** The sample steps below come from the KDoc in `libs/android-sdk/src/main/kotlin/site/lempert/taleart/sdk/android/TaleartView.kt`. This guide does not give Maven coordinates because no published artifact was confirmed.

`TaleartView` is the Android counterpart of `<taleart-view>`. It shows a zone (bar or banner) and opens the full-screen tale viewer in a dialog when a group is tapped.

## From XML
Attributes: `app:taleartApiUrl`, `app:taleartSiteKey`, `app:taleartZone`.

## From code
Set `apiUrl`, `siteKey` and `zone` (or call `configure`). The view reads the zone once all three are set, and again when one changes or `reload()` is called. Set `opensViewer = false` and use `onGroupClickListener` to handle taps yourself.

## Requirements and notes
- It needs a ViewTreeLifecycleOwner: an `AppCompatActivity`, `ComponentActivity` or `Fragment` provides one. Without one it draws nothing and logs a warning.
- Width fills the parent; height is `wrap_content`.
- The visitor id lives in the `taleart-sdk` SharedPreferences. To get a fresh id after reinstall, exclude `sharedpref/taleart-sdk.xml` in Android backup rules.
- Use the API's public HTTPS URL and the project's site key from the dashboard Install tab.
