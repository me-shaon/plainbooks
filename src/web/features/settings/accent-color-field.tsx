import {
  type Color,
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  Dialog,
  DialogTrigger,
  parseColor,
  Button as RACButton,
  SliderTrack,
} from "react-aria-components";
import { HEX_COLOR } from "../../../shared/schemas/settings";
import { Popover } from "../../components/ui/popover";
import { TextField } from "../../components/ui/text-field";
import { cn } from "../../components/ui/utils";

/**
 * Suggested accents. Each one is dark enough for white text on the bold layout header
 * and for colored text on white.
 */
export const ACCENT_PRESETS = [
  "#1f5a4e",
  "#2f7f6f",
  "#15803d",
  "#1d4ed8",
  "#1e3a8a",
  "#4338ca",
  "#6d28d9",
  "#9d174d",
  "#b91c1c",
  "#c2410c",
  "#a16207",
  "#334155",
] as const;

const FALLBACK = "#1f5a4e";

function toHex(color: Color): string {
  return color.toString("hex").toLowerCase();
}

const thumb =
  "size-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)] data-[focus-visible]:size-6";

/**
 * The accent color: a hex text field, and a swatch button that opens a picker with the
 * suggested colors, a saturation and brightness area, and a hue slider.
 */
export function AccentColorField({
  value,
  onChange,
  isDisabled,
  errorProps,
}: {
  value: string;
  onChange: (hex: string) => void;
  isDisabled?: boolean;
  errorProps?: { isInvalid?: boolean; errorMessage?: string };
}) {
  const valid = HEX_COLOR.test(value);
  const color = parseColor(valid ? value : FALLBACK).toFormat("hsb");
  return (
    <ColorPicker value={color} onChange={(next) => onChange(toHex(next))}>
      <div className="flex items-end gap-3">
        <TextField
          label="Accent color"
          className="flex-1"
          isDisabled={isDisabled}
          inputClassName="figure"
          value={value}
          onChange={onChange}
          description="Pick a color, or enter a hex code."
          {...errorProps}
        />
        <DialogTrigger>
          <RACButton
            aria-label="Pick the accent color"
            isDisabled={isDisabled}
            className="mb-6 size-10 shrink-0 cursor-pointer rounded-button border border-border p-0 outline-none data-[disabled]:cursor-not-allowed data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring"
            style={{ backgroundColor: valid ? value : "transparent" }}
          />
          <Popover placement="bottom end" className="min-w-0 p-4">
            <Dialog aria-label="Accent color" className="flex w-64 flex-col gap-4 outline-none">
              <div className="flex flex-col gap-2">
                <p className="m-0 text-xs font-medium text-muted-foreground">Suggested</p>
                <ColorSwatchPicker className="grid grid-cols-6 gap-2">
                  {ACCENT_PRESETS.map((preset) => (
                    <ColorSwatchPickerItem
                      key={preset}
                      color={preset}
                      // The picker compares HSB values, which can miss an exact hex match. So
                      // the ring follows the stored hex value.
                      className={cn(
                        "cursor-pointer rounded-small outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring",
                        preset === value.toLowerCase() && "outline-2 outline-offset-2 outline-ink",
                      )}
                    >
                      <ColorSwatch className="size-8 rounded-small" />
                    </ColorSwatchPickerItem>
                  ))}
                </ColorSwatchPicker>
              </div>
              <div className="flex flex-col gap-2">
                <p className="m-0 text-xs font-medium text-muted-foreground">Custom</p>
                <ColorArea
                  colorSpace="hsb"
                  xChannel="saturation"
                  yChannel="brightness"
                  className="h-40 w-full rounded-small"
                >
                  <ColorThumb className={thumb} />
                </ColorArea>
                <ColorSlider colorSpace="hsb" channel="hue" aria-label="Hue">
                  <SliderTrack className="h-6 w-full rounded-small">
                    <ColorThumb className={`${thumb} top-1/2`} />
                  </SliderTrack>
                </ColorSlider>
              </div>
            </Dialog>
          </Popover>
        </DialogTrigger>
      </div>
    </ColorPicker>
  );
}
