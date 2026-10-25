# PlainBooks brand

The approved folded-invoice identity, finalized in teal and ink. Start with `logos/plainbooks-color.svg` for light backgrounds and `logos/plainbooks-dark.svg` for dark backgrounds. SVGs contain outlined shapes, with no external fonts or linked images.

## Assets

| Folder | Contents |
| --- | --- |
| `logos/` | Horizontal logo in color, dark-background, ink monochrome (`black`), and white. SVG plus transparent PNG at 640, 1280, and 2560 px wide. |
| `icons/` | Standalone mark in the same four colors, SVG plus 64, 256, and 512 px PNG. App icon at 192, 512, and 1024 px; full-bleed maskable app icon at 192 and 512 px for Android; opaque 180 px Apple touch icon; simplified favicon SVG, 16/32/48 px PNG, and multi-resolution ICO. |
| `social/` | 1200 × 630 social preview card, SVG and PNG. |
| `source/` | Approved concept, transparent generated master, generation prompt, and reproducible vector/export script. |
| `preview.png` | Light, dark, ink, and white logo comparison. |
| `colors.json` | Brand color tokens. |

## Color and typography

| Color | Hex | Use |
| --- | --- | --- |
| Ink | `#171a18` | Invoice outline and “Plain”; monochrome logo |
| Teal | `#2f7f6f` | Fold and “Books” on light surfaces |
| Mint | `#86bdb1` | Fold and “Books” on dark surfaces |
| Paper | `#f6f7f5` | Light presentation background |
| Tint | `#e3f1ee` | Icon tile background |
| White | `#ffffff` | Reversed logo |

The wordmark is custom outlined artwork derived from the approved generated concept, not a typeset font. Do not retype it. Use the project's Instrument Sans for supporting UI and IBM Plex Mono for numeric details.

## Usage

- Keep clear space of at least one invoice-rule length around the artwork. Transparent file padding is a technical margin, not the full recommended clear space.
- Use the horizontal logo at 180 px wide or larger. Use the standalone mark at 32 px or larger; use the simplified favicon below that size.
- Preserve proportions, colors, and the space between the symbol and wordmark. Avoid shadows, gradients, outlines, or placement over busy imagery.
- Use `white` for single-color reversed applications and `black` for single-color light-background applications. The `black` asset uses brand ink rather than pure black.
- SVG is preferred for web and scalable graphics. PNG exports use transparency except the social card and Apple touch icon. Colors are RGB; a printer should handle any required CMYK conversion.

## Production notes

The built-in imagegen tool isolated the approved horizontal concept. The export script converts that raster master into flat, outlined SVG paths, removes tiny trace artifacts, normalizes colors, and exports PNGs. The standalone icon is reconstructed with clean geometric paths; the favicon is deliberately simplified for small sizes. The source master retains the generated appearance for reference.

The app serves copies of the favicon, the Apple touch icon, and the 192 and 512 px app icons from `public/`. `public/icon-192.png` and `public/icon-512.png` are the `app-icon` exports. `public/icon-maskable-192.png` and `public/icon-maskable-512.png` are the `app-icon-maskable` exports. After you regenerate the icons, copy them to `public/` again.

To regenerate with Node.js and Sharp available:

```sh
node brand/source/export.mjs
# Or pass the absolute entry-point path to an existing Sharp installation.
magick brand/icons/favicon-16.png brand/icons/favicon-32.png brand/icons/favicon-48.png brand/icons/favicon.ico
```

The ICO export requires ImageMagick. No extra dependency was added to the application.
