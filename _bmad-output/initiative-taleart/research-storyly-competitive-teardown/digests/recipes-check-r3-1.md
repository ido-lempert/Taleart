# Digest: Storyly Recipes check (round 3)
accessed: 2026-10-20 | source: https://docs.storyly.io/recipes (fetched via WebFetch and raw HTML via curl) | publisher: Storyly (ReadMe-hosted docs)

## Finding
- The Recipes section exists in navigation but contains no recipe pages. The page's i18n bundle defines the empty-state label {"recipe": {"title": "No Recipes"}}. No recipe titles or sub-page links appear in the page or in https://docs.storyly.io/llms.txt. Confidence: high.
- The brief's premise (Recipes as a technical source) is therefore not satisfiable from the public docs. Technical patterns must come from the Guides, the External API reference, and the SDK guides.

## Guide titles visible in the page index (vocabulary and technical leads)
- Flows: "What it is a Flow?", "Creating a Flow", "Building Storyly Journeys with Visibility Conditions". Note the term "Journeys" appears for Flows.
- Collections: "Create Collections".
- Feed and product: "How the Feed is Synced on Your App/Web", "Preparing and Uploading the Product Feed", "Supplemental Feed", "Product Hydration", "Customize Product Catalog & Bottom Sheet", "Shoppable Content".
- Modes: "Nudge Mode", "Sponsored Mode".
- Personalization: "Personalization with User Properties", "Adding User Properties to Create Personalized Story Groups and Stories", "Filling User Properties with Audiences for Personalized Stories", "Storyly Personalization Engine Setup".
- Vertical feed example: "Set Up Storyly Betting Feed".
- Audiences: "Create Audiences from Interactive Results", "Connect your Braze / Iterable / CleverTap / Bloomreach Audiences", "Exporting Audiences to MoEngage", "Importing Audiences from MoEngage".
- Analytics: "Placement SDK Analytics", "Storyly Dashboard Reports", "Sending Storyly Events to 3rd Party Analytics Platform", "Conversion Attribution & Tracking".
- Widgets: Story Bar, Banner, Swipe Card, Canvas, Video Feed (each with a Design Guide).
- Dashboard nav: "Guides" (docs), "External API" (reference), "Release Notes" (changelog module, shown as disabled on this page).
- Confidence: high that the titles exist; content of each page not fetched.

## Not reachable
- Recipe sub-pages: none exist to fetch.
