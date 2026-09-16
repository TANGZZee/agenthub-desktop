import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const scratch = join(tmpdir(), "pi-provision-test-" + randomUUID());
const modelsFile = join(scratch, "models.json");
mkdirSync(scratch, { recursive: true });

// `HERMES_HOME` is resolved once when `installer` is first imported, so it must
// be set before any module under test is loaded. This keeps the model library
// in a scratch directory instead of the user's real Hermes home.
process.env.HERMES_HOME = scratch;

// `provisionPiConfig` writes under Electron's userData, which does not exist in
// a unit test — so stub `app.getPath` to a scratch directory before importing.
vi.mock("electron", () => ({
  app: { getPath: () => scratch },
}));

const {
  buildPiModelsDocument,
  provisionPiConfig,
  readProvisionedConfig,
  removeProvisionedConfig,
  provisionedModelId,
} = await import("../src/main/agenthub/pi-provisioning");

function writeLibrary(rows: unknown): void {
  mkdirSync(scratch, { recursive: true });
  writeFileSync(modelsFile, JSON.stringify(rows), "utf-8");
}

afterEach(() => {
  removeProvisionedConfig("pi");
});

/**
 * Provisioning a coding CLI with the Hermes model library.
 *
 * A worker CLI resolves models against its own config, and Pi has no
 * environment variable for a custom base URL — only `models.json`. So "use the
 * model I picked in Hermes" requires writing the CLI's own config file, into a
 * directory of our own so the user's real config is never touched.
 */

describe("building the Pi models document", () => {
  it("turns a library custom endpoint into a Pi provider", () => {
    writeLibrary([
      {
        id: "m1",
        name: "My DeepSeek",
        provider: "custom",
        model: "deepseek-v4-flash",
        baseUrl: "https://example.test/v1",
        apiMode: "openai-completions",
        providerLabel: "Jy",
        createdAt: 0,
      },
    ]);

    const doc = buildPiModelsDocument({ CUSTOM_API_KEY: "sk-test" });
    const provider = doc.providers.Jy;
    expect(provider).toBeDefined();
    expect(provider.baseUrl).toBe("https://example.test/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.apiKey).toBe("sk-test");
    expect(provider.models.map((m) => m.id)).toEqual(["deepseek-v4-flash"]);
  });

  it("groups every model sharing one endpoint under a single provider", () => {
    writeLibrary([
      {
        id: "a", name: "A", provider: "custom", model: "model-a",
        baseUrl: "https://one.test/v1", providerLabel: "One", createdAt: 0,
      },
      {
        id: "b", name: "B", provider: "custom", model: "model-b",
        baseUrl: "https://one.test/v1", providerLabel: "One", createdAt: 0,
      },
    ]);

    const doc = buildPiModelsDocument({ OPENAI_API_KEY: "k" });
    expect(Object.keys(doc.providers)).toEqual(["One"]);
    expect(doc.providers.One.models.map((m) => m.id).sort()).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  it("skips an endpoint whose key cannot be resolved", () => {
    // Writing a placeholder would make Pi list models that cannot answer,
    // which is worse than not listing them at all.
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "some-model",
        baseUrl: "https://nokey.test/v1", createdAt: 0,
      },
    ]);
    expect(buildPiModelsDocument({}).providers).toEqual({});
  });

  it("prefers the per-label provider key over the shared fallback", () => {
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "m1",
        baseUrl: "https://labelled.test/v1", providerLabel: "My Provider",
        createdAt: 0,
      },
    ]);
    const doc = buildPiModelsDocument({
      CUSTOM_PROVIDER_MY_PROVIDER_KEY: "per-label",
      CUSTOM_API_KEY: "shared",
    });
    expect(doc.providers["My Provider"].apiKey).toBe("per-label");
  });

  it("completes a bare origin with /v1", () => {
    // Hermes stores the endpoint as typed and its own engine appends `/v1`.
    // A CLI takes the value as an OpenAI base URL, so a bare origin would post
    // to the site's HTML landing page — a 200 whose body is not a completion,
    // surfacing as "stream ended without finish_reason".
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "m1",
        baseUrl: "https://bare.test", providerLabel: "Bare", createdAt: 0,
      },
    ]);
    const doc = buildPiModelsDocument({ CUSTOM_API_KEY: "k" });
    expect(doc.providers.Bare.baseUrl).toBe("https://bare.test/v1");
  });

  it("leaves an endpoint that already states a path alone", () => {
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "m1",
        baseUrl: "http://localhost:7863/v1", providerLabel: "Local", createdAt: 0,
      },
    ]);
    const doc = buildPiModelsDocument({ CUSTOM_API_KEY: "k" });
    expect(doc.providers.Local.baseUrl).toBe("http://localhost:7863/v1");
  });
});

describe("provisioning the config directory", () => {
  it("writes models.json and returns the directory to point the CLI at", () => {
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "glm-5.3-flash",
        baseUrl: "https://provision.test/v1", providerLabel: "P", createdAt: 0,
      },
    ]);

    const dir = provisionPiConfig("pi", { CUSTOM_API_KEY: "k" });
    expect(dir).toBeTruthy();
    expect(existsSync(join(dir!, "models.json"))).toBe(true);
    expect(readProvisionedConfig("pi")?.providers.P).toBeDefined();
  });

  it("returns null when there is nothing to provision", () => {
    writeLibrary([]);
    expect(provisionPiConfig("pi", { CUSTOM_API_KEY: "k" })).toBeNull();
  });

  it("removes a previously written directory", () => {
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "m1",
        baseUrl: "https://rm.test/v1", providerLabel: "R", createdAt: 0,
      },
    ]);
    const dir = provisionPiConfig("pi", { CUSTOM_API_KEY: "k" });
    expect(dir).toBeTruthy();
    removeProvisionedConfig("pi");
    expect(readProvisionedConfig("pi")).toBeNull();
  });
});

describe("qualifying a model id", () => {
  it("resolves a bare library model to provider/model", () => {
    // Pi addresses models as `provider/model`; a library model chosen by bare
    // name is otherwise rejected as unknown.
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "glm-5.3-flash",
        baseUrl: "https://qual.test/v1", providerLabel: "Jy", createdAt: 0,
      },
    ]);
    provisionPiConfig("pi", { CUSTOM_API_KEY: "k" });
    expect(provisionedModelId("pi", "glm-5.3-flash")).toBe("Jy/glm-5.3-flash");
  });

  it("leaves an already-qualified id alone", () => {
    expect(provisionedModelId("pi", "Jy/glm-5.3-flash")).toBe(
      "Jy/glm-5.3-flash",
    );
  });

  it("returns null for a model that was never provisioned", () => {
    expect(provisionedModelId("pi", "some-other-model")).toBeNull();
  });
});

describe("the user's real config is never touched", () => {
  it("writes only inside the provisioned directory", () => {
    writeLibrary([
      {
        id: "m", name: "M", provider: "custom", model: "m1",
        baseUrl: "https://safe.test/v1", providerLabel: "S", createdAt: 0,
      },
    ]);
    const dir = provisionPiConfig("pi", { CUSTOM_API_KEY: "k" })!;
    // The generated file lives under the provisioned dir, not the library file.
    expect(dir.startsWith(scratch)).toBe(true);
    expect(dir).toContain("agenthub-cli-config");
    // The library file is untouched by provisioning.
    expect(JSON.parse(readFileSync(modelsFile, "utf-8")).length).toBe(1);
  });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});
