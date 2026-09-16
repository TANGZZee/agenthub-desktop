/**
 * Locale access for the ported 996 office engine.
 *
 * Upstream (MIT, `noya21th/996`) had its own `i18n.ts` exposing `getLocale()`.
 * This desktop already has a locale source of truth, so the engine reads that
 * instead of maintaining a second one — the ported status strings then follow
 * the app's language picker automatically.
 */
import { getLocale as appGetLocale } from "../../../../../shared/i18n";

export function getLocale(): string {
  return appGetLocale();
}
