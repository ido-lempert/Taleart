package site.lempert.taleart.sdk.ui

// A real Delivery API response (GET /delivery/v1/zone?zone=home-top), recorded from the local API
// on 2026-10-23 after seeding mobile-9-5/seed-9-5.mjs: one group whose two tales were built with
// the Management API's document endpoints as Tale Studio builds them (save the draft, then
// "Update tale"). Tale 1 holds one element of every registry type (text in two styles, an image,
// an image sticker, an image button, an emoji, an ellipse, a line, a button, a swipe-up link);
// tale 2 a rectangle, a document video, a text in a project font and an outline button.
internal const val STUDIO_ZONE_JSON = """
{
  "id": "986f8a7f-730d-49e0-88ae-d9cedaa09cd8",
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
    "id": "1b1fe2d3-bbd0-4ecb-ad78-952ad393e988",
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
      "id": "d511c746-7ba1-49e8-ad72-6869860c906c",
      "name": "Studio tales",
      "cover": null,
      "tales": [
        {
          "id": "1f2503b1-253d-4a50-9efc-4da0467072b6",
          "title": "Every element",
          "media": null,
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#1E3A8A"
              }
            },
            "version": 1,
            "durationMs": 15000,
            "elements": [
              {
                "id": "c54bba46-4e89-478a-b537-7ff79621d830",
                "box": {
                  "h": 0.22,
                  "w": 0.6,
                  "x": 0.08,
                  "y": 0.14,
                  "rotation": 0
                },
                "a11y": {
                  "label": "A beach at sunset"
                },
                "type": "image",
                "props": {
                  "fit": "cover",
                  "radius": 0.02,
                  "url": "http://localhost:3595/media/media/37648fbb-651a-4e08-872f-3588dc8005e9.png"
                }
              },
              {
                "id": "2f3697ce-517a-452c-8305-0a65af5dfb53",
                "box": {
                  "h": 0.12375,
                  "w": 0.22,
                  "x": 0.72,
                  "y": 0.15,
                  "rotation": 12
                },
                "a11y": {
                  "label": "Sun sticker"
                },
                "type": "sticker",
                "props": {
                  "url": "http://localhost:3595/media/media/541989a2-37ce-41b8-9114-7158d5e9585b.png"
                }
              },
              {
                "id": "e717a5ab-ae26-4310-82a0-4d1eddc72b8b",
                "box": {
                  "h": 0.10125,
                  "w": 0.18,
                  "x": 0.74,
                  "y": 0.29,
                  "rotation": 0
                },
                "a11y": {
                  "label": "Open the lookbook"
                },
                "type": "image-button",
                "props": {
                  "href": "https://example.com/lookbook",
                  "radius": 0.02,
                  "url": "http://localhost:3595/media/media/b3133943-f3c4-4679-a16b-3aee341327f4.png"
                }
              },
              {
                "id": "6dfa55ae-33df-42d8-acbb-bedebc46dadf",
                "box": {
                  "h": 0.09,
                  "w": 0.16,
                  "x": 0.06,
                  "y": 0.35,
                  "rotation": 0
                },
                "a11y": {
                  "label": "palm tree"
                },
                "type": "emoji",
                "props": {
                  "emoji": "🌴"
                }
              },
              {
                "id": "27dfabae-eca9-4b0a-826e-c21fe99708ac",
                "box": {
                  "h": 0.12,
                  "w": 0.32,
                  "x": 0.62,
                  "y": 0.43,
                  "rotation": 0
                },
                "a11y": {},
                "type": "shape",
                "props": {
                  "fill": "#F59E0B",
                  "shape": "ellipse",
                  "stroke": "#FFFFFF",
                  "opacity": 0.9,
                  "strokeWidth": 0.004
                }
              },
              {
                "id": "3fcff0c2-ab77-4d51-9793-d74c15a82dea",
                "box": {
                  "h": 0.16,
                  "w": 0.56,
                  "x": 0.08,
                  "y": 0.42,
                  "rotation": -4
                },
                "a11y": {},
                "type": "text",
                "props": {
                  "font": {
                    "stack": "serif",
                    "source": "system"
                  },
                  "size": 0.06,
                  "text": "Summer\nSale",
                  "align": "start",
                  "color": "#FFFFFF",
                  "italic": false,
                  "weight": "bold",
                  "fallback": "serif",
                  "direction": "auto",
                  "background": "highlight",
                  "lineHeight": 1.1,
                  "backgroundColor": "#E11D48"
                }
              },
              {
                "id": "53865831-9edd-485d-b98a-9223128a29b1",
                "box": {
                  "h": 0.02,
                  "w": 0.8,
                  "x": 0.1,
                  "y": 0.6,
                  "rotation": -6
                },
                "a11y": {},
                "type": "shape",
                "props": {
                  "shape": "line",
                  "stroke": "#FDE68A",
                  "strokeWidth": 0.006
                }
              },
              {
                "id": "440e7f8d-8c9e-45dc-a4af-2a0cc88de634",
                "box": {
                  "h": 0.1,
                  "w": 0.84,
                  "x": 0.08,
                  "y": 0.63,
                  "rotation": 0
                },
                "a11y": {},
                "type": "text",
                "props": {
                  "font": {
                    "stack": "sans",
                    "source": "system"
                  },
                  "size": 0.03,
                  "text": "מבצע קיץ: 50% הנחה על כל הקולקציה",
                  "align": "start",
                  "color": "#0F172A",
                  "italic": true,
                  "weight": "regular",
                  "fallback": "sans",
                  "direction": "auto",
                  "background": "box",
                  "lineHeight": 1.4,
                  "backgroundColor": "#FDE68AE6"
                }
              },
              {
                "id": "b01bad18-6a50-440f-a335-9eaf47a4d292",
                "box": {
                  "h": 0.07,
                  "w": 0.6,
                  "x": 0.2,
                  "y": 0.76,
                  "rotation": 0
                },
                "a11y": {},
                "type": "button",
                "props": {
                  "fill": "#FFFFFF",
                  "href": "https://example.com/sale",
                  "color": "#111827",
                  "label": "Shop the sale",
                  "radius": 0.035,
                  "variant": "filled"
                }
              },
              {
                "id": "6c17463f-7c20-4f5f-ad31-a4e9ac81b159",
                "box": {
                  "h": 0.09,
                  "w": 0.6,
                  "x": 0.2,
                  "y": 0.87,
                  "rotation": 0
                },
                "a11y": {},
                "type": "swipe-up",
                "props": {
                  "href": "https://example.com/deals",
                  "color": "#FFFFFF",
                  "label": "More deals",
                  "background": "#000000B3"
                }
              }
            ]
          }
        },
        {
          "id": "20668411-cda4-439f-b08c-1a3bb7e5f288",
          "title": "Video element",
          "media": null,
          "document": {
            "canvas": {
              "background": {
                "type": "color",
                "color": "#4C1D95"
              }
            },
            "version": 1,
            "elements": [
              {
                "id": "5ffcde38-0430-4a1e-9c33-2af97fc8dbd2",
                "box": {
                  "h": 0.5,
                  "w": 0.88,
                  "x": 0.06,
                  "y": 0.16,
                  "rotation": 0
                },
                "a11y": {},
                "type": "shape",
                "props": {
                  "fill": "#111827CC",
                  "shape": "rectangle",
                  "radius": 0.03,
                  "stroke": "#F472B6",
                  "strokeWidth": 0.004
                }
              },
              {
                "id": "10799f64-dd33-4db6-befe-e11bf57c0fce",
                "box": {
                  "h": 0.3,
                  "w": 0.8,
                  "x": 0.1,
                  "y": 0.19,
                  "rotation": 0
                },
                "a11y": {
                  "decorative": true
                },
                "type": "video",
                "props": {
                  "fit": "cover",
                  "radius": 0.02,
                  "url": "http://localhost:3595/media/media/21f37f0e-da3e-4d9e-a6e2-e38eef3eb292.mp4"
                }
              },
              {
                "id": "09121c5c-2b75-4e53-a38e-2991e10a496c",
                "box": {
                  "h": 0.1,
                  "w": 0.8,
                  "x": 0.1,
                  "y": 0.52,
                  "rotation": 0
                },
                "a11y": {},
                "type": "text",
                "props": {
                  "font": {
                    "fontId": "1c995f2c-1030-44ac-ba00-0557054c54b2",
                    "source": "project"
                  },
                  "size": 0.045,
                  "text": "Inter, a project font",
                  "align": "center",
                  "color": "#FFFFFF",
                  "weight": "bold",
                  "fallback": "serif",
                  "direction": "auto",
                  "background": "none",
                  "lineHeight": 1.25,
                  "backgroundColor": "#000000"
                }
              },
              {
                "id": "483f2039-c49b-4bb4-b6f5-3f3e19460395",
                "box": {
                  "h": 0.06,
                  "w": 0.5,
                  "x": 0.25,
                  "y": 0.74,
                  "rotation": 0
                },
                "a11y": {},
                "type": "button",
                "props": {
                  "fill": "#F472B6",
                  "href": "https://example.com/watch",
                  "color": "#FFFFFF",
                  "label": "Watch more",
                  "radius": 0.01,
                  "variant": "outline"
                }
              }
            ]
          },
          "fonts": [
            {
              "id": "1c995f2c-1030-44ac-ba00-0557054c54b2",
              "url": "http://localhost:3595/media/fonts/f1ce90c4-fd2c-4d59-b583-e7b182f02533.woff2",
              "weight": 700,
              "style": "normal"
            }
          ]
        }
      ]
    }
  ]
}
"""
