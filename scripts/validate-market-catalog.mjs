#!/usr/bin/env node
/**
 * Validate docs/catalog/agenthub-market.json.
 *
 * This is the *authoring* gate: it catches typos and missing fields before a
 * commit, so a broken catalog never reaches the app or the web page.
 *
 * It is deliberately independent from the runtime parser in
 * src/shared/agenthub-market.ts. They have different jobs — this one proves the
 * file is well-formed, that one defends against a tampered network response or
 * cache — so they are written twice on purpose.
 *
 * Usage:
 *   node scripts/validate-market-catalog.mjs [path]
 *
 * Exits 1 with a list of problems.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEFAULT_PATH = join(ROOT, "docs", "catalog", "agenthub-market.json");

const CATALOG_VERSION = 1;

const LIMITS = {
  agents: 300,
  id: 64,
  name: 80,
  vendor: 80,
  role: 60,
  description: 400,
  installHint: 200,
  url: 300,
  binariesPerPlatform: 6,
  binaryName: 64,
  permissionsPerEntry: 8,
};

const CATEGORIES = ["official", "open-source", "vendor-cli", "china-ecosystem"];
const PERMISSIONS = [
  "read",
  "grep",
  "find",
  "ls",
  "project-root",
  "read-only-sandbox",
  "no-write",
  "planned",
];

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const BINARY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkText(value, where, label, max) {
  if (typeof value !== "string") {
    fail(where, `${label} must be a string`);
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    fail(where, `${label} must not be empty`);
    return;
  }
  if (trimmed !== value) {
    fail(where, `${label} has leading/trailing whitespace`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    fail(
      where,
      `${label} contains a control character or newline — installHint is copied into a terminal, so it must stay one line`,
    );
  }
  if (trimmed.length > max) {
    fail(where, `${label} is ${trimmed.length} chars (max ${max})`);
  }
}

function checkLocalized(value, where, label, max) {
  if (!isPlainObject(value)) {
    fail(where, `${label} must be an object with zh and en`);
    return;
  }
  checkText(value.zh, where, `${label}.zh`, max);
  checkText(value.en, where, `${label}.en`, max);
}

function checkBinaries(value, where) {
  if (!isPlainObject(value)) {
    fail(where, "binaries must be an object with win and unix arrays");
    return;
  }
  let total = 0;
  for (const key of ["win", "unix"]) {
    const list = value[key];
    if (!Array.isArray(list)) {
      fail(where, `binaries.${key} must be an array`);
      continue;
    }
    if (list.length === 0) {
      fail(where, `binaries.${key} must list at least one executable name`);
    }
    if (list.length > LIMITS.binariesPerPlatform) {
      fail(
        where,
        `binaries.${key} has ${list.length} entries (max ${LIMITS.binariesPerPlatform})`,
      );
    }
    const seen = new Set();
    for (const name of list) {
      if (typeof name !== "string" || !name.trim()) {
        fail(where, `binaries.${key} contains a non-string entry`);
        continue;
      }
      total += 1;
      if (!BINARY_PATTERN.test(name)) {
        fail(
          where,
          `binaries.${key} entry "${name}" is not a bare executable name (no paths, no wildcards)`,
        );
      }
      if (name.length > LIMITS.binaryName) {
        fail(where, `binaries.${key} entry "${name}" is too long`);
      }
      if (seen.has(name)) {
        fail(where, `binaries.${key} repeats "${name}"`);
      }
      seen.add(name);
    }
  }
  if (total === 0) {
    fail(
      where,
      "no executable names at all — this entry could never be detected as installed",
    );
  }
}

function checkDoc(catalog) {
  if (!isPlainObject(catalog)) {
    fail("<root>", "catalog must be a JSON object");
    return;
  }
  if (
    typeof catalog.version !== "number" ||
    !Number.isFinite(catalog.version)
  ) {
    fail("<root>", "version must be a number");
  } else if (catalog.version > CATALOG_VERSION) {
    fail(
      "<root>",
      `version ${catalog.version} is newer than this validator understands (${CATALOG_VERSION})`,
    );
  }
  if (!Array.isArray(catalog.agents)) {
    fail("<root>", "agents must be an array");
    return;
  }
  if (catalog.agents.length === 0) {
    fail("<root>", "agents must not be empty");
    return;
  }
  if (catalog.agents.length > LIMITS.agents) {
    fail(
      "<root>",
      `agents has ${catalog.agents.length} entries (max ${LIMITS.agents})`,
    );
  }

  const ids = new Map();
  const ranks = new Map();

  catalog.agents.forEach((entry, index) => {
    const where = `<agents[${index}]>`;
    if (!isPlainObject(entry)) {
      fail(where, "entry must be an object");
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    const label = id ? `agent "${id}"` : where;

    if (!id) {
      fail(where, "id is required");
    } else if (!ID_PATTERN.test(id)) {
      fail(label, `id must match ${ID_PATTERN} (lowercase, no spaces)`);
    } else if (ids.has(id)) {
      fail(label, `duplicate id — first seen at index ${ids.get(id)}`);
    } else {
      ids.set(id, index);
    }

    checkText(entry.name, label, "name", LIMITS.name);
    checkText(entry.vendor, label, "vendor", LIMITS.vendor);
    checkLocalized(entry.role, label, "role", LIMITS.role);
    checkLocalized(entry.description, label, "description", LIMITS.description);
    checkText(entry.installHint, label, "installHint", LIMITS.installHint);
    checkBinaries(entry.binaries, label);

    if (typeof entry.category !== "string") {
      fail(label, "category is required");
    } else if (!CATEGORIES.includes(entry.category)) {
      fail(
        label,
        `category "${entry.category}" is unknown (expected one of ${CATEGORIES.join(", ")})`,
      );
    }

    if (typeof entry.docsUrl !== "string") {
      fail(label, "docsUrl is required");
    } else {
      checkText(entry.docsUrl, label, "docsUrl", LIMITS.url);
      try {
        const url = new URL(entry.docsUrl);
        if (url.protocol !== "https:") {
          fail(label, `docsUrl must be https (got ${url.protocol})`);
        }
      } catch {
        fail(label, `docsUrl "${entry.docsUrl}" is not a valid URL`);
      }
    }

    if (entry.rank !== undefined) {
      if (typeof entry.rank !== "number" || !Number.isInteger(entry.rank)) {
        fail(label, "rank must be an integer when present");
      } else if (entry.rank < 1) {
        fail(label, "rank must be >= 1");
      } else if (ranks.has(entry.rank)) {
        fail(
          label,
          `rank ${entry.rank} is already used by "${ranks.get(entry.rank)}"`,
        );
      } else {
        ranks.set(entry.rank, id);
      }
    }

    if (entry.permissions !== undefined) {
      if (!Array.isArray(entry.permissions)) {
        fail(label, "permissions must be an array when present");
      } else if (entry.permissions.length > LIMITS.permissionsPerEntry) {
        fail(
          label,
          `permissions has ${entry.permissions.length} entries (max ${LIMITS.permissionsPerEntry})`,
        );
      } else {
        for (const token of entry.permissions) {
          if (!PERMISSIONS.includes(token)) {
            fail(
              label,
              `permission "${token}" is unknown (expected one of ${PERMISSIONS.join(", ")})`,
            );
          }
        }
      }
    }

    if (entry.runner !== undefined) {
      // Not part of the schema on purpose: whether an agent can be connected is
      // decided by the app's local reviewed-runner list, never by this file.
      fail(
        label,
        "runner must not appear in the catalog — connectability is decided locally by the app",
      );
    }
  });
}

const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;

let raw;
try {
  raw = readFileSync(target, "utf8");
} catch (err) {
  console.error(`无法读取清单文件: ${target}\n  ${err.message}`);
  process.exit(1);
}

let catalog;
try {
  catalog = JSON.parse(raw);
} catch (err) {
  console.error(`清单不是合法 JSON: ${target}\n  ${err.message}`);
  process.exit(1);
}

checkDoc(catalog);

if (problems.length > 0) {
  console.error(`清单校验失败（${problems.length} 个问题）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const count = catalog.agents.length;
console.log(`✅ 清单校验通过：${count} 个智能体  (${target})`);
