"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PLATFORM_META, PLATFORMS, PlatformKey } from "@/lib/platform-meta";
import { Plus, RefreshCw, Search, ServerCog, Trash2 } from "lucide-react";

type Provider = {
  id: string;
  name: string;
  api_url: string;
  is_active: boolean;
};

type PanelService = {
  service: string;
  name: string;
  type?: string;
  category?: string;
  rate?: string;
  min?: string;
  max?: string;
};

type Preset = {
  id: string;
  platform: string;
  service_type: string;
  slot_index: number;
  api_provider_id: string | null;
  panel_service_id: string | null;
  quantity: number;
  keywords?: string[] | null;
  is_fallback?: boolean;
  enabled: boolean;
};

type DraftPreset = {
  api_provider_id: string | null;
  panel_service_id: string | null;
  quantity: number;
  keywords: string[];
  keyword_input: string;
  is_fallback: boolean;
  enabled: boolean;
};

const DEFAULT_SERVICE_TYPES: Record<string, string[]> = {
  x: ["views", "likes", "retweets", "comments", "broadcast"],
  instagram: ["views", "likes", "comments", "shares"],
  tiktok: ["views", "likes", "comments", "shares"],
  linkedin: ["likes", "comments", "shares"],
  youtube: ["views", "likes", "comments", "subscribers"],
  kick: ["plays"],
  twitch: ["plays"],
};

function makeRowKey(serviceType: string, slotIndex: number) {
  return `${serviceType}:${slotIndex}`;
}

function parseKeywordsInput(input: string) {
  return [...new Set(
    input
      .split(/[\n,]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function normalizeKeywords(keywords: string[] | null | undefined) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return [];
  }

  return [...new Set(
    keywords
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export default function ServicesPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [panelServices, setPanelServices] = useState<PanelService[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [platform, setPlatform] = useState<PlatformKey>("x");
  const [loadingServices, setLoadingServices] = useState(false);
  const [syncingSlots, setSyncingSlots] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingRows, setEditingRows] = useState<Record<string, DraftPreset>>({});

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();

    setProviders(data.providers ?? []);

    if (!providerId && data.providers?.[0]?.id) {
      setProviderId(data.providers[0].id);
    }
  }, [providerId]);

  const loadPresets = useCallback(async () => {
    const res = await fetch("/api/service-presets");
    const data = await res.json();
    setPresets(data.presets ?? []);
  }, []);

  async function loadPanelServices() {
    if (!providerId) {
      setError("Add an API provider in Settings first.");
      return;
    }

    setLoadingServices(true);
    setError(null);

    try {
      const res = await fetch(`/api/panel/services?providerId=${providerId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error);
      }

      setPanelServices(data.services ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unexpected error.");
    } finally {
      setLoadingServices(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProviders();
    void loadPresets();
  }, [loadPresets, loadProviders]);

  function getPreset(serviceType: string, slotIndex: number): Preset | undefined {
    return presets.find(
      (preset) =>
        preset.platform === platform &&
        preset.service_type === serviceType &&
        Number(preset.slot_index) === slotIndex
    );
  }

  function getPresetsForType(serviceType: string): Preset[] {
    return presets
      .filter(
        (preset) =>
          preset.platform === platform &&
          preset.service_type === serviceType
      )
      .sort((a, b) => Number(a.slot_index) - Number(b.slot_index));
  }

  function createDraftFromPreset(preset?: Preset): DraftPreset {
    const savedServiceId = preset?.panel_service_id ?? null;

    return {
      api_provider_id: preset?.api_provider_id ?? providerId ?? null,
      panel_service_id: savedServiceId,
      quantity: preset?.quantity ?? 0,
      keywords: normalizeKeywords(preset?.keywords),
      keyword_input: "",
      is_fallback: preset?.is_fallback ?? false,
      enabled: preset?.enabled ?? true,
    };
  }

  function addKeywordsToDraft(serviceType: string, slotIndex: number, rawInput: string) {
    const nextKeywords = parseKeywordsInput(rawInput);

    if (nextKeywords.length === 0) {
      return;
    }

    const preset = getPreset(serviceType, slotIndex);
    const key = makeRowKey(serviceType, slotIndex);
    const currentDraft = editingRows[key] ?? createDraftFromPreset(preset);

    updateDraft(serviceType, slotIndex, {
      keywords: [...new Set([...currentDraft.keywords, ...nextKeywords])],
    });
  }

  function removeKeywordFromDraft(serviceType: string, slotIndex: number, keyword: string) {
    const preset = getPreset(serviceType, slotIndex);
    const key = makeRowKey(serviceType, slotIndex);
    const currentDraft = editingRows[key] ?? createDraftFromPreset(preset);

    updateDraft(serviceType, slotIndex, {
      keywords: currentDraft.keywords.filter((item) => item !== keyword),
    });
  }

  function startEdit(serviceType: string, slotIndex: number) {
    const key = makeRowKey(serviceType, slotIndex);
    const preset = getPreset(serviceType, slotIndex);

    setEditingRows((current) => ({
      ...current,
      [key]: createDraftFromPreset(preset),
    }));
  }

  function addSlot(serviceType: string) {
    const savedSlots = getPresetsForType(serviceType).map((preset) => Number(preset.slot_index));
    const editingSlots = Object.keys(editingRows)
      .filter((key) => key.startsWith(`${serviceType}:`))
      .map((key) => Number(key.split(":")[1]))
      .filter((value) => Number.isFinite(value));

    const maxSlot = Math.max(0, ...savedSlots, ...editingSlots);
    startEdit(serviceType, maxSlot + 1);
  }

  function cancelEdit(serviceType: string, slotIndex: number) {
    const key = makeRowKey(serviceType, slotIndex);

    setEditingRows((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateDraft(
    serviceType: string,
    slotIndex: number,
    updates: Partial<DraftPreset>
  ) {
    const key = makeRowKey(serviceType, slotIndex);
    const preset = getPreset(serviceType, slotIndex);

    setEditingRows((current) => {
      const currentDraft =
        current[key] ?? createDraftFromPreset(preset);

      return {
        ...current,
        [key]: {
          ...currentDraft,
          ...updates,
        },
      };
    });
  }

  async function saveDraft(serviceType: string, slotIndex: number) {
    const key = makeRowKey(serviceType, slotIndex);
    const draft = editingRows[key];

    if (!draft) {
      return;
    }

    const selectedServiceId = draft.panel_service_id ?? null;

    const body = {
      platform,
      service_type: serviceType,
      slot_index: slotIndex,
      api_provider_id: draft.api_provider_id ?? providerId ?? null,
      panel_service_id: selectedServiceId,
      quantity: draft.quantity,
      keywords: draft.keywords,
      is_fallback: draft.is_fallback,
      enabled: draft.enabled,
    };

    const res = await fetch("/api/service-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Failed to save service preset.");
      return;
    }

    cancelEdit(serviceType, slotIndex);
    await loadPresets();
  }

  async function deletePreset(id: string) {
    const res = await fetch(`/api/service-presets?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Failed to delete slot.");
      return;
    }

    await loadPresets();
  }

  async function syncSlots() {
    setSyncingSlots(true);
    setError(null);

    try {
      const res = await fetch("/api/service-presets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to sync slot numbering.");
      }

      setEditingRows({});
      await loadPresets();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to sync slot numbering.");
    } finally {
      setSyncingSlots(false);
    }
  }

  const activeProvider = providers.find((provider) => provider.id === providerId);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) {
      return panelServices.slice(0, 250);
    }

    const isNumericQuery = /^\d+$/.test(q);

    if (isNumericQuery) {
      return panelServices
        .filter((service) => String(service.service ?? "").trim().startsWith(q))
        .sort((a, b) => {
          const aId = String(a.service ?? "").trim();
          const bId = String(b.service ?? "").trim();
          const aNum = Number(aId);
          const bNum = Number(bId);

          if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
            return aNum - bNum;
          }

          return aId.localeCompare(bId);
        })
        .slice(0, 250);
    }

    return panelServices
      .filter((service) => {
        const haystack = [
          service.service,
          service.name,
          service.category,
          service.type,
          service.rate,
          service.min,
          service.max,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(q);
      })
      .slice(0, 250);
  }, [panelServices, search]);

  const serviceTypes = DEFAULT_SERVICE_TYPES[platform] ?? [];

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Service routing</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Provider slots</h1>
          <p className="text-sm text-[#9aa3c7] max-w-2xl">
            Configure one or more slots per service type. If multiple slots match a link keyword,
            the system uses the first matching slot in sequence.
          </p>
        </div>
      </section>

      <div className="panel flex flex-col gap-4" style={{ padding: "22px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto auto",
            gap: "14px",
            alignItems: "end",
          }}
        >
          <div>
            <label className="field-label">API provider</label>
            <select
              className="input"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">No provider selected</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label">Search services</label>
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64708f]"
              />
              <input
                className="input pl-9"
                placeholder="Search ID, name, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn-secondary flex items-center gap-2"
            style={{ minHeight: "48px", whiteSpace: "nowrap" }}
            onClick={loadPanelServices}
            disabled={loadingServices || !providerId}
          >
            <RefreshCw
              size={14}
              className={loadingServices ? "animate-spin" : ""}
            />
            {loadingServices ? "Pulling..." : "Pull services"}
          </button>

          <button
            className="btn-secondary flex items-center gap-2"
            style={{ minHeight: "48px", whiteSpace: "nowrap" }}
            onClick={syncSlots}
            disabled={syncingSlots}
          >
            <RefreshCw size={14} className={syncingSlots ? "animate-spin" : ""} />
            {syncingSlots ? "Syncing..." : "Sync slots"}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#7f89b2]">
          <ServerCog size={14} />
          {activeProvider
            ? `${activeProvider.name} selected`
            : "Add providers in Settings first"}
          {panelServices.length > 0 &&
            ` · ${panelServices.length} services loaded · showing ${filteredServices.length}`}
        </div>
      </div>

      <div className="platform-grid">
        {PLATFORMS.map((p) => {
          const meta = PLATFORM_META[p];
          const Icon = meta.icon;

          return (
            <button
              key={p}
              onClick={() => {
                setPlatform(p);
                setEditingRows({});
                setSearch("");
              }}
              className={`platform-pill ${p === platform ? "active" : ""}`}
            >
              <Icon size={15} style={{ color: meta.color }} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {error && <div className="panel-error">{error}</div>}

      <div className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-4">
          {serviceTypes.map((serviceType) => {
            const savedPresets = getPresetsForType(serviceType);
            const editingSlots = Object.keys(editingRows)
              .filter((key) => key.startsWith(`${serviceType}:`))
              .map((key) => Number(key.split(":")[1]))
              .filter((slot) => Number.isFinite(slot));

            const slotIndexes = [...new Set([
              ...savedPresets.map((preset) => Number(preset.slot_index)),
              ...editingSlots,
            ])].sort((a, b) => a - b);

            return (
              <div key={serviceType} className="flex flex-col gap-3 border border-[#23272e] rounded-xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold capitalize">{serviceType}</div>
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => addSlot(serviceType)}
                  >
                    <Plus size={14} />
                    Add slot
                  </button>
                </div>

                {slotIndexes.length === 0 && (
                  <div className="text-xs text-[#8b8fa3]">No slots yet for this service type.</div>
                )}

                {slotIndexes.map((slotIndex) => {
                  const rowKey = makeRowKey(serviceType, slotIndex);
                  const preset = getPreset(serviceType, slotIndex);
                  const isEditing = Boolean(editingRows[rowKey]);
                  const draft = editingRows[rowKey] ?? createDraftFromPreset(preset);

                  const savedServiceId = preset?.panel_service_id ?? "";
                  const currentServiceId = draft.panel_service_id ?? "";

                  const activeServiceId = isEditing ? currentServiceId : savedServiceId;

                  const currentMissingFromCatalog =
                    activeServiceId &&
                    !filteredServices.some((service) => service.service === activeServiceId);

                  return (
                    <div key={rowKey} className="service-row" onKeyDown={(e) => {
                      if (e.key === "Enter" && isEditing) {
                        e.preventDefault();
                        saveDraft(serviceType, slotIndex);
                      }
                    }}>
                      <div className="text-sm font-medium">Slot {slotIndex}</div>

                      <select
                        className="input"
                        value={activeServiceId}
                        disabled={!isEditing}
                        onChange={(e) => {
                          const value = e.target.value || null;

                          updateDraft(serviceType, slotIndex, {
                            api_provider_id: providerId || preset?.api_provider_id || null,
                            panel_service_id: value,
                          });
                        }}
                      >
                        <option value="">Select provider service</option>

                        {currentMissingFromCatalog && (
                          <option value={activeServiceId}>
                            [{activeServiceId}] Currently saved service
                          </option>
                        )}

                        {filteredServices.map((service) => (
                          <option key={service.service} value={service.service}>
                            [{service.service}] {service.name}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        min={0}
                        className="input"
                        value={isEditing ? draft.quantity : preset?.quantity ?? 0}
                        disabled={!isEditing || (isEditing && draft.is_fallback)}
                        style={isEditing && draft.is_fallback ? { opacity: 0.55 } : undefined}
                        onChange={(e) =>
                          updateDraft(serviceType, slotIndex, {
                            quantity: Number(e.target.value),
                          })
                        }
                      />

                      <div className="flex flex-col gap-2">
                        {isEditing ? (
                          <input
                            className="input service-keyword-input"
                            style={{
                              transform: "translateY(46px)",
                              opacity: draft.is_fallback ? 0.55 : 1,
                            }}
                            placeholder="Type keywords separated by commas, then press Enter"
                            value={draft.keyword_input}
                            disabled={draft.is_fallback}
                            onChange={(e) => {
                              updateDraft(serviceType, slotIndex, {
                                keyword_input: e.target.value,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();

                                if (draft.is_fallback) {
                                  return;
                                }

                                addKeywordsToDraft(serviceType, slotIndex, draft.keyword_input);
                                updateDraft(serviceType, slotIndex, { keyword_input: "" });
                              }
                            }}
                          />
                        ) : (
                          <input
                            className="input service-keyword-input"
                            value=""
                            placeholder=""
                            style={{ transform: "translateY(46px)" }}
                            disabled
                            readOnly
                          />
                        )}

                        <div
                          className={`min-h-[36px] flex flex-nowrap gap-2 ${
                            (isEditing ? draft.keywords : normalizeKeywords(preset?.keywords)).length === 0
                              ? "invisible"
                              : ""
                          }`}
                          style={{
                            transform: "translateY(20px)",
                            width: "max-content",
                            alignSelf: "flex-end",
                          }}
                        >
                          {(isEditing ? draft.keywords : normalizeKeywords(preset?.keywords)).map((keyword) => (
                            <span
                              key={keyword}
                              className="platform-pill active keyword-pill"
                              style={{ cursor: isEditing ? "default" : "text" }}
                            >
                              {keyword}
                              {isEditing && (
                                <button
                                  type="button"
                                  className="ml-2 text-xs p-0 leading-none"
                                  style={{
                                    padding: 0,
                                    marginLeft: "8px",
                                    width: "auto",
                                    minWidth: 0,
                                    height: "auto",
                                    minHeight: 0,
                                    border: 0,
                                    background: "transparent",
                                    lineHeight: 1,
                                  }}
                                  onClick={() => removeKeywordFromDraft(serviceType, slotIndex, keyword)}
                                  aria-label={`Remove ${keyword}`}
                                  
                                >
                                  x
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>

                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={isEditing ? draft.is_fallback : preset?.is_fallback ?? false}
                          disabled={!isEditing}
                          onChange={(e) =>
                            updateDraft(serviceType, slotIndex, {
                              is_fallback: e.target.checked,
                            })
                          }
                        />
                        fallback
                      </label>

                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={isEditing ? draft.enabled : preset?.enabled ?? true}
                          disabled={!isEditing}
                          onChange={(e) =>
                            updateDraft(serviceType, slotIndex, {
                              enabled: e.target.checked,
                            })
                          }
                        />
                        on
                      </label>

                      <div className="flex items-center gap-2">
                        {!isEditing ? (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => startEdit(serviceType, slotIndex)}
                            >
                              Edit
                            </button>
                            {preset?.id && (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => deletePreset(preset.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => saveDraft(serviceType, slotIndex)}
                            >
                              Save
                            </button>

                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => cancelEdit(serviceType, slotIndex)}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
