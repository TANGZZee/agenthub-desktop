import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelConfig } from "./useModelConfig";

vi.mock("../../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: () => ({
    models: [],
    status: "unsupported",
  }),
}));

vi.mock("../../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
  /** Named custom provider. Absent for native providers. */
  providerLabel?: string;
}

function Harness(): React.JSX.Element {
  const { modelGroups } = useModelConfig();
  const labels = modelGroups.flatMap((group) =>
    group.models.map((model) => model.label),
  );
  return <output data-testid="models">{JSON.stringify(labels)}</output>;
}

// Exposes the grouping shape (header brand + each model's routing provider) so a
// test can assert brand grouping without changing routing.
function GroupHarness(): React.JSX.Element {
  const { modelGroups } = useModelConfig();
  const shape = modelGroups.map((g) => ({
    provider: g.provider,
    label: g.providerLabel,
    models: g.models.map((m) => ({ model: m.model, provider: m.provider })),
  }));
  return <output data-testid="groups">{JSON.stringify(shape)}</output>;
}

describe("useModelConfig", () => {
  let savedModels: SavedModel[];
  let emitModelLibraryChanged: (() => void) | null;

  beforeEach(() => {
    savedModels = [
      {
        id: "codex-gpt-55",
        name: "Codex CLI GPT-5.5",
        provider: "codex-cli",
        model: "gpt-5.5",
        baseUrl: "",
        createdAt: 1,
      },
    ];
    emitModelLibraryChanged = null;

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getModelConfig: vi.fn(async () => ({
          provider: "codex-cli",
          model: "gpt-5.5",
          baseUrl: "",
        })),
        listModels: vi.fn(async () => savedModels),
        onConnectionConfigChanged: vi.fn(() => vi.fn()),
        onModelLibraryChanged: vi.fn((callback: () => void) => {
          emitModelLibraryChanged = callback;
          return vi.fn();
        }),
        setModelConfig: vi.fn(async () => true),
        // The picker hides providers whose key env var is unset, so the mock
        // reports every provider these tests use as configured.
        getEnv: vi.fn(async () => ({
          DEEPSEEK_API_KEY: "sk-test",
          OPENAI_API_KEY: "sk-test",
        })),
      },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "hermesAPI");
  });

  it("reloads the chat picker when the model library changes", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("models")).toHaveTextContent(
        "Codex CLI GPT-5.5",
      );
    });

    savedModels = [
      ...savedModels,
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "",
        createdAt: 2,
      },
    ];

    await act(async () => {
      emitModelLibraryChanged?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("models")).toHaveTextContent("DeepSeek V4 Pro");
    });
  });

  it("groups a custom Hermes One model under the Hermes One brand while keeping custom routing", async () => {
    savedModels = [
      {
        id: "hs-swift",
        name: "hermesone-swift",
        provider: "custom",
        model: "hermesone-swift",
        baseUrl: "https://inference.hermesone.org/v1",
        createdAt: 1,
      },
    ];

    render(<GroupHarness />);

    await waitFor(() => {
      const groups = JSON.parse(
        screen.getByTestId("groups").textContent || "[]",
      );
      const hs = groups.find(
        (g: { label: string }) => g.label === "Hermes One",
      );
      expect(hs).toBeTruthy();
      // Not lumped under the generic OpenAI-compatible bucket.
      expect(hs.provider).toBe("hermesone");
      // Routing stays on `custom` + the base URL so the request still resolves.
      expect(hs.models[0]).toEqual({
        model: "hermesone-swift",
        provider: "custom",
      });
    });
  });

  // Regression: two *named* custom providers may share one base URL while
  // serving different catalogues. Grouping by brand alone collapsed both into
  // the generic "custom" bucket, so two identically-named models were rendered
  // as indistinguishable rows. The named label now drives the group identity,
  // while `provider`/`baseUrl` still carry the routing.
  it("separates two named custom providers that share one base URL", async () => {
    const shared = "https://gateway.example.com/v1";
    savedModels = [
      {
        id: "a-gpt4o",
        name: "gpt-4o",
        provider: "custom",
        model: "gpt-4o",
        baseUrl: shared,
        createdAt: 1,
        providerLabel: "Provider A",
      },
      {
        id: "b-gpt4o",
        name: "gpt-4o",
        provider: "custom",
        model: "gpt-4o",
        baseUrl: shared,
        createdAt: 2,
        providerLabel: "Provider B",
      },
    ];

    render(<GroupHarness />);

    await waitFor(() => {
      const groups = JSON.parse(
        screen.getByTestId("groups").textContent || "[]",
      );
      const labels = groups.map((g: { label: string }) => g.label);
      // Two distinct entries named after the providers, not one "custom" blob.
      expect(labels).toContain("Provider A");
      expect(labels).toContain("Provider B");

      const a = groups.find((g: { label: string }) => g.label === "Provider A");
      const b = groups.find((g: { label: string }) => g.label === "Provider B");
      // Each keeps its own single model, and both still route via `custom` +
      // the shared base URL.
      expect(a.models).toEqual([{ model: "gpt-4o", provider: "custom" }]);
      expect(b.models).toEqual([{ model: "gpt-4o", provider: "custom" }]);
    });
  });
});
