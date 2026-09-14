export type AppTheme = "glass" | "direct";
const KEY = "agenthub.uiTheme";

export function readStoredTheme(): AppTheme {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "direct" || value === "glass" ? value : "glass";
  } catch {
    return "glass";
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
