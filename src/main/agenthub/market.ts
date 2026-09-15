/**
 * The market candidate table, as data.
 *
 * The entries used to be authored in this file. They now live in
 * `docs/catalog/agenthub-market.json`, which is the single source for both the
 * published web page and the app, and are compiled into
 * `market.generated.ts` by `npm run catalog:sync`.
 *
 * At runtime the app prefers a fetched document, then a cache, and falls back to
 * this shipped table last — see `market-source.ts`, which is what callers should
 * use. This module exists so the shipped table can be imported directly (tests,
 * and the fallback path).
 *
 * There is no `runner` field on purpose: whether an agent can be connected is
 * decided locally by `REVIEWED_RUNNER_IDS` in profiles.ts, never by catalog
 * data.
 */

export { MARKET_ENTRIES, MARKET_UPDATED_AT } from "./market.generated";

export type { MarketEntryDraft } from "../../shared/agenthub-market";
