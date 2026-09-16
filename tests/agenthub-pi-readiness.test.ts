import { describe, expect, it, vi } from "vitest";
import {
  createPiWorkerProfile,
  PI_CREDENTIAL_HINT,
  PI_CREDENTIAL_PROVIDERS,
} from "../src/main/agenthub/profiles";

/**
 * Pi readiness gating.
 *
 * Readiness is a property of the **model**, not only the vendor: this desktop's
 * model picker offers the Hermes model library, so a working setup often has
 * credentials only under the user's own named endpoints and none of Pi's
 * built-in vendors. Gating on the built-in vendor list alone therefore rejected
 * setups that run fine — a user who had picked a model still saw "no usable
 * model credentials".
 */

describe("Pi readiness probes", () => {
  it("probes the chosen model first when one is set", () => {
    const profile = createPiWorkerProfile(true, "Jy/glm-5.3-flash");
    const probes = profile.preflight?.probes ?? [];
    expect(probes.length).toBeGreaterThan(0);
    // The most specific signal must lead, so a working custom-endpoint model
    // satisfies the gate before any built-in vendor probe is consulted.
    expect(probes[0]).toEqual([
      "auth",
      "check",
      "--model",
      "Jy/glm-5.3-flash",
      "--no-refresh",
    ]);
  });

  it("still offers the built-in vendors as a fallback", () => {
    const profile = createPiWorkerProfile(true, "Jy/glm-5.3-flash");
    const probes = profile.preflight?.probes ?? [];
    for (const provider of PI_CREDENTIAL_PROVIDERS) {
      expect(probes).toContainEqual([
        "auth",
        "check",
        "--provider",
        provider,
        "--no-refresh",
      ]);
    }
  });

  it("omits the model probe when nothing is selected", () => {
    // Without a model, Pi resolves a default of its own, so only the vendor
    // probes are meaningful — a `--model` probe with an empty value would be
    // rejected by the CLI and could never pass.
    const profile = createPiWorkerProfile(true, null);
    const probes = profile.preflight?.probes ?? [];
    expect(probes.every((args) => !args.includes("--model"))).toBe(true);
    expect(probes.length).toBe(PI_CREDENTIAL_PROVIDERS.length);
  });

  it("names both failure modes in the hint", () => {
    // The two causes (no credential vs. unknown model) are indistinguishable
    // from the gate but need different fixes, so the message must not send
    // someone to re-authenticate when the real fix is a different model.
    expect(PI_CREDENTIAL_HINT).toContain("--list-models");
    expect(PI_CREDENTIAL_HINT).toMatch(/凭据|credential/i);
    expect(PI_CREDENTIAL_HINT).toMatch(/模型|model/i);
  });
});
