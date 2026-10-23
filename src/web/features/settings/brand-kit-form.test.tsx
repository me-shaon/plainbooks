import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandKit } from "../../../shared/schemas/settings";
import { BrandKitForm, logoFileError } from "./brand-kit-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kit: BrandKit = {
  businessName: "Ledger Studio",
  logoKey: null,
  logoUrl: null,
  accentColor: "#2f7f6f",
  font: "instrument-sans",
  address: null,
  taxId: null,
  bankDetails: null,
  footerText: null,
};

function renderForm(readOnly: boolean) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <BrandKitForm kit={kit} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe("BrandKitForm", () => {
  it("is read-only for a Member", () => {
    renderForm(true);
    expect(screen.queryByRole("button", { name: "Save brand kit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload logo/ })).toBeNull();
    const name = screen.getByRole("textbox", { name: "Business name" });
    expect(name).toHaveProperty("disabled", true);
  });

  it("shows the hex color error and does not call the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    renderForm(false);

    const accent = screen.getByRole("textbox", { name: "Accent color" });
    await user.clear(accent);
    await user.type(accent, "teal");
    await user.click(screen.getByRole("button", { name: "Save brand kit" }));

    expect(await screen.findByText("Enter a hex color such as #2f7f6f")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("logoFileError", () => {
  it("accepts small PNG, JPG, and SVG files", () => {
    for (const type of ["image/png", "image/jpeg", "image/svg+xml"]) {
      expect(logoFileError(new File(["x"], "logo", { type }))).toBeNull();
    }
  });

  it("rejects other types and files over 1 MB", () => {
    expect(logoFileError(new File(["x"], "logo.gif", { type: "image/gif" }))).toMatch(/PNG/);
    const big = new File([new Uint8Array(1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    expect(logoFileError(big)).toMatch(/1 MB/);
  });
});
