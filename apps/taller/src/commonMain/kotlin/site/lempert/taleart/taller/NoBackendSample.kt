package site.lempert.taleart.taller

/**
 * A zone held in the app, in the shape of the body of `GET /delivery/v1/zone`: three tale groups of colour
 * and text tales (and a poll) in a bar, shown by `taller.noBackend=true` with no backend at all.
 */
const val NO_BACKEND_ZONE_JSON = """
{
  "id": "local-zone",
  "name": "Local zone",
  "slug": "local-zone",
  "theme": { "ringStyle": "gradient", "ringColors": ["#ea580c", "#db2777", "#7c3aed"], "seenRingColor": "#6b7280" },
  "frame": { "id": "bar", "type": "bar", "settings": { "layout": "ring", "size": "large", "gap": 14, "showTitles": true } },
  "taleGroups": [
    {
      "id": "welcome",
      "name": "Welcome",
      "tales": [
        {
          "id": "welcome-1",
          "title": "Hello",
          "document": {
            "canvas": { "background": { "type": "color", "color": "#2b829f" } },
            "elements": [
              { "id": "t1", "type": "text", "box": { "x": 0.1, "y": 0.42, "w": 0.8, "h": 0.14, "rotation": 0 }, "a11y": {},
                "props": { "text": "Hello from an app with no backend", "size": 0.06, "weight": "bold", "color": "#ffffff", "align": "center" } }
            ]
          }
        }
      ]
    },
    {
      "id": "vote",
      "name": "Vote",
      "tales": [
        {
          "id": "vote-1",
          "title": "Day or night",
          "document": {
            "canvas": { "background": { "type": "color", "color": "#1d2a4a" } },
            "elements": [
              { "id": "p1", "type": "poll", "box": { "x": 0.08, "y": 0.3, "w": 0.84, "h": 0.34, "rotation": 0 }, "a11y": {},
                "props": { "question": "Day or night?", "options": [ { "id": "day", "label": "Day" }, { "id": "night", "label": "Night" } ], "theme": "dark", "view": "embed" } }
            ]
          }
        }
      ]
    },
    {
      "id": "news",
      "name": "News",
      "tales": [
        {
          "id": "news-1",
          "title": "Release",
          "document": {
            "canvas": { "background": { "type": "color", "color": "#7c3aed" } },
            "elements": [
              { "id": "t2", "type": "text", "box": { "x": 0.1, "y": 0.42, "w": 0.8, "h": 0.14, "rotation": 0 }, "a11y": {},
                "props": { "text": "Version 1.0 is out", "size": 0.06, "weight": "bold", "color": "#ffffff", "align": "center" } }
            ]
          }
        }
      ]
    }
  ]
}
"""
