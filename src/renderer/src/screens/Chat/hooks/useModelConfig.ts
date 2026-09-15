import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS, displayBrandFromConfig } from "../../../constants";
import { useDiscoveredModels } from "../../../hooks/useDiscoveredModels";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

/**
 * Named providers (deepseek, groq, anthropic, …) have a hardcoded canonical
 * base_url in hermes-agent's PROVIDER_REGISTRY, so a stored `baseUrl` on those
 * entries can be stale and would misroute the request. Keep the baseUrl only
 * for `custom` and `ollama-cloud` entries, where it is authoritative; clear it
 * otherwise so the backend falls back to the provider's canonical URL. Shared
 * by `selectModel` and the chat-screen session override so they can't drift.
 */
export function effectiveOverrideBaseUrl(
  provider: string,
  baseUrl: string,
): string {
  return provider === "custom" || provider === OLLAMA_CLOUD_PROVIDER
    ? baseUrl
    : "";
}

interface SavedModelForPicker {
  provider: string;
  model: string;
  name: string;
  baseUrl?: string;
}

function mergeLiveOllamaCloudModels(
  savedModels: SavedModelForPicker[],
  liveModels: string[],
  liveStatus: string,
): SavedModelForPicker[] {
  if (liveStatus !== "ok" || liveModels.length === 0) {
    return savedModels;
  }

  const liveEntries = Array.from(new Set(liveModels))
    .sort()
    .map((model) => ({
      provider: OLLAMA_CLOUD_PROVIDER,
      model,
      name: `Ollama Cloud · ${model}`,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
    }));

  return [
    ...savedModels.filter((model) => model.provider !== OLLAMA_CLOUD_PROVIDER),
    ...liveEntries,
  ];
}

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    options?: { persist?: boolean },
  ) => Promise<void>;
}

function groupModelsByProvider(models: SavedModelForPicker[]): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    // Group by display brand so OpenAI-compatible providers stored as `custom`
    // (Hermes One, Groq, …) show under their own header instead of the generic
    // "OpenAI Compatible / Local" bucket. Each model keeps its raw provider +
    // baseUrl below so selection/routing is unchanged.
    const brand = displayBrandFromConfig(m.provider, m.baseUrl || "");
    if (!groupMap.has(brand)) {
      groupMap.set(brand, {
        provider: brand,
        providerLabel: PROVIDERS.labels[brand] || brand,
        models: [],
      });
    }
    groupMap.get(brand)!.models.push({
      provider: m.provider,
      model: m.model,
      label: m.name,
      baseUrl: m.baseUrl || "",
    });
  }
  return Array.from(groupMap.values());
}

/**
 * Whether two grouped lists render identically. The grouping effect below
 * rebuilds groups whenever its input array changes identity — which happens on
 * every render while the live-discovery hook returns a fresh array — so
 * comparing content first keeps a no-op update from re-rendering forever.
 */
function sameModelGroups(left: ModelGroup[], right: ModelGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a.provider !== b.provider || a.providerLabel !== b.providerLabel) {
      return false;
    }
    if (a.models.length !== b.models.length) return false;
    for (let j = 0; j < a.models.length; j += 1) {
      const x = a.models[j];
      const y = b.models[j];
      if (
        x.provider !== y.provider ||
        x.model !== y.model ||
        x.label !== y.label ||
        x.baseUrl !== y.baseUrl
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Whether a model from `provider` belongs in the picker. Providers whose API
 * key env var is unset have no way to serve a request, so their models only
 * clutter the list; they reappear automatically once a key is saved. Unknown
 * mappings and `custom` providers (whose keys resolve per host) are always
 * kept, and the currently selected model is never hidden.
 */
function providerServesModel(
  provider: string,
  model: string,
  currentProvider: string,
  currentModel: string,
  env: Record<string, string> | null,
): boolean {
  if (provider === "custom") return true;
  if (provider === currentProvider && model === currentModel) return true;
  if (env === null) return true;
  const entry = PROVIDERS.setup.find(
    (item) => item.id === provider || item.configProvider === provider,
  );
  if (!entry) return true;
  // An empty envKey means the provider does not authenticate through a stored
  // environment variable at all — OAuth providers (Nous, openai-codex) and the
  // local presets. `env[""]` is always undefined, so without this guard their
  // already-saved models would be hidden even though nothing is missing.
  if (!entry.envKey) return true;
  const value = env[entry.envKey];
  return typeof value === "string" && value.trim().length > 0;
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelForPicker[]>([]);
  // Env values for the active profile. `null` = not loaded yet (show
  // everything) or load failed (fail open rather than hide usable models).
  const [configuredEnv, setConfiguredEnv] = useState<Record<
    string,
    string
  > | null>(null);
  const loadSeqRef = useRef(0);
  useEffect(() => {
    // Older main processes (and test doubles) may not expose `getEnv`. Treat a
    // missing handler like an unresolved read: `null` keeps every model visible
    // rather than hiding usable ones behind an unknown key state.
    const readEnv = window.hermesAPI?.getEnv;
    if (typeof readEnv !== "function") {
      setConfiguredEnv(null);
      return;
    }
    let alive = true;
    try {
      readEnv
        .call(window.hermesAPI, profile)
        .then((env) => {
          if (alive) setConfiguredEnv(env ?? {});
        })
        .catch(() => {
          if (alive) setConfiguredEnv(null);
        });
    } catch {
      setConfiguredEnv(null);
    }
    return () => {
      alive = false;
    };
  }, [profile]);
  const ollamaCloudDiscovery = useDiscoveredModels({
    provider: OLLAMA_CLOUD_PROVIDER,
    profile,
    enabled: true,
  });
  const modelsForPicker = useMemo(
    () =>
      mergeLiveOllamaCloudModels(
        savedModels.filter((m) =>
          providerServesModel(
            m.provider,
            m.model,
            currentProvider,
            currentModel,
            configuredEnv,
          ),
        ),
        ollamaCloudDiscovery.models,
        ollamaCloudDiscovery.status,
      ),
    [
      savedModels,
      ollamaCloudDiscovery.models,
      ollamaCloudDiscovery.status,
      currentProvider,
      currentModel,
      configuredEnv,
    ],
  );

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current;
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    if (seq !== loadSeqRef.current) return;
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setSavedModels(savedModels);
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const next = groupModelsByProvider(modelsForPicker);
    // Keep the previous array when nothing changed: the input identity churns
    // every render, so an unconditional set would loop.
    setModelGroups((previous) =>
      sameModelGroups(previous, next) ? previous : next,
    );
  }, [modelsForPicker]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModelGroups([]);
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      { persist = true }: { persist?: boolean } = {},
    ): Promise<void> => {
      const effectiveBaseUrl = effectiveOverrideBaseUrl(provider, baseUrl);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
      // Session-only selection: update local state only, do not write to
      // config.yaml so the global default model is preserved (issue #688).
      // Advance the sequence counter so any in-flight reload() triggered by
      // onConnectionConfigChanged / onModelLibraryChanged cannot clobber the
      // session-scoped selection with the persisted value.
      if (!persist) {
        ++loadSeqRef.current;
        return;
      }
      const seq = ++loadSeqRef.current;
      try {
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          effectiveBaseUrl,
          profile,
        );
        const mc = await window.hermesAPI.getModelConfig(profile);
        if (seq !== loadSeqRef.current) return;
        setCurrentModel(mc.model);
        setCurrentProvider(mc.provider);
        setCurrentBaseUrl(mc.baseUrl);
      } catch (err) {
        if (seq === loadSeqRef.current) await reload();
        throw err;
      }
    },
    [profile, reload],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
