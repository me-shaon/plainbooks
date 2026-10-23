import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientForm, emptyClientValues } from "./client-form";

afterEach(cleanup);

function renderForm(props: Partial<Parameters<typeof ClientForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ClientForm
      initialValues={emptyClientValues()}
      isOwner
      taxRates={[]}
      templates={[]}
      submitLabel="Create client"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe("ClientForm", () => {
  it("shows the shared schema errors and does not submit invalid values", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByRole("textbox", { name: /^Email/ }), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(await screen.findByText("Enter the client name")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed values with null for empty optional fields", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByRole("textbox", { name: /^Client name/ }), "Northwind");
    await user.type(screen.getByRole("textbox", { name: /^Email/ }), "ana@northwind.test");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Northwind",
        defaultCurrency: "BDT",
        paymentTermsDays: null,
        contacts: [{ name: "", email: "ana@northwind.test", isPrimary: true, isBilling: true }],
      }),
    );
  });

  it("tells a Member that only an Owner can turn on auto-send", () => {
    renderForm({ isOwner: false });
    expect(screen.getAllByText("Only an Owner can turn on auto-send")).toHaveLength(2);
  });

  it("disables auto-send settings for a Member when the client already uses auto-send", () => {
    renderForm({
      isOwner: false,
      initialValues: {
        ...emptyClientValues(),
        reminderMode: "auto_send",
        recurringSendMode: "auto_send",
      },
    });
    expect(screen.getAllByText("Only an Owner can change this")).toHaveLength(2);
    const reminders = screen.getByText("Reminders").closest(".group");
    if (!(reminders instanceof HTMLElement)) throw new Error("Reminders field not found");
    const button = within(reminders).getByRole("button");
    expect(button).toHaveProperty("disabled", true);
  });

  it("shows no auto-send note for an Owner", () => {
    renderForm({ isOwner: true });
    expect(screen.queryByText(/Only an Owner/)).toBeNull();
  });
});
