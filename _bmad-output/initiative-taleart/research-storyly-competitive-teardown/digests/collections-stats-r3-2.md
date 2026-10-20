# Digest: Collections and product statistics (round 3)
accessed: 2026-10-20 | publisher: Storyly | dates: page labels only ("Updated almost 3 years ago" on the automated-shoppable-stories page; "Updated over 1 year ago" on the product analytics page)

## Collections (https://docs.storyly.io/v2.0/docs/creating-automated-shoppable-stories)
- A collection is a filtered sub-list of items from a product feed. Filters: Product ID, Product Group ID, Title, Price, Sale Price. Example from the page: "Shirts right under 40$".
- Creation: after a feed finishes processing, click "Create Collection" under the feed. Collections are built in minutes depending on size.
- Automated shoppable stories are created from a collection: the group is created with one of two template sets ("Energetic" or "Modern"), a CTA text, brand primary and secondary colors, a cover image, and a title. Audience, schedule, and style are optional at the last step.
- On create, the system makes 8 stories with items randomly selected from the collection. Every 24 hours these 8 are replaced automatically.
- Confidence: high (fetched text).

## Product statistics (https://docs.storyly.io/docs/unveiling-product-analytics)
- Products tab under the Analytics section. Date-range picker. CSV export.
- Metrics per product, derived from interactions with product elements (Swipe-Up, Click button, Product Tag, Product Card, Product Catalog):
  - Total Cart Value: total price of products added to cart via Stories.
  - Impression: total views of the product via Stories.
  - Conversion: number of products added to cart via Stories.
  - Click-through rate: bottom-sheet openings divided by product impressions.
- Best Performing Products: sortable by Conversion or Click-through rate.
- Confidence: high (fetched text).

## Gaps
- No collection-level statistics on any page. Collection performance can only be derived by aggregating product metrics for the collection's members, and the docs do not say whether Storyly does that.
- The statistics pages do not say whether product metrics are keyed to collection, group, or story.
- Page dates are relative labels only. The automated-shoppable-stories page is about 3 years old by its label and may not reflect the current product.
