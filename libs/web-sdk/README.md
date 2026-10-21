# web-sdk

The TaleArt Web SDK: a `<taleart-view>` custom element that renders a zone's frames (bar, banner) and opens its
tale groups in a full-screen viewer, reading published content from the Delivery API with the zone's key.

## Placing a zone

```html
<script type="module" src="https://your-cdn.example/taleart/index.js"></script>
<taleart-view api-url="https://api.example.com" zone-key="tak_…"></taleart-view>
```

Loading the SDK registers `<taleart-view>`. The ES build exports the API below; the UMD build puts the same exports on
`window.TaleartWebSdk`.

| Attribute / property | Meaning |
| --- | --- |
| `api-url` / `apiUrl` | The TaleArt API origin. |
| `zone-key` / `zoneKey` | The zone key (`tak_…`) issued in the dashboard. |
| `stage` / `stage` | A stage key of the zone: render only that stage's frame. Empty renders every frame of the zone. |
| `theme` / `theme` | Theme fields for this element (JSON in the attribute, an object in the property); see below. |

## Theme

The project's theme, set in the dashboard, styles the frames and the viewer. A host page can override any of its fields
for a zone, or for one element. There is no theme per frame. Each field resolves, in order, from:

1. the element's `theme` property or attribute,
2. the zone's `configureZone(zoneKey, { theme })` option,
3. the project's theme,
4. TaleArt's default.

```js
import { configureZone } from 'https://your-cdn.example/taleart/index.js';

// Every <taleart-view> with this zone key, the bar and the banner alike.
configureZone('tak_…', { theme: { ringStyle: 'solid', ringColors: ['#0055ff'] } });

// One element only.
document.querySelector('taleart-view').theme = { cornerRadius: 0 };
```

```html
<taleart-view api-url="…" zone-key="tak_…" theme='{"fontFamily": "Georgia, serif"}'></taleart-view>
```

| Field | Values |
| --- | --- |
| `ringStyle` | `"gradient"`, `"solid"` or `"none"` |
| `ringColors` | 1–3 colours, `#rrggbb` |
| `seenRingColor` | `#rrggbb` |
| `ringWidth` | integer 1–4 (px) |
| `cornerRadius` | integer 0–32 (px), or `null` for the frame's own |
| `fontFamily` | a CSS font-family list (names, quoted or bare; the host page loads the font), or `null` for the host page's |
| `titleColor` | `#rrggbb`, or `null` for the host page's text colour |
| `backgroundColor` | `#rrggbb` or `"transparent"` |
| `accentColor` | `#rrggbb`: the viewer's progress and buttons |

- A field left out (or `undefined`) falls through to the next source; `null`, where allowed, is a value and wins.
- Each value is checked with the same rules as the dashboard's. An invalid or unknown field is ignored with one console
  warning naming it, and the next source's value applies. An override that is not an object (or attribute text that is
  not JSON) is ignored with one warning. Values only ever reach CSS custom properties, never style text.
- The value is copied when set: assign the property again, or call `configureZone` again, to change it. Rendered
  elements restyle at once, with no new request. `el.theme = null`, removing the attribute, or
  `configureZone(key, {})` removes an override.
- With an override, colour contrast is the host page's responsibility: keep titles at 4.5:1 and rings at 3:1 against the
  background (WCAG 2.2 AA).

## Building

Run `nx build web-sdk` to build the library, and `nx run web-sdk:size` to check the 50 KB gzip budget.

## Running unit tests

Run `nx test web-sdk` to execute the unit tests via [Vitest](https://vitest.dev/).
