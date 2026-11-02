import type { TemplateStyle } from "../../../shared/domain";
import { FONT_CHOICES } from "../../../shared/schemas/settings";
import { ListBoxItem } from "../../components/ui/list-box";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { DOCUMENT_FONT_FACES } from "../../lib/document-fonts";
import { AccentColorField } from "../settings/accent-color-field";
import { useBrandKit } from "../settings/queries";

const BRAND_FONT = "__brand";
const FALLBACK_ACCENT = "#1f5a4e";

/**
 * The template's look: its own accent color and font, or the brand kit's, and the style
 * options. A sent document keeps the look of its template at the time it was sent.
 */
export function TemplateStyleSection({
  style,
  readOnly,
  onChange,
}: {
  style: TemplateStyle;
  readOnly: boolean;
  onChange: (style: TemplateStyle) => void;
}) {
  const brandKit = useBrandKit();
  const brandAccent = brandKit.data?.accentColor ?? FALLBACK_ACCENT;
  const brandFont =
    FONT_CHOICES.find((f) => f.id === brandKit.data?.font)?.label ?? FONT_CHOICES[0].label;
  const set = <K extends keyof TemplateStyle>(key: K, value: TemplateStyle[K]) =>
    onChange({ ...style, [key]: value });

  return (
    <Section title="Style" description="Leave the color and font on the brand kit to follow it.">
      <style>{DOCUMENT_FONT_FACES}</style>
      <div className="flex flex-col gap-4">
        <Switch
          isDisabled={readOnly}
          isSelected={style.accentColor === null}
          onChange={(useBrand) => set("accentColor", useBrand ? null : brandAccent)}
        >
          Use the brand kit color
        </Switch>
        {style.accentColor !== null ? (
          <AccentColorField
            value={style.accentColor}
            onChange={(hex) => set("accentColor", hex)}
            isDisabled={readOnly}
          />
        ) : null}
        <Select
          label="Font"
          isDisabled={readOnly}
          value={style.font ?? BRAND_FONT}
          onChange={(key) => key !== null && set("font", key === BRAND_FONT ? null : String(key))}
        >
          <ListBoxItem id={BRAND_FONT} textValue={`Brand kit font (${brandFont})`}>
            Brand kit font ({brandFont})
          </ListBoxItem>
          {FONT_CHOICES.map((choice) => (
            <ListBoxItem
              key={choice.id}
              id={choice.id}
              textValue={choice.label}
              style={{ fontFamily: choice.stack }}
            >
              {choice.label}
            </ListBoxItem>
          ))}
        </Select>
        <div className="flex flex-col gap-1">
          <Switch
            isDisabled={readOnly}
            isSelected={style.striped}
            onChange={(on) => set("striped", on)}
          >
            Striped line items
          </Switch>
          <Switch
            isDisabled={readOnly}
            isSelected={style.compact}
            onChange={(on) => set("compact", on)}
            description="Smaller type and less space, for long item lists."
          >
            Compact spacing
          </Switch>
          <Switch
            isDisabled={readOnly}
            isSelected={style.centeredHeader}
            onChange={(on) => set("centeredHeader", on)}
          >
            Centered header
          </Switch>
          <Switch
            isDisabled={readOnly}
            isSelected={style.showHomeCurrency}
            onChange={(on) => set("showHomeCurrency", on)}
            description="For a document in another currency, show the total in your home currency and the exchange rate under the totals. The client pays in the document currency."
          >
            Show home-currency total
          </Switch>
        </div>
      </div>
    </Section>
  );
}
