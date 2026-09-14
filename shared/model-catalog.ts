export interface CatalogModel {
  id: string;
  label: string;
  provider: string;
  note?: string;
}

const KEY = "agenthub.modelCatalog.v1";

export const DEFAULT_MODEL_CATALOG: CatalogModel[] = [
  { id: "haiku", label: "Haiku", provider: "anthropic", note: "快而便宜，适合简单阅读" },
  { id: "sonnet", label: "Sonnet", provider: "anthropic", note: "均衡，默认推荐" },
  { id: "opus", label: "Opus", provider: "anthropic", note: "最强，适合复杂任务" },
  { id: "qwen3-coder", label: "Qwen3 Coder", provider: "cc-switch", note: "代码任务" },
  { id: "deepseek-v4-flash", label: "DeepSeek Flash", provider: "cc-switch", note: "快速代码" },
  { id: "glm-4-flash", label: "GLM-4 Flash", provider: "cc-switch", note: "快速通用" },
];

export function loadModelCatalog(): CatalogModel[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CatalogModel[];
  } catch {
    /* ignore */
  }
  return DEFAULT_MODEL_CATALOG;
}

export function saveModelCatalog(models: CatalogModel[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(models));
}
