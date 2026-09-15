import { describe, expect, it } from "vitest";
import { resources } from "./index";

/**
 * Locale coverage guard.
 *
 * A missing translation key silently falls back to English, so a page can look
 * half-translated with nothing failing. This suite fails instead: every key
 * English ships must exist in zh-CN.
 *
 * Values that legitimately stay English (brand names, font names, protocol
 * identifiers) are not asserted here — only key presence is, since that is the
 * signal that a new string was added without its translation.
 */

type Leaf = { path: string; value: unknown };

function flatten(value: unknown, prefix = ""): Leaf[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: prefix, value }];
  }
  const out: Leaf[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...flatten(child, path));
  }
  return out;
}

const english = flatten(resources.en.translation);
const chinese = new Set(
  flatten(resources["zh-CN"].translation).map((leaf) => leaf.path),
);

describe("zh-CN locale coverage", () => {
  // @lat: [[localization#Chinese coverage guard]]
  it("has a translation for every English key", () => {
    const missing = english
      .map((leaf) => leaf.path)
      .filter((path) => !chinese.has(path));

    // Printed in full so a failing run names exactly what to add.
    expect(
      missing,
      `${missing.length} English key(s) have no zh-CN translation`,
    ).toEqual([]);
  });

  it("translates the AgentHub worker vocabulary", () => {
    const keys = [
      "navigation.workers",
      "models.registryTitle",
      "models.registryAddedLabel",
      "models.registryAddButton",
    ];
    for (const key of keys) {
      expect(chinese.has(key), `${key} missing from zh-CN`).toBe(true);
    }
  });

  it("keeps interpolation placeholders intact", () => {
    const placeholder = /\{\{\s*(\w+)\s*\}\}/g;
    const tokensOf = (text: string): string[] =>
      [...text.matchAll(placeholder)].map((m) => m[1]).sort();

    const mismatched: string[] = [];
    for (const leaf of flatten(resources["zh-CN"].translation)) {
      if (typeof leaf.value !== "string") continue;
      const source = flatten(resources.en.translation).find(
        (item) => item.path === leaf.path,
      );
      if (!source || typeof source.value !== "string") continue;
      const expected = tokensOf(source.value);
      const actual = tokensOf(leaf.value);
      if (expected.join() !== actual.join()) {
        mismatched.push(
          `${leaf.path}: en=[${expected.join(",")}] zh=[${actual.join(",")}]`,
        );
      }
    }
    expect(mismatched).toEqual([]);
  });
});
