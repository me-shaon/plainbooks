import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimingFields, type TimingValues } from "./timing-fields";

afterEach(cleanup);

const values: TimingValues = {
  frequency: "monthly",
  startDate: "2026-11-01",
  endDate: null,
  sendMode: "inherit",
};

describe("TimingFields", () => {
  it("tells a Member that only an Owner can turn on auto-send", () => {
    render(
      <TimingFields
        values={values}
        onChange={vi.fn()}
        isOwner={false}
        initialSendMode="inherit"
        errors={{}}
      />,
    );
    expect(screen.getByText("Only an Owner can turn on auto-send")).toBeTruthy();
  });

  it("locks the send mode for a Member when the schedule is on auto-send", () => {
    render(
      <TimingFields
        values={{ ...values, sendMode: "auto_send" }}
        onChange={vi.fn()}
        isOwner={false}
        initialSendMode="auto_send"
        errors={{}}
      />,
    );
    expect(screen.getByText("Only an Owner can change this")).toBeTruthy();
    const button = screen.getAllByRole("button").find((b) => b.textContent?.includes("Auto-send"));
    expect(button?.hasAttribute("disabled") || button?.getAttribute("data-disabled") !== null).toBe(
      true,
    );
  });

  it("shows no note to an Owner", () => {
    render(
      <TimingFields
        values={values}
        onChange={vi.fn()}
        isOwner
        initialSendMode="inherit"
        errors={{}}
      />,
    );
    expect(screen.queryByText("Only an Owner can turn on auto-send")).toBeNull();
  });
});
