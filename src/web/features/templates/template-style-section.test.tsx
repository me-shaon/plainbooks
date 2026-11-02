import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEMPLATE_STYLE, type TemplateStyle } from "../../../shared/domain";
import { copyName } from "./template-editor";
import { TemplateStyleSection } from "./template-style-section";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ onStyle }: { onStyle: (style: TemplateStyle) => void }) {
  const [style, setStyle] = useState(DEFAULT_TEMPLATE_STYLE);
  return (
    <TemplateStyleSection
      style={style}
      readOnly={false}
      onChange={(next) => {
        setStyle(next);
        onStyle(next);
      }}
    />
  );
}

function renderSection(onStyle: (style: TemplateStyle) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ accentColor: "#2f7f6f", font: "inter" })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness onStyle={onStyle} />
    </QueryClientProvider>,
  );
}

describe("TemplateStyleSection", () => {
  it("starts from the brand kit color and sets its own", async () => {
    const changes: TemplateStyle[] = [];
    const user = userEvent.setup();
    renderSection((style) => changes.push(style));
    expect(screen.queryByRole("textbox", { name: "Accent color" })).toBeNull();
    // Wait for the brand kit, so the own color starts from it.
    await screen.findAllByText("Brand kit font (Inter)");
    await user.click(screen.getByRole("switch", { name: "Use the brand kit color" }));
    expect(changes.at(-1)?.accentColor).toBe("#2f7f6f");
    expect(screen.getByRole("textbox", { name: "Accent color" })).toBeTruthy();
  });

  it("turns the style options on", async () => {
    const changes: TemplateStyle[] = [];
    const user = userEvent.setup();
    renderSection((style) => changes.push(style));
    await user.click(screen.getByRole("switch", { name: "Striped line items" }));
    await user.click(screen.getByRole("switch", { name: /Compact spacing/ }));
    await user.click(screen.getByRole("switch", { name: "Centered header" }));
    expect(changes.at(-1)).toMatchObject({ striped: true, compact: true, centeredHeader: true });
  });
});

describe("copyName", () => {
  it("adds copy and keeps the name within 80 characters", () => {
    expect(copyName("Agency standard")).toBe("Agency standard copy");
    expect(copyName("x".repeat(80))).toHaveLength(80);
  });
});
