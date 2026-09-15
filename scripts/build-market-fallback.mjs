#!/usr/bin/env node
/**
 * Generate the app's built-in fallback table from the catalog JSON.
 *
 * The desktop needs a list to show when the network is unavailable and no cache
 * exists yet. It cannot `import` the JSON directly: `docs/` is outside the
 * tsconfig `include` roots and `resolveJsonModule` is off, so a cross-tree
 * import would not compile. Generating a TypeScript module sidesteps both.
 *
 * The generated file is data-only — same fields the remote document may carry,
 * and deliberately no `runner`. Whether an agent can be connected is decided
 * locally in src/main/agenthub/profiles.ts, never by catalog data.
 *
 * Usage:
 *   node scripts/build-market-fallback.mjs [--check]
 *
 * `--check` verifies the generated file is up to date without writing it
 * (used by tests); without it the file is rewritten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CATALOG = join(ROOT, "docs", "catalog", "agenthub-market.json");
const TARGET = join(ROOT, "src", "main", "agenthub", "market.generated.ts");

const checkOnly = process.argv.includes("--check");

const raw = readFileSync(CATALOG, "utf8");
let catalog;
try {
  catalog = JSON.parse(raw);
} catch (err) {
  console.error(`清单不是合法 JSON: ${CATALOG}\n  ${err.message}`);
  process.exit(1);
}

if (!catalog || !Array.isArray(catalog.agents) || catalog.agents.length === 0) {
  console.error("清单里没有 agents，先生成有意义的数据再同步。");
  process.exit(1);
}

// Emit fields in a fixed order so the output is stable across runs, and only
// the fields the runtime parser understands.
function renderEntry(entry, indent) {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  const lines = [];
  lines.push(`${pad}{`);
  lines.push(`${inner}id: ${JSON.stringify(entry.id)},`);
  if (typeof entry.rank === "number") {
    lines.push(`${inner}rank: ${entry.rank},`);
  }
  lines.push(`${inner}name: ${JSON.stringify(entry.name)},`);
  lines.push(`${inner}vendor: ${JSON.stringify(entry.vendor)},`);
  lines.push(`${inner}category: ${JSON.stringify(entry.category)},`);
  lines.push(
    `${inner}role: { zh: ${JSON.stringify(entry.role.zh)}, en: ${JSON.stringify(entry.role.en)} },`,
  );
  lines.push(`${inner}description: {`);
  lines.push(`${inner}  zh: ${JSON.stringify(entry.description.zh)},`);
  lines.push(`${inner}  en: ${JSON.stringify(entry.description.en)},`);
  lines.push(`${inner}},`);
  lines.push(`${inner}docsUrl: ${JSON.stringify(entry.docsUrl)},`);
  lines.push(`${inner}installHint: ${JSON.stringify(entry.installHint)},`);
  lines.push(`${inner}binaries: {`);
  lines.push(
    `${inner}  win: [${entry.binaries.win.map((n) => JSON.stringify(n)).join(", ")}],`,
  );
  lines.push(
    `${inner}  unix: [${entry.binaries.unix.map((n) => JSON.stringify(n)).join(", ")}],`,
  );
  lines.push(`${inner}},`);
  const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
  lines.push(
    `${inner}permissions: [${permissions.map((p) => JSON.stringify(p)).join(", ")}],`,
  );
  lines.push(`${pad}},`);
  return lines.join("\n");
}

const body = catalog.agents.map((entry) => renderEntry(entry, 2)).join("\n");

const output = `// GENERATED FILE — do not edit by hand.
//
// Source: docs/catalog/agenthub-market.json
// Regenerate: npm run catalog:sync
//
// This is the desktop's offline fallback for the market catalog. It is the same
// data the remote document carries; which agents are *runnable* is decided in
// profiles.ts, not here.

import type { MarketEntryDraft } from "../../shared/agenthub-market";

/** Date the catalog was last edited upstream, for display only. */
export const MARKET_UPDATED_AT = ${JSON.stringify(catalog.updatedAt ?? "")};

export const MARKET_ENTRIES: readonly MarketEntryDraft[] = [
${body}
];
`;

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    console.error(
      `内置兜底表不存在：${TARGET}\n跑 npm run catalog:sync 生成。`,
    );
    process.exit(1);
  }
  if (current !== output) {
    console.error(
      "内置兜底表与 docs/catalog/agenthub-market.json 不一致。\n" +
        "跑 npm run catalog:sync 重新生成。",
    );
    process.exit(1);
  }
  console.log(`✅ 内置兜底表是最新的（${catalog.agents.length} 个智能体）`);
} else {
  writeFileSync(TARGET, output, "utf8");
  console.log(
    `✅ 已生成内置兜底表：${TARGET}（${catalog.agents.length} 个智能体）`,
  );
}
