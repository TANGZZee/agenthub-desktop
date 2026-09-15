import { describe, it, expect, vi } from "vitest";

// installer.ts transitively imports modules that pull in `electron` at value
// scope, so stub it before the dynamic import (same pattern as
// installer-utils.test.ts).
vi.mock("electron", () => ({
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
  },
  ipcMain: {
    on: (): void => {},
    handle: (): void => {},
    removeHandler: (): void => {},
    removeAllListeners: (): void => {},
  },
}));

const { summarizeUpdateFailure } = await import("../src/main/installer");

/**
 * The real refusal `hermes update` prints when another process still runs from
 * the install's venv — the case that surfaced as a bare "exit code 2" in the
 * UI.
 */
const VENV_BUSY_LOG = [
  "☤ Updating Hermes Agent...",
  "",
  "→ Fleet: 1 running service(s) across profiles: default",
  "◆ Pre-update snapshot: 20260915-103506-pre-update",
  "◆ Sibling profile snapshot(s): default, zj, zj-editor",
  "",
  "✗ Other Hermes processes are running from this install's venv:",
  "  PID 23848  pythonw.exe  ...  ← hermes dashboard (stop it: hermes dashboard stop, or close that terminal)",
  "  On Windows these keep native extension files (.pyd) locked, so the",
  "  dependency update would fail partway and leave a broken install.",
  "  Close the Hermes desktop app / other Hermes terminals, then re-run:",
  "    hermes update",
].join("\n");

describe("summarizeUpdateFailure", () => {
  // @lat: [[desktop-updates#Engine update failure reporting]]
  it("keeps the CLI's explanation instead of only the exit code", () => {
    const message = summarizeUpdateFailure(VENV_BUSY_LOG, 2);

    expect(message).toContain("Update failed (exit code 2).");
    // The reason a user can act on must survive.
    expect(message).toContain(
      "Other Hermes processes are running from this install's venv",
    );
    expect(message).toContain("hermes update");
    // Leading noise (the banner + snapshot lines) is dropped.
    expect(message).not.toContain("Pre-update snapshot");
  });

  it("strips ANSI colours and blank lines", () => {
    const message = summarizeUpdateFailure(
      "\u001b[31m✗ nope\u001b[0m\n\n\n\u001b[2m  reason\u001b[0m\n",
      3,
    );

    expect(message).toBe("Update failed (exit code 3).\n\n✗ nope\n  reason");
    expect(message).not.toContain("\u001b");
  });

  it("falls back to the log tail when the CLI marks no refusal", () => {
    const message = summarizeUpdateFailure("a\nb\nc\nd", 1);
    expect(message).toBe("Update failed (exit code 1).\n\na\nb\nc\nd");
  });

  it("reports a plain message when the CLI printed nothing", () => {
    expect(summarizeUpdateFailure("", 2)).toBe("Update failed (exit code 2).");
    expect(summarizeUpdateFailure("  \n \n", 2)).toBe(
      "Update failed (exit code 2).",
    );
  });

  it("handles a signal-terminated run", () => {
    expect(summarizeUpdateFailure("", null)).toBe(
      "Update failed (exit code unknown).",
    );
  });
});
