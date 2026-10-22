// Generated from libs/contract/tale-document/ by scripts/generate-tale-document-schemas.mjs; do not edit.
// Run `npm exec nx -- run contract:generate` after changing a schema file.

/** `tale-document/v1.schema.json`: the tale document's envelope (AD-15). */
export const TALE_DOCUMENT_V1_SCHEMA: { readonly [key: string]: unknown } = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TaleDocument",
  "description": "A tale document, version 1 (AD-15): the canvas and the elements of one tale. Each element's `props` are checked against the schema its `type` names in `element-types/registry.json`; an unknown type is refused on write and skipped by clients.",
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
      "description": "An image (GIF included) of the tale's project filling the canvas (epic Tale Studio R2), by its storage key (AD-11). It is decorative. `color` fills the bands `contain` leaves, and the canvas until the image shows.",
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
      "description": "The props of a text element (epic Tale Studio R4): plain Unicode text, never HTML or Markdown, wrapped inside the element's box. A line feed starts a new line. Every style prop is optional (an additive change); one left out takes its default from the contract (`DEFAULT_TEXT_STYLE`), which is how text looked before styling. Styles are enumerated or range-checked values, never CSS text (AD-15).",
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
          "description": "Where the font comes from: a system stack of the font registry, the project theme's font, a font-family list the host page loads (the theme's font-list rules, `isFontFamily`), or a font uploaded to the tale's project (story 7.17), by its id.",
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
      "description": "The props of an image element (epic Tale Studio R5): an image (GIF included) of the tale's project, by its storage key (AD-11), never a URL. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative` (R12).",
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
      "description": "The props of a video element (epic Tale Studio R5): an MP4 or WebM video of the tale's project, by its storage key (AD-11), never a URL. It plays muted and inline; a tale holds at most one, and then plays for the video's length. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative` (R12).",
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
      "description": "The props of a shape element (epic Tale Studio R6): a rectangle (with a corner radius), an ellipse or a line, built by clients from these values only, never from SVG or CSS text (AD-16). Lengths are fractions of the canvas height. A line runs across the middle of its box, in its stroke colour and width, and turns with the box's rotation; it has no fill. A shape without a label is decorative.",
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
      "description": "The props of an emoji sticker (epic Tale Studio R6): one emoji, as Unicode text drawn in the platform's emoji font, never an image. The server accepts exactly one RGI emoji (`isEmojiGlyph`). Its accessible name is the element's `a11y.label`, which Tale Studio fills from the emoji's Unicode name and the author may edit.",
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
      "description": "The props of an image sticker (epic Tale Studio R6): a PNG, WebP or GIF of the tale's project, by its storage key (AD-11), never a URL, shown whole inside its box. Its alt text is the element's `a11y.label`; publishing needs it, or `a11y.decorative` (R12).",
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
  }
];
