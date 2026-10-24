// Generated from libs/contract/tale-document/ by scripts/generate-tale-document-schemas.mjs; do not edit.
// Run `npm exec nx -- run contract:generate` after changing a schema file.

/** `tale-document/v1.schema.json`: the tale document's envelope (AD-15). */
export const TALE_DOCUMENT_V1_SCHEMA: { readonly [key: string]: unknown } = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TaleDocument",
  "description": "A tale document, version 1: the canvas and the elements of one tale. Each element's `props` are checked against the schema its `type` names in `element-types/registry.json`; an unknown type is refused on write and skipped by clients.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "canvas",
    "elements"
  ],
  "properties": {
    "version": {
      "description": "The document version. Additive changes keep it; a breaking change raises it and ships a forward migration.",
      "type": "integer",
      "const": 1
    },
    "canvas": {
      "$ref": "#/$defs/Canvas"
    },
    "durationMs": {
      "description": "How long the tale shows, in milliseconds, when it has no video; 7000 when left out. With a video element the tale plays for the video's length.",
      "type": "integer",
      "minimum": 3000,
      "maximum": 15000
    },
    "elements": {
      "description": "The elements, first at the bottom of the z-order.",
      "type": "array",
      "maxItems": 60,
      "items": {
        "$ref": "#/$defs/Element"
      }
    }
  },
  "$defs": {
    "Color": {
      "description": "A colour as #RRGGBB or #RRGGBBAA.",
      "type": "string",
      "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
    },
    "Canvas": {
      "description": "The 9:16 stage of the tale.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "background"
      ],
      "properties": {
        "background": {
          "oneOf": [
            {
              "$ref": "#/$defs/ColorBackground"
            },
            {
              "$ref": "#/$defs/MediaBackground"
            }
          ]
        }
      }
    },
    "ColorBackground": {
      "description": "A solid background colour.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "color"
      ],
      "properties": {
        "type": {
          "type": "string",
          "const": "color"
        },
        "color": {
          "$ref": "#/$defs/Color"
        }
      }
    },
    "MediaBackground": {
      "description": "An image (GIF included) of the tale's project filling the canvas, by its storage key. It is decorative. `color` fills the bands `contain` leaves, and the canvas until the image shows.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "mediaKey",
        "fit",
        "color"
      ],
      "properties": {
        "type": {
          "type": "string",
          "const": "media"
        },
        "mediaKey": {
          "description": "The storage key of an image of the tale's project, as the server made it.",
          "type": "string",
          "maxLength": 200,
          "pattern": "^(tales|media)/[a-z0-9][a-z0-9-]{0,99}\\.(png|jpg|gif|webp|mp4|webm)$"
        },
        "fit": {
          "type": "string",
          "enum": [
            "cover",
            "contain"
          ]
        },
        "color": {
          "$ref": "#/$defs/Color"
        }
      }
    },
    "Box": {
      "description": "Where an element sits, as fractions (0 to 1) of the canvas width (x, w) and height (y, h), and its rotation in degrees about its centre.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "x",
        "y",
        "w",
        "h",
        "rotation"
      ],
      "properties": {
        "x": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "y": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "w": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1
        },
        "h": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1
        },
        "rotation": {
          "type": "number",
          "minimum": -180,
          "maximum": 180
        }
      }
    },
    "A11y": {
      "description": "What assistive technology is told about the element.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "label": {
          "type": "string",
          "maxLength": 300
        },
        "decorative": {
          "type": "boolean"
        }
      }
    },
    "ElementType": {
      "description": "A key of the element-type registry.",
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$"
    },
    "ElementId": {
      "description": "A UUID, unique in the document.",
      "type": "string",
      "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    },
    "Element": {
      "description": "One element. `hidden` and `locked` are editor state and are never delivered.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "box",
        "hidden",
        "locked",
        "a11y",
        "props"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/ElementId"
        },
        "type": {
          "$ref": "#/$defs/ElementType"
        },
        "box": {
          "$ref": "#/$defs/Box"
        },
        "hidden": {
          "type": "boolean"
        },
        "locked": {
          "type": "boolean"
        },
        "a11y": {
          "$ref": "#/$defs/A11y"
        },
        "props": {
          "type": "object"
        }
      }
    }
  }
};

/** `tale-document/element-types/registry.json`, each entry with its props schema. */
export const TALE_ELEMENT_TYPE_REGISTRY: readonly {
  readonly key: string;
  readonly label: string;
  readonly schema: { readonly [key: string]: unknown };
}[] = [
  {
    "key": "text",
    "label": "Text",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "TextElementProps",
      "description": "The props of a text element: plain Unicode text, never HTML or Markdown, wrapped inside the element's box. A line feed starts a new line. Every style prop is optional (an additive change); one left out takes its default from the contract (`DEFAULT_TEXT_STYLE`), which is how text looked before styling. Styles are enumerated or range-checked values, never CSS text.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "text"
      ],
      "properties": {
        "text": {
          "type": "string",
          "maxLength": 1000
        },
        "font": {
          "description": "Where the font comes from: a system stack of the font registry, the project theme's font, a font-family list the host page loads (the theme's font-list rules, `isFontFamily`), or a font uploaded to the tale's project, by its id.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "source"
          ],
          "properties": {
            "source": {
              "type": "string",
              "enum": [
                "system",
                "theme",
                "name",
                "project"
              ]
            },
            "stack": {
              "type": "string",
              "enum": [
                "sans",
                "serif",
                "rounded",
                "monospace"
              ]
            },
            "family": {
              "type": "string",
              "maxLength": 200,
              "pattern": "^(?!.*(?:^|[\\s,\"'])(?:[iI][nN][hH][eE][rR][iI][tT]|[iI][nN][iI][tT][iI][aA][lL]|[uU][nN][sS][eE][tT]|[rR][eE][vV][eE][rR][tT]|[rR][eE][vV][eE][rR][tT]-[lL][aA][yY][eE][rR]|[dD][eE][fF][aA][uU][lL][tT])(?=$|[\\s,\"']))(?!.*(?:^|[\\s,\"'])[tT][aA][lL][eE][aA][rR][tT]-[fF][oO][nN][tT]-)\\s*(?:[A-Za-z][A-Za-z0-9 -]*|\"[A-Za-z0-9 -]+\"|'[A-Za-z0-9 -]+')\\s*(?:,\\s*(?:[A-Za-z][A-Za-z0-9 -]*|\"[A-Za-z0-9 -]+\"|'[A-Za-z0-9 -]+')\\s*)*$"
            },
            "fontId": {
              "description": "The id of a font of the tale's project (`project_fonts`).",
              "type": "string",
              "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            }
          },
          "allOf": [
            {
              "if": {
                "properties": {
                  "source": {
                    "const": "system"
                  }
                }
              },
              "then": {
                "required": [
                  "stack"
                ],
                "properties": {
                  "family": false,
                  "fontId": false
                }
              }
            },
            {
              "if": {
                "properties": {
                  "source": {
                    "const": "theme"
                  }
                }
              },
              "then": {
                "properties": {
                  "stack": false,
                  "family": false,
                  "fontId": false
                }
              }
            },
            {
              "if": {
                "properties": {
                  "source": {
                    "const": "name"
                  }
                }
              },
              "then": {
                "required": [
                  "family"
                ],
                "properties": {
                  "stack": false,
                  "fontId": false
                }
              }
            },
            {
              "if": {
                "properties": {
                  "source": {
                    "const": "project"
                  }
                }
              },
              "then": {
                "required": [
                  "fontId"
                ],
                "properties": {
                  "stack": false,
                  "family": false
                }
              }
            }
          ]
        },
        "fallback": {
          "description": "The system stack used until, or when, the font is not available.",
          "type": "string",
          "enum": [
            "sans",
            "serif",
            "rounded",
            "monospace"
          ]
        },
        "size": {
          "description": "The font size as a fraction of the canvas height.",
          "type": "number",
          "minimum": 0.01,
          "maximum": 0.2
        },
        "weight": {
          "type": "string",
          "enum": [
            "regular",
            "medium",
            "bold"
          ]
        },
        "italic": {
          "type": "boolean"
        },
        "color": {
          "description": "The text colour as #RRGGBB or #RRGGBBAA.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "align": {
          "description": "Where lines sit in the box; `start` and `end` follow the text direction.",
          "type": "string",
          "enum": [
            "start",
            "center",
            "end"
          ]
        },
        "direction": {
          "description": "The text direction: `auto` takes it from the first strong character.",
          "type": "string",
          "enum": [
            "auto",
            "rtl",
            "ltr"
          ]
        },
        "lineHeight": {
          "description": "The line height as a multiple of the font size.",
          "type": "number",
          "minimum": 0.8,
          "maximum": 3
        },
        "background": {
          "description": "Behind the text: nothing, a solid box filling the element, or a highlight behind each line.",
          "type": "string",
          "enum": [
            "none",
            "box",
            "highlight"
          ]
        },
        "backgroundColor": {
          "description": "The box or highlight colour as #RRGGBB or #RRGGBBAA.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        }
      }
    }
  },
  {
    "key": "image",
    "label": "Image",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "ImageElementProps",
      "description": "The props of an image element: an image (GIF included) of the tale's project, by its storage key, never a URL. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative`.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mediaKey",
        "fit"
      ],
      "properties": {
        "mediaKey": {
          "description": "The storage key of an image of the tale's project, as the server made it.",
          "type": "string",
          "maxLength": 200,
          "pattern": "^(tales|media)/[a-z0-9][a-z0-9-]{0,99}\\.(png|jpg|gif|webp|mp4|webm)$"
        },
        "fit": {
          "description": "How the media fills its box: `cover` crops it to fill the box, `contain` shows all of it.",
          "type": "string",
          "enum": [
            "cover",
            "contain"
          ]
        },
        "radius": {
          "description": "The corner radius as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.5
        },
        "opacity": {
          "description": "From 0 (transparent) to 1 (opaque); 1 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "taleMedia": {
          "description": "True on the tale's own media: the element the server keeps in step with the tale's media, which a tale from before documents, a dashboard upload and an import create. While it is the bottom element with the full-canvas box, unrotated, unrounded and opaque, viewers draw it full-bleed behind the canvas, as tale media always was. A document holds at most one.",
          "type": "boolean"
        }
      }
    }
  },
  {
    "key": "video",
    "label": "Video",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "VideoElementProps",
      "description": "The props of a video element: an MP4 or WebM video of the tale's project, by its storage key, never a URL. It plays muted and inline; a tale holds at most one, and then plays for the video's length. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative`.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mediaKey",
        "fit"
      ],
      "properties": {
        "mediaKey": {
          "description": "The storage key of a video of the tale's project, as the server made it.",
          "type": "string",
          "maxLength": 200,
          "pattern": "^(tales|media)/[a-z0-9][a-z0-9-]{0,99}\\.(png|jpg|gif|webp|mp4|webm)$"
        },
        "fit": {
          "description": "How the media fills its box: `cover` crops it to fill the box, `contain` shows all of it.",
          "type": "string",
          "enum": [
            "cover",
            "contain"
          ]
        },
        "radius": {
          "description": "The corner radius as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.5
        },
        "opacity": {
          "description": "From 0 (transparent) to 1 (opaque); 1 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "taleMedia": {
          "description": "True on the tale's own media: the element the server keeps in step with the tale's media, which a tale from before documents, a dashboard upload and an import create. While it is the bottom element with the full-canvas box, unrotated, unrounded and opaque, viewers draw it full-bleed behind the canvas, as tale media always was. A video so marked runs the tale for its whole length, with sound where the browser allows it, and does not count toward the one-video limit. A document holds at most one.",
          "type": "boolean"
        }
      }
    }
  },
  {
    "key": "shape",
    "label": "Shape",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "ShapeElementProps",
      "description": "The props of a shape element: a rectangle (with a corner radius), an ellipse or a line, built by clients from these values only, never from SVG or CSS text. Lengths are fractions of the canvas height. A line runs across the middle of its box, in its stroke colour and width, and turns with the box's rotation; it has no fill. A shape without a label is decorative.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "shape"
      ],
      "properties": {
        "shape": {
          "type": "string",
          "enum": [
            "rectangle",
            "ellipse",
            "line"
          ]
        },
        "fill": {
          "description": "The fill colour as #RRGGBB or #RRGGBBAA; no fill when left out.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "stroke": {
          "description": "The stroke colour as #RRGGBB or #RRGGBBAA; no stroke when left out.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "strokeWidth": {
          "description": "The stroke width as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.05
        },
        "radius": {
          "description": "A rectangle's corner radius as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.5
        },
        "opacity": {
          "description": "From 0 (transparent) to 1 (opaque); 1 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "shape": {
                "const": "ellipse"
              }
            },
            "required": [
              "shape"
            ]
          },
          "then": {
            "not": {
              "required": [
                "radius"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "shape": {
                "const": "line"
              }
            },
            "required": [
              "shape"
            ]
          },
          "then": {
            "required": [
              "stroke",
              "strokeWidth"
            ],
            "properties": {
              "strokeWidth": {
                "exclusiveMinimum": 0
              }
            },
            "allOf": [
              {
                "not": {
                  "required": [
                    "fill"
                  ]
                }
              },
              {
                "not": {
                  "required": [
                    "radius"
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    "key": "emoji",
    "label": "Emoji",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "EmojiElementProps",
      "description": "The props of an emoji sticker: one emoji, as Unicode text drawn in the platform's emoji font, never an image. The server accepts exactly one RGI emoji (`isEmojiGlyph`). Its accessible name is the element's `a11y.label`, which Tale Studio fills from the emoji's Unicode name and the author may edit.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "emoji"
      ],
      "properties": {
        "emoji": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    }
  },
  {
    "key": "sticker",
    "label": "Sticker",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "StickerElementProps",
      "description": "The props of an image sticker: a PNG, WebP or GIF of the tale's project, by its storage key, never a URL, shown whole inside its box. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative`.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mediaKey"
      ],
      "properties": {
        "mediaKey": {
          "description": "The storage key of a PNG, WebP or GIF image of the tale's project, as the server made it.",
          "type": "string",
          "maxLength": 200,
          "pattern": "^(tales|media)/[a-z0-9][a-z0-9-]{0,99}\\.(png|gif|webp)$"
        },
        "opacity": {
          "description": "From 0 (transparent) to 1 (opaque); 1 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      }
    }
  },
  {
    "key": "button",
    "label": "Button",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "ButtonElementProps",
      "description": "The props of a button: a call to action with a label, a style (filled or outline), colours and a corner radius, opening its destination in the same tab, or in a new tab without opener access. Clients render it as a link (`<a>`), named by its label. A draft may hold a button without a destination; publishing needs one.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "label",
        "variant",
        "color",
        "fill"
      ],
      "properties": {
        "label": {
          "description": "The text on the button: plain text on one line, its accessible name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "href": {
          "description": "The destination: an absolute http or https URL of at most 2,048 characters, without credentials, spaces or control characters. Servers check it in full; clients check it again before rendering.",
          "type": "string",
          "maxLength": 2048,
          "pattern": "^[hH][tT][tT][pP][sS]?://"
        },
        "newTab": {
          "description": "Opens the destination in a new tab, with `noopener`; the same tab when left out.",
          "type": "boolean"
        },
        "variant": {
          "description": "`filled` paints the button in `fill`; `outline` draws only its edge in `fill`.",
          "type": "string",
          "enum": [
            "filled",
            "outline"
          ]
        },
        "color": {
          "description": "The label colour as #RRGGBB or #RRGGBBAA.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "fill": {
          "description": "The button colour as #RRGGBB or #RRGGBBAA: its fill, or its edge for an outline button.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "radius": {
          "description": "The corner radius as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.5
        }
      }
    }
  },
  {
    "key": "image-button",
    "label": "Image button",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "ImageButtonElementProps",
      "description": "The props of a custom image button: an image of the tale's project, by its storage key, never a URL, that opens its destination. Its alt text is the element's `a11y.label`, the link's accessible name; publishing needs it (the decorative mark does not apply to a link) and a destination.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mediaKey"
      ],
      "properties": {
        "mediaKey": {
          "description": "The storage key of an image (PNG, JPEG, GIF or WebP) of the tale's project, as the server made it.",
          "type": "string",
          "maxLength": 200,
          "pattern": "^(tales|media)/[a-z0-9][a-z0-9-]{0,99}\\.(png|jpg|gif|webp)$"
        },
        "href": {
          "description": "The destination: an absolute http or https URL of at most 2,048 characters, without credentials, spaces or control characters.",
          "type": "string",
          "maxLength": 2048,
          "pattern": "^[hH][tT][tT][pP][sS]?://"
        },
        "newTab": {
          "description": "Opens the destination in a new tab, with `noopener`; the same tab when left out.",
          "type": "boolean"
        },
        "radius": {
          "description": "The corner radius as a fraction of the canvas height; 0 when left out.",
          "type": "number",
          "minimum": 0,
          "maximum": 0.5
        }
      }
    }
  },
  {
    "key": "swipe-up",
    "label": "Swipe-up link",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "SwipeUpElementProps",
      "description": "The props of a swipe-up link: a label pinned to the bottom safe area that opens its destination on a swipe up, a click, or Enter on the focused label. A tale holds at most one, and its box is the contract's `SWIPE_UP_BOX`. Clients render it as a link (`<a>`), named by its label. Publishing needs a destination.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "label",
        "color",
        "background"
      ],
      "properties": {
        "label": {
          "description": "The text of the link: plain text on one line, its accessible name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "href": {
          "description": "The destination: an absolute http or https URL of at most 2,048 characters, without credentials, spaces or control characters.",
          "type": "string",
          "maxLength": 2048,
          "pattern": "^[hH][tT][tT][pP][sS]?://"
        },
        "newTab": {
          "description": "Opens the destination in a new tab, with `noopener`; the same tab when left out.",
          "type": "boolean"
        },
        "color": {
          "description": "The label and arrow colour as #RRGGBB or #RRGGBBAA.",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        },
        "background": {
          "description": "The colour of the pill behind the label as #RRGGBB or #RRGGBBAA (#RRGGBB00 for none).",
          "type": "string",
          "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
        }
      }
    }
  },
  {
    "key": "poll",
    "label": "Poll",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "PollElementProps",
      "description": "The props of a poll: an optional title, a question and two options, each with an id that stays the same when its label is edited, so its count survives the edit, and a light or dark theme. All text is plain, on one line, without control characters. Clients render the options as buttons; a visitor's vote is posted to the Delivery API and the poll then shows each option's percentage. A tale holds at most one poll.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question",
        "options",
        "theme"
      ],
      "properties": {
        "title": {
          "description": "A short heading above the question; none when left out.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "question": {
          "description": "The question visitors answer.",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "options": {
          "description": "The two answers, in the order they show.",
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "label"
            ],
            "properties": {
              "id": {
                "description": "The option's id, unique in the poll and kept when its label changes: votes are counted by it.",
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,64}$"
              },
              "label": {
                "description": "The answer as visitors read it: its accessible name.",
                "type": "string",
                "minLength": 1,
                "maxLength": 60,
                "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
              }
            }
          }
        },
        "theme": {
          "description": "`light` draws dark text on a light card; `dark` light text on a dark card.",
          "type": "string",
          "enum": [
            "light",
            "dark"
          ]
        }
      }
    }
  },
  {
    "key": "rating",
    "label": "Rating",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "RatingElementProps",
      "description": "The props of a Rating: an optional title, a question and one emoji that a visitor slides along a scale from 0 to 100, and a light or dark theme. All text is plain, on one line, without control characters; the server accepts exactly one RGI emoji (`isEmojiGlyph`), as for the `emoji` type. Clients render a slider with the emoji as its thumb; a visitor's rating is posted to the Delivery API on release or on Enter, and the Rating then shows the count and average of all ratings. A tale holds at most one Rating.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question",
        "emoji",
        "theme"
      ],
      "properties": {
        "title": {
          "description": "A short heading above the question; none when left out.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "question": {
          "description": "The question visitors answer; the slider's accessible name.",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "emoji": {
          "description": "The emoji on the slider's thumb: one RGI emoji, drawn as text.",
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "theme": {
          "description": "`light` draws dark text on a light card; `dark` light text on a dark card.",
          "type": "string",
          "enum": [
            "light",
            "dark"
          ]
        }
      }
    }
  },
  {
    "key": "quiz",
    "label": "Quiz",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "QuizElementProps",
      "description": "The props of a quiz: an optional title, a question, two to four answers, each with an id that stays the same when its text is edited or it moves, so its count survives the edit, an optional correct answer and a light or dark theme. All text is plain, on one line, without control characters. The correct answer is delivered with the published document, so clients mark it at once (C10): a quiz is not a secure test. Clients render the answers as buttons; a visitor's answer is posted to the Delivery API and the quiz then shows whether it was right (when a correct answer is set), the correct answer and each answer's percentage. Without a correct answer it works as a survey and shows only the percentages. A tale holds at most one quiz.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question",
        "answers",
        "theme"
      ],
      "properties": {
        "title": {
          "description": "A short heading above the question; none when left out.",
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "question": {
          "description": "The question visitors answer.",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
        },
        "answers": {
          "description": "The two to four answers, in the order they show.",
          "type": "array",
          "minItems": 2,
          "maxItems": 4,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "label"
            ],
            "properties": {
              "id": {
                "description": "The answer's id, unique in the quiz and kept when its text changes or it moves: answers are counted by it.",
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,64}$"
              },
              "label": {
                "description": "The answer as visitors read it: its accessible name.",
                "type": "string",
                "minLength": 1,
                "maxLength": 60,
                "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$"
              }
            }
          }
        },
        "correctAnswerId": {
          "description": "The id of the correct answer, one of `answers`; when left out the quiz works as a survey.",
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{1,64}$"
        },
        "theme": {
          "description": "`light` draws dark text on a light card; `dark` light text on a dark card.",
          "type": "string",
          "enum": [
            "light",
            "dark"
          ]
        }
      }
    }
  }
];

/**
 * The registry's `testOnly` entries, each with its props schema (epic Tale Studio R8): taken only
 * where configured (`elementTypeRegistry({ testTypes: true })`), never by a production build.
 */
export const TALE_TEST_ELEMENT_TYPES: readonly {
  readonly key: string;
  readonly label: string;
  readonly schema: { readonly [key: string]: unknown };
}[] = [
  {
    "key": "test-badge",
    "label": "Test badge",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "TestBadgeElementProps",
      "description": "A test-only element type: it proves that a type registered by configuration reaches the studio's Add menu and inspector, the server's validation and the SDK's renderer lookup. It is `testOnly` in the registry: the server accepts it only with TALE_TEST_ELEMENT_TYPES=on outside production, the dashboard offers it only in development builds that opt in, and no SDK renders it.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "label",
        "color",
        "tone"
      ],
      "properties": {
        "label": {
          "description": "The badge's text, one line without control characters.",
          "type": "string",
          "minLength": 1,
          "maxLength": 40,
          "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e]*$"
        },
        "color": {
          "description": "The badge's colour, as #RRGGBB.",
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "tone": {
          "description": "Whether the badge is filled or outlined.",
          "type": "string",
          "enum": [
            "solid",
            "outline"
          ]
        },
        "count": {
          "description": "A number shown beside the label, 0 to 99.",
          "type": "integer",
          "minimum": 0,
          "maximum": 99
        }
      }
    }
  }
];
