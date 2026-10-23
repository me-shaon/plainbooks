/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Dialog, DialogTrigger, Modal } from "./dialog";
import { Pill } from "./pill";
import { contrastRatio, STATUS_LABELS, STATUS_TOKENS, STATUSES } from "./status";

// Vitest does not load CSS in tests, so read the stylesheet from disk.
const styles = readFileSync(resolve(import.meta.dirname, "../../styles.css"), "utf8");

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button and fires onPress", async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = vi.fn();
    render(
      <Button onPress={onPress} isDisabled>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveProperty("disabled", true);
    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  it("traps focus and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <DialogTrigger>
          <Button>Open</Button>
          <Modal>
            <Dialog title="Edit client">
              <input aria-label="Name" />
            </Dialog>
          </Modal>
        </DialogTrigger>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab moves through the dialog's controls and wraps. It never reaches "Outside".
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Pill", () => {
  it.each(STATUSES)("%s uses its token pair with contrast of at least 4.5:1", (status) => {
    const { bg, fg } = STATUS_TOKENS[status];
    expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(4.5);

    // The CSS variables match the token table.
    const name = status.replace("_", "-");
    expect(styles).toContain(`--pill-${name}: ${bg};`);
    expect(styles).toContain(`--pill-${name}-foreground: ${fg};`);

    render(<Pill status={status} />);
    const pill = screen.getByText(STATUS_LABELS[status]);
    expect(pill.className).toContain(`bg-pill-${name}`);
    expect(pill.className).toContain(`text-pill-${name}-foreground`);
  });
});
