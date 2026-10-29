/**
 * The content the native guides (Android, iOS) and their SDK references share: the hooks, the
 * configuration fields, the string keys and the side-by-side mapping with the Web SDK. Reference rows
 * are data here, and the specs in native-docs.spec.ts check them against the Kotlin and XML sources,
 * so a method, field or string key added to the SDK fails a test until the docs name it.
 *
 * The publishing coordinates are the target, not yet live: Maven Central `site.lempert.taleart`
 * (android-sdk, mobile-sdk) and the GitHub release of ido-lempert/Taleart with the iOS XCFramework,
 * all at version 0.1.0.
 */

export const NATIVE_VERSION = '0.1.0';
export const ANDROID_COORDINATES = `site.lempert.taleart:android-sdk:${NATIVE_VERSION}`;
export const ANDROID_MOBILE_COORDINATES = `site.lempert.taleart:mobile-sdk:${NATIVE_VERSION}`;

/** The figures' and the page's shared styles: one figure per guide step, with its alt text and caption. */
export const NATIVE_STYLES = [
  `.native-figure { margin: 14px 0 6px; }
   .native-figure img { display: block; width: 100%; max-width: 800px; height: auto; border: 1px solid #c3cbd9; border-radius: 8px; }
   .native-figure figcaption { font-size: 0.9em; margin-top: 4px; }
   .steps > li { margin-bottom: 18px; }
   .steps > li > p:first-child { margin-top: 0; }`,
];

// ---------- Code ----------

export const GRADLE_KTS = `dependencies {
    implementation("${ANDROID_COORDINATES}")
}`;

export const GRADLE_GROOVY = `dependencies {
    implementation '${ANDROID_COORDINATES}'
}`;

export const MANIFEST_INTERNET = `<uses-permission android:name="android.permission.INTERNET" />`;

export const XML_LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <site.lempert.taleart.sdk.android.TaleartView
        android:id="@+id/taleart_top"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        app:taleartZoneKey="tak_YOUR_ZONE_KEY" />

</LinearLayout>`;

export const COMPOSE_ZONE = `import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxWidth
import site.lempert.taleart.sdk.ui.TaleartZone

@Composable
fun HomeScreen() {
    Column {
        TaleartZone(
            apiUrl = "",                       // empty: the API URL set in TaleartSdk.init
            zoneKey = "tak_YOUR_ZONE_KEY",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}`;

export const APPLICATION_INIT = `import android.app.Application
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartSdk

class TaleartApp : Application() {
    override fun onCreate() {
        super.onCreate()
        TaleartSdk.init(
            TaleartConfig(
                apiUrl = "https://api.example.com",
            ),
        )
    }
}`;

export const MANIFEST_APPLICATION = `<application
    android:name=".TaleartApp"
    ... >`;

export const ANDROID_HOOKS = `import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener

class AppHooks(private val router: AppRouter) : TaleartListener {
    override fun onLoaded(event: TaleartEvent) {
        // The zone with the key prefix event.zoneKeyPrefix is on screen.
    }

    override fun onActionClicked(event: TaleartEvent): Boolean {
        val url = event.url ?: return false
        if (!url.startsWith("https://shop.example.com/")) return false
        router.open(url)   // your own navigation
        return true        // handled: the SDK does not open the browser
    }
}

// In Application.onCreate, next to apiUrl:
//     TaleartConfig(apiUrl = "https://api.example.com", listener = AppHooks(router))`;

export const ANDROID_LOCALE = `TaleartSdk.init(
    TaleartConfig(
        apiUrl = "https://api.example.com",
        locale = "he-IL",
        strings = mapOf(
            "he" to mapOf(
                "viewer.close" to "סגור",
                "bar.seen" to "{name}, נצפה",
            ),
        ),
    ),
)

// One view only:
// TaleartZone(apiUrl = "", zoneKey = "tak_…", locale = "he-IL", strings = mapOf("he" to mapOf("viewer.close" to "סגור")))`;

export const BACKUP_RULES_OLD = `<full-backup-content>
    <exclude domain="sharedpref" path="taleart-sdk.xml" />
</full-backup-content>`;

export const BACKUP_RULES_NEW = `<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="taleart-sdk.xml" />
    </cloud-backup>
</data-extraction-rules>`;

export const SWIFT_PACKAGE = `// Xcode: File > Add Package Dependencies, then enter the repository URL.
// Or in a Package.swift:
dependencies: [
    .package(url: "https://github.com/ido-lempert/Taleart", from: "${NATIVE_VERSION}"),
],
targets: [
    .target(name: "MyApp", dependencies: [
        .product(name: "TaleartSDK", package: "Taleart"),
    ]),
],`;

export const SWIFT_UIKIT = `import UIKit
import TaleartSDK

final class HomeViewController: UIViewController {
    private let zone = TaleartZoneView(apiUrl: nil, zoneKey: "tak_YOUR_ZONE_KEY")
    private var heightConstraint: NSLayoutConstraint?

    override func viewDidLoad() {
        super.viewDidLoad()
        let bar = zone.viewController
        addChild(bar)
        bar.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar.view)
        let height = bar.view.heightAnchor.constraint(equalToConstant: 0)
        heightConstraint = height
        NSLayoutConstraint.activate([
            bar.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            height,
        ])
        zone.onHeightChange = { value in height.constant = CGFloat(value) }
        bar.didMove(toParent: self)
    }
}`;

export const SWIFTUI_REPRESENTABLE = `import SwiftUI
import TaleartSDK

struct ZoneBar: UIViewControllerRepresentable {
    let zoneKey: String
    @Binding var height: CGFloat

    // The zone object must live as long as the view controller: the coordinator keeps it.
    func makeCoordinator() -> Coordinator { Coordinator(zoneKey: zoneKey) }

    func makeUIViewController(context: Context) -> UIViewController {
        let zone = context.coordinator.zone
        let height = $height
        zone.onHeightChange = { value in DispatchQueue.main.async { height.wrappedValue = CGFloat(value) } }
        return zone.viewController
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Coordinator {
        let zone: TaleartZoneView
        init(zoneKey: String) { zone = TaleartZoneView(apiUrl: nil, zoneKey: zoneKey) }
    }
}

struct HomeView: View {
    @State private var barHeight: CGFloat = 0

    var body: some View {
        VStack {
            ZoneBar(zoneKey: "tak_YOUR_ZONE_KEY", height: $barHeight)
                .frame(height: barHeight)
            Spacer()
        }
    }
}`;

export const SWIFT_INIT = `import SwiftUI
import TaleartSDK

@main
struct MyApp: App {
    init() {
        TaleartSdk.shared.doInit(config: TaleartConfig(
            apiUrl: "https://api.example.com",
            locale: "he-IL",
            strings: ["he": ["viewer.close": "סגור", "bar.seen": "{name}, נצפה"]],
            stringsForEveryLocale: [:],
            listener: AppTaleartHooks(),
            externalUserId: nil,
            tags: []
        ))
    }

    var body: some Scene {
        WindowGroup { HomeView() }
    }
}

// UIKit: the same call in application(_:didFinishLaunchingWithOptions:) of your AppDelegate.`;

export const SWIFT_HOOKS = `import TaleartSDK

final class AppTaleartHooks: TaleartListenerBase {
    override func onLoaded(event: TaleartEvent) {
        print("zone \\(event.zoneSlug) loaded")
    }

    override func onActionClicked(event: TaleartEvent) -> Bool {
        guard let url = event.url, url.hasPrefix("https://shop.example.com/") else { return false }
        AppRouter.shared.open(url)   // your own navigation
        return true                  // handled: the SDK does not open the browser
    }
}`;

export const SWIFT_LOCALE = `// At launch (the config above), or for one zone:
let zone = TaleartZoneView(apiUrl: "https://api.example.com", zoneKey: "tak_YOUR_ZONE_KEY")
zone.locale = "he-IL"
zone.strings = ["he": ["viewer.close": "סגור"]]`;

// ---------- Hooks, config, events, strings ----------

export interface HookRow {
  readonly name: string;
  readonly fired: string;
  readonly payload: string;
  readonly handles: string;
  /** Whether the native SDK calls it today. */
  readonly native: boolean;
}

/** The TaleartListener methods, as the Android and iOS references name them (checked against TaleartListener.kt). */
export const LISTENER_HOOKS: readonly HookRow[] = [
  { name: 'onLoaded', fired: 'The zone was read and its display is rendered, or none is needed.', payload: 'event (zoneKeyPrefix, zoneSlug)', handles: 'Nothing to return.', native: true },
  { name: 'onLoadFailed', fired: 'The zone could not be read: a refused key, a network failure or a bad answer.', payload: 'event.error (the message)', handles: 'Nothing to return.', native: true },
  { name: 'onGroupImpression', fired: 'A group was seen. Not yet on native: the method exists, but the SDK does not call it yet.', payload: 'event.group', handles: 'Nothing to return.', native: false },
  { name: 'onPresented', fired: 'The full-screen viewer opened on a group.', payload: 'event.group', handles: 'Nothing to return.', native: true },
  { name: 'onDismissed', fired: 'The viewer closed. event.group is the group it showed last.', payload: 'event.group', handles: 'Nothing to return.', native: true },
  { name: 'onTaleShown', fired: 'A tale came on screen in the viewer.', payload: 'event.group, event.tale', handles: 'Nothing to return.', native: true },
  { name: 'onActionClicked', fired: 'A call to action was activated, before it opens its URL.', payload: 'event.url, event.newTab (false on native), event.component, event.group, event.tale', handles: 'Return true when your app routed the link. Return false (the default) and the system browser opens it.', native: true },
  { name: 'onUserInteracted', fired: 'The server accepted a poll, quiz or rating answer. Not yet on native: the method exists, but the SDK does not call it yet.', payload: 'event.component (value), event.group, event.tale', handles: 'Nothing to return.', native: false },
  { name: 'onEvent', fired: 'Every event, after its named method.', payload: 'The event', handles: 'Nothing to return.', native: true },
];

export interface FieldRow {
  readonly name: string;
  readonly type: string;
  readonly def: string;
  readonly meaning: string;
}

/** The TaleartConfig fields (checked against TaleartConfig.kt). */
export const CONFIG_FIELDS: readonly FieldRow[] = [
  { name: 'apiUrl', type: 'String', def: '"" (empty)', meaning: 'The TaleArt API origin, such as https://api.example.com. Set it: a native app has no page to take it from, and an empty value shows nothing. A view’s own apiUrl wins.' },
  { name: 'locale', type: 'String', def: '"" (device locale)', meaning: 'The SDK’s locale, BCP 47 such as he-IL. Empty: the device’s locale, then English.' },
  { name: 'strings', type: 'Map<String, Map<String, String>>', def: 'empty', meaning: 'Texts per locale, keyed by the locale (he-IL, or its language he), then by string key.' },
  { name: 'stringsForEveryLocale', type: 'Map<String, String>', def: 'empty', meaning: 'Texts for every locale, looked up after the locale’s own.' },
  { name: 'listener', type: 'TaleartListener?', def: 'null', meaning: 'The hooks of every view. It runs after a view’s own listener.' },
  { name: 'externalUserId', type: 'String?', def: 'null', meaning: 'The viewer’s external user ID. Stored, but not sent by the native SDK yet.' },
  { name: 'tags', type: 'List<String>', def: 'empty', meaning: 'The viewer’s targeting tags. Stored, but not sent by the native SDK yet.' },
];

export const EVENT_FIELDS: readonly FieldRow[] = [
  { name: 'name', type: 'String', def: '(required)', meaning: 'The hook’s name without “on”, in lower camel case: loaded, loadFailed, groupImpression, presented, dismissed, taleShown, actionClicked, userInteracted.' },
  { name: 'zoneKeyPrefix', type: 'String', def: '(required)', meaning: 'The first 8 characters of the zone key. The whole key is never in an event.' },
  { name: 'zoneSlug', type: 'String', def: '""', meaning: 'The zone’s slug, such as home-top. Empty when the read failed before the zone came.' },
  { name: 'group', type: 'GroupRef?', def: 'null', meaning: 'The group: its id, name and position in the zone (from 0).' },
  { name: 'tale', type: 'TaleRef?', def: 'null', meaning: 'The tale: its id, position in the group (from 0) and title.' },
  { name: 'component', type: 'ComponentRef?', def: 'null', meaning: 'A call to action or an interactive part: its id, its type (button, image-button, swipe-up) and, for an answer, its value.' },
  { name: 'url', type: 'String?', def: 'null', meaning: 'The destination of an action that opens one.' },
  { name: 'newTab', type: 'Boolean', def: 'false', meaning: 'Always false on native: links open in the system browser.' },
  { name: 'error', type: 'String?', def: 'null', meaning: 'The message of a failed load.' },
];

export interface StringRow {
  readonly key: string;
  readonly english: string;
  readonly note: string;
}

/** The string keys, with their English defaults (checked against the DEFAULTS map in TaleartStrings.kt). */
export const STRING_KEYS: readonly StringRow[] = [
  { key: 'viewer.close', english: 'Close', note: 'The viewer’s close button.' },
  { key: 'viewer.play', english: 'Play', note: 'The viewer’s play button.' },
  { key: 'viewer.pause', english: 'Pause', note: 'The viewer’s pause button.' },
  { key: 'viewer.previousTale', english: 'Previous tale', note: 'Moves back one tale.' },
  { key: 'viewer.nextTale', english: 'Next tale', note: 'Moves on one tale.' },
  { key: 'viewer.progress', english: '{group}, tale {tale} of {count}', note: 'Announces the position in the viewer.' },
  { key: 'viewer.taleFallback', english: 'Tale {number}', note: 'The name of a tale without a title.' },
  { key: 'banner.label', english: 'Banner', note: 'The banner’s name, for screen readers.' },
  { key: 'banner.carousel', english: 'carousel', note: 'The banner’s role, for screen readers.' },
  { key: 'banner.slide', english: 'slide', note: 'The word for one slide.' },
  { key: 'banner.slideOf', english: '{index} of {count}', note: 'The slide’s position.' },
  { key: 'banner.previousSlide', english: 'Previous slide', note: 'The previous-slide control.' },
  { key: 'banner.nextSlide', english: 'Next slide', note: 'The next-slide control.' },
  { key: 'banner.showGroup', english: 'Show {name}', note: 'A slide’s control, to open its group.' },
  { key: 'banner.stopRotation', english: 'Stop automatic slide show', note: 'The autoplay control, while it plays.' },
  { key: 'banner.startRotation', english: 'Start automatic slide show', note: 'The autoplay control, while it is paused.' },
  { key: 'bar.seen', english: '{name}, seen', note: 'A bar item that the viewer has shown.' },
  { key: 'links.open', english: 'Open in browser', note: 'Native only: a link that leaves the app for the browser.' },
];

// ---------- Android and iOS member tables ----------

export const XML_ATTRIBUTES: readonly FieldRow[] = [
  { name: 'app:taleartZoneKey', type: 'string', def: '(none)', meaning: 'The zone’s key, tak_…. Without it the view shows nothing.' },
  { name: 'app:taleartApiUrl', type: 'string', def: '"" (empty)', meaning: 'The API origin for this view. Empty uses the one of TaleartSdk.init.' },
];

/** TaleartView members (checked for their declarations in TaleartView.kt). */
export const ANDROID_VIEW_MEMBERS: readonly FieldRow[] = [
  { name: 'zoneKey', type: 'String', def: '""', meaning: 'The zone’s key. The view reads the zone once it has a key and an API origin.' },
  { name: 'apiUrl', type: 'String', def: '""', meaning: 'The API origin for this view. Empty uses the one of TaleartSdk.init.' },
  { name: 'locale', type: 'String?', def: 'null', meaning: 'This view’s locale. Null uses the SDK’s.' },
  { name: 'strings', type: 'Map<String, Map<String, String>>?', def: 'null', meaning: 'This view’s texts per locale, over the SDK’s.' },
  { name: 'listener', type: 'TaleartListener?', def: 'null', meaning: 'This view’s hooks. They run before the SDK’s listener.' },
  { name: 'client', type: 'DeliveryClient', def: 'the process’s shared client', meaning: 'The client the next read uses. A client you set belongs to you.' },
  { name: 'opensViewer', type: 'Boolean', def: 'true', meaning: 'A tap on a group opens the full-screen viewer. False: you handle the tap in onGroupClickListener.' },
  { name: 'onGroupClickListener', type: '((DeliveryTaleGroup) -> Unit)?', def: 'null', meaning: 'Called with the tapped group, before the viewer opens.' },
  { name: 'onErrorListener', type: '((ZoneResult.Failure) -> Unit)?', def: 'null', meaning: 'Called with each failed read. The view then shows nothing.' },
  { name: 'controller', type: 'TaleartZoneController', def: '(val)', meaning: 'The zone the view shows. It keeps the zone when the view is detached and attached again.' },
  { name: 'hostsComposition', type: 'Boolean', def: '(val)', meaning: 'True once the view has a window and a lifecycle owner.' },
  { name: 'configure', type: 'fun (apiUrl, zoneKey)', def: '(function)', meaning: 'Sets the API origin and the zone’s key in one call.' },
  { name: 'reload', type: 'fun ()', def: '(function)', meaning: 'Reads the zone again. The display stays until the new zone arrives.' },
];

/** The TaleartZone composable's parameters (checked in TaleartZone.kt). */
export const ANDROID_ZONE_PARAMS: readonly FieldRow[] = [
  { name: 'apiUrl', type: 'String', def: '(required)', meaning: 'The API origin. Empty uses the one of TaleartSdk.init.' },
  { name: 'zoneKey', type: 'String', def: '(required)', meaning: 'The zone’s key, tak_….' },
  { name: 'modifier', type: 'Modifier', def: 'Modifier', meaning: 'The layout modifier, such as fillMaxWidth().' },
  { name: 'onGroupClick', type: '(DeliveryTaleGroup) -> Unit', def: '{}', meaning: 'Called with the tapped group, before the viewer opens.' },
  { name: 'onError', type: '(ZoneResult.Failure) -> Unit', def: '{}', meaning: 'Called with each failed read.' },
  { name: 'client', type: 'DeliveryClient?', def: 'null', meaning: 'The client for the zone. Null uses the shared one.' },
  { name: 'seenGroups', type: 'SeenGroups', def: 'rememberSeenGroups()', meaning: 'The groups the viewer has shown; their ring turns to the seen colour.' },
  { name: 'titleStyle', type: 'TextStyle', def: 'TextStyle.Default', meaning: 'The style of a bar item’s title.' },
  { name: 'reloadKey', type: 'Any?', def: 'null', meaning: 'Changing it reads the zone again.' },
  { name: 'opensViewer', type: 'Boolean', def: 'true', meaning: 'False: a tap calls onGroupClick only, and you show the viewer yourself.' },
  { name: 'locale', type: 'String?', def: 'null', meaning: 'This zone’s locale. Null uses the SDK’s.' },
  { name: 'strings', type: 'Map<String, Map<String, String>>?', def: 'null', meaning: 'This zone’s texts per locale, over the SDK’s.' },
  { name: 'listener', type: 'TaleartListener?', def: 'null', meaning: 'This zone’s hooks. They run before the SDK’s listener.' },
];

/** TaleartZoneView members (checked in TaleartViewController.kt). */
export const IOS_ZONE_MEMBERS: readonly FieldRow[] = [
  { name: 'apiUrl', type: 'String?', def: 'nil', meaning: 'The API origin. Nil or empty uses the one of TaleartSdk.init.' },
  { name: 'zoneKey', type: 'String', def: '(init)', meaning: 'The zone’s key, tak_…. Changing it reads the zone again.' },
  { name: 'viewController', type: 'UIViewController', def: '(read-only)', meaning: 'The controller that shows the zone. Embed it, and keep the TaleartZoneView alive while you do.' },
  { name: 'opensViewer', type: 'Bool', def: 'true', meaning: 'A tap opens the full-screen viewer, modal. False: you handle the tap in onGroupClick.' },
  { name: 'onGroupClick', type: '((DeliveryTaleGroup) -> Unit)?', def: 'nil', meaning: 'Called with the tapped group, before the viewer opens.' },
  { name: 'onError', type: '((ZoneResult.Failure) -> Unit)?', def: 'nil', meaning: 'Called with each failed read. Nothing shows then.' },
  { name: 'onHeightChange', type: '((Double) -> Unit)?', def: 'nil', meaning: 'Called with the display’s new height in points. Use it to size the container.' },
  { name: 'height', type: 'Double', def: '0 (read-only)', meaning: 'The display’s height in points. 0 while nothing shows.' },
  { name: 'listener', type: 'TaleartListener?', def: 'nil', meaning: 'This view’s hooks. Subclass TaleartListenerBase in Swift.' },
  { name: 'strings', type: 'Map<String, Map<String, String>>?', def: 'nil', meaning: 'This view’s texts per locale, over the SDK’s.' },
  { name: 'locale', type: 'String?', def: 'nil', meaning: 'This view’s locale. Nil uses the SDK’s.' },
  { name: 'client', type: 'DeliveryClient', def: 'the shared client', meaning: 'The client the next read uses.' },
  { name: 'reload', type: 'func ()', def: '(function)', meaning: 'Reads the zone again. The display stays until the new zone arrives.' },
  { name: 'configure', type: 'func (apiUrl:zoneKey:)', def: '(function)', meaning: 'Sets the API origin and the zone’s key in one call.' },
];

/** The Kotlin top-level functions for iOS, as Swift calls them. */
export const IOS_FUNCTIONS: readonly FieldRow[] = [
  { name: 'TaleartViewController(apiUrl:zoneKey:)', type: 'UIViewController', def: '(required)', meaning: 'A controller that shows the zone. The zone’s lifetime is the controller’s: for a key that changes later, use TaleartZoneView.' },
  { name: 'TaleartViewController(apiUrl:zoneKey:onGroupClick:)', type: 'UIViewController', def: '(required)', meaning: 'As above, and calls onGroupClick with each tapped group before the viewer opens.' },
];

export const TALEART_SDK_MEMBERS: readonly FieldRow[] = [
  { name: 'init(config:)', type: 'fun (TaleartConfig)', def: '(required)', meaning: 'Sets the SDK’s configuration for every view. Call it once, in Application.onCreate (Android) or at launch (iOS), before the views show. On iOS it is doInit(config:), as Kotlin’s init is named in Swift.' },
  { name: 'config', type: 'TaleartConfig', def: 'the defaults', meaning: 'The configuration in use: the last init, or the defaults.' },
  { name: 'locale', type: 'String', def: '(read-only)', meaning: 'The SDK’s locale: the configured one, else the device’s.' },
  { name: 'translate', type: 'Translate', def: '(read-only)', meaning: 'The text lookup of the SDK’s configuration.' },
];

// ---------- Side-by-side with the Web SDK ----------

export interface MappingRow {
  readonly topic: string;
  readonly web: string;
  readonly android: string;
  readonly ios: string;
}

export const MAPPING: readonly MappingRow[] = [
  { topic: 'Init (once, for every view)', web: 'Taleart.init({ … }), or init() from the script’s URL', android: 'TaleartSdk.init(TaleartConfig(…)) in Application.onCreate', ios: 'TaleartSdk.shared.doInit(config: TaleartConfig(…)) at launch' },
  { topic: 'Zone key', web: 'zone-key="tak_…" on <taleart-view>', android: 'app:taleartZoneKey in XML, zoneKey = in TaleartZone', ios: 'TaleartZoneView(apiUrl:zoneKey:)' },
  { topic: 'API origin', web: 'api-url (default: the script’s origin)', android: 'app:taleartApiUrl; apiUrl in init (required)', ios: 'apiUrl: in TaleartZoneView; apiUrl in init (required)' },
  { topic: 'Locale', web: 'locale attribute, init({ locale }), else the page’s lang', android: 'TaleartConfig.locale, else TaleartView.locale or TaleartZone(locale =)', ios: 'TaleartConfig(locale:), else zone.locale' },
  { topic: 'Strings', web: 'init({ strings }) or the element’s strings property', android: 'TaleartConfig.strings and stringsForEveryLocale; TaleartView.strings; TaleartZone(strings =)', ios: 'TaleartConfig(strings:, stringsForEveryLocale:); zone.strings' },
  { topic: 'Hooks', web: 'init({ hooks }) or the element’s hooks property', android: 'TaleartConfig.listener, or TaleartView.listener, or TaleartZone(listener =)', ios: 'TaleartConfig(listener:) or zone.listener; subclass TaleartListenerBase' },
  { topic: 'Action override (route the link yourself)', web: 'hooks.onActionClicked: e.preventDefault()', android: 'onActionClicked returns true', ios: 'override onActionClicked and return true' },
  { topic: 'Tap opens the viewer', web: 'Built in; the onPresented hook fires', android: 'opensViewer = false, then onGroupClickListener', ios: 'opensViewer = false, then onGroupClick' },
  { topic: 'External user ID and tags', web: 'setExternalUserId(), setTags(), or init()', android: 'TaleartConfig.externalUserId and tags: stored, not sent yet', ios: 'TaleartConfig(externalUserId:, tags:): stored, not sent yet' },
];

/** What the native SDKs do not do yet, said once and linked from both guides and both references. */
export const NOT_YET_NATIVE: readonly string[] = [
  'onGroupImpression and onUserInteracted are declared but not called: the native SDK does not fire them yet. The web SDK does.',
  'externalUserId and tags are accepted and stored, but not sent with the zone read yet. Targeting by them does not apply in a native app yet.',
];
