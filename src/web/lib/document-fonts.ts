import { FONT_CHOICES, FONT_WEIGHTS, fontFileName } from "../../shared/schemas/settings";

/**
 * `@font-face` rules for every document font, from the files that public pages use. The
 * browser loads a file only when the preview or the font list shows that font.
 */
export const DOCUMENT_FONT_FACES = FONT_CHOICES.flatMap((choice) =>
  FONT_WEIGHTS.map(
    (weight) =>
      `@font-face{font-family:${choice.stack.split(",")[0]};font-weight:${weight};font-display:swap;src:url(/p/assets/fonts/${fontFileName(choice.id, weight)}) format("woff2")}`,
  ),
).join("\n");
