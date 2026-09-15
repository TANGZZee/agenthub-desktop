import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock("../assets/icons", () => ({
  Search: () => null,
  X: () => null,
  Check: () => null,
  Plus: () => null,
}));

vi.mock("./common/BrandLogo", () => ({ default: () => null }));

import RegistryBrowserModal from "./RegistryBrowserModal";

// A registry provider that hermes-agent recognises, so the attachment is stored
// against the provider id itself rather than the `custom` fallback.
const REGISTRY = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      models: [{ name: "gpt-4o", label: "GPT-4o" }],
    },
  ],
};

interface Bridge {
  listModels: ReturnType<typeof vi.fn>;
  removeModel: ReturnType<typeof vi.fn>;
  addModel: ReturnType<typeof vi.fn>;
  setModelDefinition: ReturnType<typeof vi.fn>;
  fetchModelRegistry: ReturnType<typeof vi.fn>;
}

function installBridge(removeResult: boolean): Bridge {
  const bridge: Bridge = {
    listModels: vi
      .fn()
      .mockResolvedValue([
        { id: "row-1", provider: "openai", model: "gpt-4o", baseUrl: "" },
      ]),
    removeModel: vi.fn().mockResolvedValue(removeResult),
    addModel: vi.fn().mockResolvedValue(undefined),
    setModelDefinition: vi.fn().mockResolvedValue(undefined),
    fetchModelRegistry: vi.fn().mockResolvedValue(REGISTRY),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: bridge as unknown as typeof window.hermesAPI,
  });
  return bridge;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("RegistryBrowserModal removal", () => {
  // @lat: [[model-selection#Registry removal]]
  it("removes the library row by its id, not by the model name", async () => {
    const bridge = installBridge(true);
    const { container } = render(<RegistryBrowserModal onClose={vi.fn()} />);

    const added = await waitFor(() => {
      const node = container.querySelector(".registry-model-remove");
      expect(node).not.toBeNull();
      return node as HTMLButtonElement;
    });

    fireEvent.click(added);

    // `remove-model` filters on the row's UUID; passing the model name was a
    // silent no-op that left the button looking dead.
    await waitFor(() =>
      expect(bridge.removeModel).toHaveBeenCalledWith("row-1"),
    );
    expect(bridge.removeModel).not.toHaveBeenCalledWith("gpt-4o");
  });

  it("reports a failure instead of silently keeping the row", async () => {
    const bridge = installBridge(false);
    const { container } = render(<RegistryBrowserModal onClose={vi.fn()} />);

    const added = await waitFor(() => {
      const node = container.querySelector(".registry-model-remove");
      expect(node).not.toBeNull();
      return node as HTMLButtonElement;
    });

    fireEvent.click(added);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(bridge.removeModel).toHaveBeenCalledWith("row-1");
  });
});
