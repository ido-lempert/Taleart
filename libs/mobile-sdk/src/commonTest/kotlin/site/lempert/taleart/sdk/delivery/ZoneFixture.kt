package site.lempert.taleart.sdk.delivery

// A real Delivery API response: GET /delivery/v1/zone?zone=home-top from a local API (story 9.2,
// 2026-10-23), a zone with a bar display and two On tale groups of three and two tales.
internal const val HOME_TOP_ZONE_JSON = """
{
  "id": "9dad4abf-035c-44f2-8dad-7053e6039967",
  "name": "Home top",
  "slug": "home-top",
  "theme": {
    "ringStyle": "gradient",
    "ringColors": [
      "#ea580c",
      "#db2777",
      "#7c3aed"
    ],
    "seenRingColor": "#6b7280",
    "ringWidth": 2,
    "cornerRadius": null,
    "fontFamily": null,
    "titleColor": null,
    "backgroundColor": "transparent",
    "accentColor": "#ffffff"
  },
  "frame": {
    "id": "0a7833b6-f1c2-4b92-811b-3bb686b941db",
    "type": "bar",
    "settings": {
      "shape": "circle",
      "size": "medium",
      "showTitles": true,
      "alignment": "start",
      "gap": 12
    }
  },
  "taleGroups": [
    {
      "id": "905ea258-ccfd-4527-9b84-380c5fbe011a",
      "name": "Summer trips",
      "cover": null,
      "tales": [
        {
          "id": "b332d2ae-1e51-43ed-aecc-5ebd825ba94b",
          "title": "Beach day",
          "media": {
            "kind": "image",
            "contentType": "image/png",
            "url": "http://localhost:3592/media/tales/3b00e2b1-fa35-4657-9849-a78f9f7cf9c3.png"
          },
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#000000"
              }
            },
            "version": 1,
            "durationMs": 5000,
            "elements": [
              {
                "id": "84c5d4f5-d2a6-4e13-a37e-9c948a8f4fe5",
                "box": {
                  "h": 1,
                  "w": 1,
                  "x": 0,
                  "y": 0,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "image",
                "props": {
                  "fit": "contain",
                  "taleMedia": true,
                  "url": "http://localhost:3592/media/tales/3b00e2b1-fa35-4657-9849-a78f9f7cf9c3.png"
                }
              }
            ]
          }
        },
        {
          "id": "fe5959d4-b727-444f-9d68-b9fb8d2ab232",
          "title": "Mountain hike",
          "media": {
            "kind": "image",
            "contentType": "image/png",
            "url": "http://localhost:3592/media/tales/1ce4accf-eacb-4520-8d47-4401c44bce0d.png"
          },
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#000000"
              }
            },
            "version": 1,
            "durationMs": 5000,
            "elements": [
              {
                "id": "6d1355cd-a49b-42ac-a875-33b6d83f235a",
                "box": {
                  "h": 1,
                  "w": 1,
                  "x": 0,
                  "y": 0,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "image",
                "props": {
                  "fit": "contain",
                  "taleMedia": true,
                  "url": "http://localhost:3592/media/tales/1ce4accf-eacb-4520-8d47-4401c44bce0d.png"
                }
              }
            ]
          }
        },
        {
          "id": "4f87168b-7398-4432-aff0-71237b6e742e",
          "title": "City night",
          "media": {
            "kind": "image",
            "contentType": "image/png",
            "url": "http://localhost:3592/media/tales/67e79080-33e0-4ac6-a144-e052b44f28ce.png"
          },
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#000000"
              }
            },
            "version": 1,
            "durationMs": 5000,
            "elements": [
              {
                "id": "37a0a1ac-2f26-4087-b671-cfbc1e232dcf",
                "box": {
                  "h": 1,
                  "w": 1,
                  "x": 0,
                  "y": 0,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "image",
                "props": {
                  "fit": "contain",
                  "taleMedia": true,
                  "url": "http://localhost:3592/media/tales/67e79080-33e0-4ac6-a144-e052b44f28ce.png"
                }
              }
            ]
          }
        }
      ]
    },
    {
      "id": "48962270-14fe-4563-aa65-470ea8997fa1",
      "name": "Winter tales",
      "cover": null,
      "tales": [
        {
          "id": "a310613a-27b5-4f75-b722-a1cfe01da6a8",
          "title": "First snow",
          "media": {
            "kind": "image",
            "contentType": "image/png",
            "url": "http://localhost:3592/media/tales/a891aa0f-534d-49c2-845e-664981060648.png"
          },
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#000000"
              }
            },
            "version": 1,
            "durationMs": 5000,
            "elements": [
              {
                "id": "0d7d86d9-a355-4422-b28c-fbc2f28f37e9",
                "box": {
                  "h": 1,
                  "w": 1,
                  "x": 0,
                  "y": 0,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "image",
                "props": {
                  "fit": "contain",
                  "taleMedia": true,
                  "url": "http://localhost:3592/media/tales/a891aa0f-534d-49c2-845e-664981060648.png"
                }
              }
            ]
          }
        },
        {
          "id": "b7663973-8a01-4e98-9a9c-de13a87c7734",
          "title": "Hot cocoa",
          "media": {
            "kind": "image",
            "contentType": "image/png",
            "url": "http://localhost:3592/media/tales/95288f14-a047-4a3e-8537-320dc1354e05.png"
          },
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#000000"
              }
            },
            "version": 1,
            "durationMs": 5000,
            "elements": [
              {
                "id": "64c8eda1-87a5-4ebc-835a-a4da39a4053a",
                "box": {
                  "h": 1,
                  "w": 1,
                  "x": 0,
                  "y": 0,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "image",
                "props": {
                  "fit": "contain",
                  "taleMedia": true,
                  "url": "http://localhost:3592/media/tales/95288f14-a047-4a3e-8537-320dc1354e05.png"
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
"""
