import { supabaseAdmin } from "./supabase";
import { placePanelOrder } from "./smm-panel";

type Platform =
  | "x"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "kick"
  | "twitch";

type ServiceResult = {
  service_type: string;
  slot_index?: number;
  keywords?: string[];
  is_fallback?: boolean;
  api_provider_id?: string | null;
  provider_name?: string | null;
  panel_service_id: string | null;
  socpanel_service_id?: string | null;
  quantity: number;
  panel_order_id?: string | number;
  socpanel_order_id?: string | number;
  skipped?: boolean;
  error?: string;
  status?: string;
  debug_detected_categories?: string[];
  debug_effective_categories?: string[];
  debug_slot_decision?: string;
};

type FallbackDefaults = {
  quantity?: number;
  keywords?: string[];
};

function isInstagramReel(link: string) {
  try {
    const url = new URL(link);
    return url.hostname.includes("instagram.com") && url.pathname.includes("/reel/");
  } catch {
    return link.includes("instagram.com/reel/");
  }
}

export function isXBroadcastLink(link: string) {
  try {
    const url = new URL(link);
    const hostname = url.hostname.toLowerCase();
    const isXHost = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname);

    return isXHost && /^\/i\/broadcasts\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function popComments(poolId: string, count: number): Promise<string[]> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("comment_pool_items")
    .select("id, comment")
    .eq("pool_id", poolId)
    .eq("used", false)
    .limit(count);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const ids = data.map((d) => d.id);
  await supabase.from("comment_pool_items").update({ used: true }).in("id", ids);

  return data.map((d) => d.comment);
}

async function findOldestAvailablePool(platform: Platform) {
  const supabase = supabaseAdmin();

  const { data: pools, error } = await supabase
    .from("comment_pools")
    .select("id, name, category, created_at")
    .eq("platform", platform)
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!pools || pools.length === 0) return null;

  for (const pool of pools) {
    const { count, error: countError } = await supabase
      .from("comment_pool_items")
      .select("id", { count: "exact", head: true })
      .eq("pool_id", pool.id)
      .eq("used", false);

    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      return pool;
    }
  }

  return null;
}

function poolMatchesKeywords(
  pool: { name?: string | null; category?: string | null },
  keywords: string[]
) {
  if (keywords.length === 0) {
    return true;
  }

  const normalizedName = String(pool.name ?? "").trim().toLowerCase();
  const normalizedCategory = String(pool.category ?? "").trim().toLowerCase();

  return keywords.some((keyword) => {
    const normalizedKeyword = String(keyword).trim().toLowerCase();

    if (!normalizedKeyword) {
      return false;
    }

    return (
      normalizedCategory === normalizedKeyword ||
      normalizedName.includes(normalizedKeyword)
    );
  });
}

function isCommentServiceType(serviceType: string) {
  return serviceType === "comments";
}

function normalizeServiceCategory(serviceType: string): string {
  const normalized = serviceType.trim().toLowerCase();

  if (normalized === "comments") {
    return "comments";
  }

  // Treat reaction variants as one duplicate category.
  if (normalized.includes("reaction")) {
    return "reactions";
  }

  return normalized;
}

function shouldSubmitComments(params: { platform: Platform; tier: string }) {
  return Boolean(params.platform);
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeServiceTypeList(serviceTypes: string[] | undefined): Set<string> {
  if (!serviceTypes || serviceTypes.length === 0) {
    return new Set();
  }

  return new Set(
    serviceTypes
      .map((value) => normalizeServiceCategory(String(value)))
      .filter(Boolean)
  );
}

function normalizeServiceIdMap(
  value: Record<string, string[]> | undefined
): Record<string, Set<string>> {
  if (!value) {
    return {};
  }

  const normalized: Record<string, Set<string>> = {};

  for (const [serviceType, ids] of Object.entries(value)) {
    const key = normalizeServiceCategory(serviceType);
    const idSet = new Set(
      (ids ?? []).map((item) => String(item).trim()).filter(Boolean)
    );

    if (key && idSet.size > 0) {
      normalized[key] = idSet;
    }
  }

  return normalized;
}

function normalizeFallbackDefaultsByType(
  value: Record<string, FallbackDefaults> | undefined
): Record<string, FallbackDefaults> {
  if (!value) {
    return {};
  }

  const normalized: Record<string, FallbackDefaults> = {};

  for (const [serviceType, defaults] of Object.entries(value)) {
    const key = normalizeServiceCategory(serviceType);
    if (!key) {
      continue;
    }

    const quantity =
      typeof defaults?.quantity === "number" && Number.isFinite(defaults.quantity)
        ? Math.max(0, Number(defaults.quantity))
        : undefined;

    const keywords = normalizeKeywords(defaults?.keywords ?? []);

    normalized[key] = {
      quantity,
      keywords,
    };
  }

  return normalized;
}

function isServiceFailureForRetry(service: Record<string, unknown>): boolean {
  if (service.skipped) {
    return false;
  }

  const status = String(service.status ?? "").trim().toLowerCase();
  const error = String(service.error ?? "").trim();
  const hasOrderId = Boolean(service.panel_order_id ?? service.socpanel_order_id);

  if (status && /failed|canceled|cancelled|error|declined|rejected|denied/.test(status)) {
    return true;
  }

  if (error && /failed|canceled|cancelled|error|declined|rejected|denied/.test(error.toLowerCase())) {
    return true;
  }

  return !hasOrderId;
}

function extractDetectedKeywordsFromLink(link: string): string[] {
  const normalized = decodeURIComponent(link).toLowerCase();
  const matches = normalized.match(/[a-z0-9_\-]+/g) ?? [];
  return [...new Set(matches.filter(Boolean))];
}

function matchesAnyKeyword(link: string, keywords: string[]) {
  if (keywords.length === 0) {
    return false;
  }

  const normalizedLink = decodeURIComponent(link).toLowerCase();
  return keywords.some((keyword) => normalizedLink.includes(keyword));
}

function getMatchedKeywordsForLink(link: string, keywords: string[]) {
  if (keywords.length === 0) {
    return [];
  }

  const normalizedLink = decodeURIComponent(link).toLowerCase();
  return keywords.filter((keyword) => normalizedLink.includes(keyword));
}

function pickSequentialSlot<T extends { slot_index?: number }>(params: {
  candidates: T[];
}) {
  if (params.candidates.length === 0) {
    return null;
  }

  const ordered = [...params.candidates].sort(
    (a, b) => (a.slot_index ?? 1) - (b.slot_index ?? 1)
  );

  return ordered[0] ?? null;
}

function selectPresetForServiceType(params: {
  servicePresets: Array<Record<string, unknown>>;
  link: string;
  platform: Platform;
  serviceType: string;
  useFallback: boolean;
  excludedServiceIds?: Set<string>;
}) {
  const byMode = params.servicePresets.filter((preset) => {
    const isFallback = Boolean((preset as { is_fallback?: unknown }).is_fallback);
    return params.useFallback ? isFallback : !isFallback;
  });

  if (byMode.length === 0) {
    return {
      preset: null,
      debugSlotDecision: params.useFallback ? "no_fallback_slots_configured" : "no_primary_slots_configured",
    };
  }

  const filteredByServiceId = byMode.filter((preset) => {
    const serviceId = String(
      (preset as { panel_service_id?: unknown; socpanel_service_id?: unknown }).panel_service_id ??
        (preset as { socpanel_service_id?: unknown }).socpanel_service_id ??
        ""
    ).trim();

    if (!serviceId || !params.excludedServiceIds || params.excludedServiceIds.size === 0) {
      return true;
    }

    return !params.excludedServiceIds.has(serviceId);
  });

  if (filteredByServiceId.length === 0) {
    return {
      preset: null,
      debugSlotDecision: "no_eligible_slots_after_service_id_exclusions",
    };
  }

  const withKeywords = filteredByServiceId.filter((preset) =>
    normalizeKeywords(
      (preset as { keywords?: unknown; comment_categories?: unknown }).keywords ??
        (preset as { comment_categories?: unknown }).comment_categories
    ).length > 0
  );

  const keywordMatched = withKeywords.filter((preset) =>
    matchesAnyKeyword(
      params.link,
      normalizeKeywords(
        (preset as { keywords?: unknown; comment_categories?: unknown }).keywords ??
          (preset as { comment_categories?: unknown }).comment_categories
      )
    )
  );

  const noKeywordSlots = filteredByServiceId.filter((preset) =>
    normalizeKeywords(
      (preset as { keywords?: unknown; comment_categories?: unknown }).keywords ??
        (preset as { comment_categories?: unknown }).comment_categories
    ).length === 0
  );

  if (keywordMatched.length > 0) {
    const chosenPreset = pickSequentialSlot({
      candidates: keywordMatched as Array<{ slot_index?: number }>,
    }) as Record<string, unknown> | null;

    return {
      preset: chosenPreset,
      debugSlotDecision: `keyword_match_sequential:${String((chosenPreset as { slot_index?: unknown } | null)?.slot_index ?? 1)}/${keywordMatched.length}`,
    };
  }

  if (noKeywordSlots.length > 0) {
    const chosenPreset = pickSequentialSlot({
      candidates: noKeywordSlots as Array<{ slot_index?: number }>,
    }) as Record<string, unknown> | null;

    return {
      preset: chosenPreset,
      debugSlotDecision: `no_keyword_sequential:${String((chosenPreset as { slot_index?: unknown } | null)?.slot_index ?? 1)}/${noKeywordSlots.length}`,
    };
  }

  return {
    preset: null,
    debugSlotDecision: withKeywords.length > 0 ? "keyword_slots_present_but_no_match" : "no_eligible_slots",
  };
}

async function findOldestAvailablePoolForCategories(params: {
  platform: Platform;
  categories: string[];
}) {
  if (params.categories.length === 0) {
    return findOldestAvailablePool(params.platform);
  }

  const supabase = supabaseAdmin();
  const { data: pools, error } = await supabase
    .from("comment_pools")
    .select("id, name, category, created_at")
    .eq("platform", params.platform)
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!pools || pools.length === 0) return null;

  const matchingPools = pools.filter((pool) =>
    poolMatchesKeywords(pool, params.categories)
  );

  if (matchingPools.length === 0) {
    return null;
  }

  for (const pool of matchingPools) {
    const { count, error: countError } = await supabase
      .from("comment_pool_items")
      .select("id", { count: "exact", head: true })
      .eq("pool_id", pool.id)
      .eq("used", false);

    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      return pool;
    }
  }

  return null;
}

async function wasServiceAlreadySubmitted(params: {
  platform: Platform;
  link: string;
  serviceType: string;
}) {
  const supabase = supabaseAdmin();
  const targetCategory = normalizeServiceCategory(params.serviceType);

  const { data, error } = await supabase
    .from("orders")
    .select("id, services_ordered")
    .eq("platform", params.platform)
    .eq("link", params.link)
    .order("created_at", { ascending: false });

  if (error) throw error;

  if (!data || data.length === 0) {
    return false;
  }

  for (const order of data) {
    const services = Array.isArray(order.services_ordered)
      ? order.services_ordered
      : [];

    const matchingService = services.find((service: Record<string, unknown>) => {
      const providerOrderId = service.panel_order_id || service.socpanel_order_id;
      const errorMessage = typeof service.error === "string" ? service.error : "";
      const status = typeof service.status === "string" ? service.status.toLowerCase() : "";
      const isCanceled = Boolean(
        errorMessage &&
          /canceled|cancelled|cancel|failed|error|declined|rejected|denied/i.test(errorMessage)
      );
      const isDuplicateLike = Boolean(
        errorMessage &&
          /duplicate|already submitted successfully|already received|already exists|already in queue|same link/i.test(errorMessage)
      );
      const isProviderActiveStatus = Boolean(
        status && /pending|processing|in_progress|partial|submitted|queued|accepted/.test(status)
      );
      const hasProviderEvidence = Boolean(providerOrderId) || isProviderActiveStatus;

      return (
        normalizeServiceCategory(String(service.service_type ?? "")) === targetCategory &&
        !service.skipped &&
        hasProviderEvidence &&
        !isCanceled &&
        !isDuplicateLike
      );
    });

    if (matchingService) {
      return true;
    }
  }

  return false;
}

export async function retryOrderForId(
  orderId: string,
  options?: {
    fallbackForFailedServices?: boolean;
    retryOnlyServiceTypes?: string[];
    forceFallbackServiceTypes?: string[];
    avoidServiceIdsByType?: Record<string, string[]>;
    fallbackDefaultsByType?: Record<string, FallbackDefaults>;
  }
) {
  const supabase = supabaseAdmin();

  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .select("id, platform, tier, link, comment_pool_id, source, services_ordered")
    .eq("id", orderId)
    .single();

  if (orderErr || !orderRow) {
    throw new Error("Order not found.");
  }

  const forceFallbackTypes = new Set(
    options?.forceFallbackServiceTypes?.map((value) => String(value)) ?? []
  );
  const retryOnlyTypes = new Set(
    options?.retryOnlyServiceTypes?.map((value) => String(value)) ?? []
  );

  const avoidServiceIdsByType: Record<string, string[]> = {
    ...(options?.avoidServiceIdsByType ?? {}),
  };
  const fallbackDefaultsByType: Record<string, FallbackDefaults> = {
    ...(options?.fallbackDefaultsByType ?? {}),
  };

  if (options?.fallbackForFailedServices) {
    const services = Array.isArray(orderRow.services_ordered)
      ? (orderRow.services_ordered as Array<Record<string, unknown>>)
      : [];

    for (const service of services) {
      const serviceType = String(service.service_type ?? "").trim();

      if (!serviceType || !isServiceFailureForRetry(service)) {
        continue;
      }

      forceFallbackTypes.add(serviceType);

      const serviceId = String(
        service.panel_service_id ?? service.socpanel_service_id ?? ""
      ).trim();

      if (!serviceId) {
        continue;
      }

      const existing = avoidServiceIdsByType[serviceType] ?? [];
      avoidServiceIdsByType[serviceType] = [...new Set([...existing, serviceId])];

      fallbackDefaultsByType[serviceType] = {
        quantity:
          typeof service.quantity === "number" && Number.isFinite(service.quantity)
            ? Number(service.quantity)
            : undefined,
        keywords: normalizeKeywords(service.keywords ?? []),
      };
    }
  }

  return submitOrderForLink({
    platform: orderRow.platform as Platform,
    tier: orderRow.tier,
    link: orderRow.link,
    source: orderRow.source ?? "retry",
    commentPoolId: orderRow.comment_pool_id ?? null,
    includeServiceTypes: [...retryOnlyTypes],
    preferFallbackForServiceTypes: [...forceFallbackTypes],
    avoidServiceIdsByType,
    fallbackDefaultsByType,
  });
}

export async function submitOrderForLink(params: {
  platform: Platform;
  tier?: string;
  link: string;
  source?: string;
  commentPoolId?: string | null;
  includeServiceTypes?: string[];
  preferFallbackForServiceTypes?: string[];
  avoidServiceIdsByType?: Record<string, string[]>;
  fallbackDefaultsByType?: Record<string, FallbackDefaults>;
}) {
  const supabase = supabaseAdmin();

  if (params.commentPoolId) {
    const { data: pool, error: poolCheckErr } = await supabase
      .from("comment_pools")
      .select("id, platform")
      .eq("id", params.commentPoolId)
      .single();

    if (poolCheckErr || !pool) {
      throw new Error("Selected comment pool could not be found.");
    }

    if (pool.platform !== params.platform) {
      throw new Error(
        `Comment pool is for "${pool.platform}" but this order is for "${params.platform}". Pick a matching pool.`
      );
    }
  }

  const { data: presets, error: presetErr } = await supabase
    .from("service_presets")
    .select("*, api_providers(name)")
    .eq("platform", params.platform)
    .eq("enabled", true);

  if (presetErr) throw presetErr;

  if (!presets || presets.length === 0) {
    throw new Error(
      `No enabled service presets found for ${params.platform}. Configure them in Services first.`
    );
  }

  const instagramShouldOrderViews =
    params.platform !== "instagram" || isInstagramReel(params.link);
  const broadcastLink =
    params.platform === "x" && isXBroadcastLink(params.link);

  const filteredPresets = presets.filter((preset) => {
    if (broadcastLink) {
      return normalizeServiceCategory(String(preset.service_type)) === "broadcast";
    }

    if (
      params.platform === "instagram" &&
      preset.service_type === "views" &&
      !instagramShouldOrderViews
    ) {
      return false;
    }

    return true;
  });

  if (filteredPresets.length === 0) {
    throw new Error(
      broadcastLink
        ? "No enabled broadcast service preset found for this X broadcast link. Configure broadcast in Services first."
        : `No eligible service presets found for this ${params.platform} link.`
    );
  }

  const groupedPresets = new Map<string, Array<Record<string, unknown>>>();
  const includedServiceTypes = normalizeServiceTypeList(params.includeServiceTypes);
  const fallbackServiceTypes = normalizeServiceTypeList(
    params.preferFallbackForServiceTypes
  );
  const avoidedIdsByType = normalizeServiceIdMap(params.avoidServiceIdsByType);
  const fallbackDefaultsByType = normalizeFallbackDefaultsByType(
    params.fallbackDefaultsByType
  );

  for (const preset of filteredPresets) {
    const serviceType = String(preset.service_type);
    const normalizedType = normalizeServiceCategory(serviceType);

    if (includedServiceTypes.size > 0 && !includedServiceTypes.has(normalizedType)) {
      continue;
    }

    const existing = groupedPresets.get(serviceType) ?? [];
    existing.push(preset as Record<string, unknown>);
    groupedPresets.set(serviceType, existing);
  }

  if (groupedPresets.size === 0) {
    throw new Error("No matching service slots found for this retry.");
  }

  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .insert({
      platform: params.platform,
      tier: params.tier ?? "regular",
      link: params.link,
      source: params.source ?? "manual",
      status: "pending",
      comment_pool_id: params.commentPoolId ?? null,
      services_ordered: [],
    })
    .select()
    .single();

  if (orderErr) throw orderErr;

  const results: ServiceResult[] = [];
  const detectedKeywords = extractDetectedKeywordsFromLink(params.link);

  if (params.platform === "instagram" && !instagramShouldOrderViews) {
    results.push({
      service_type: "views",
      panel_service_id: null,
      socpanel_service_id: null,
      quantity: 0,
      skipped: true,
      error: "Instagram views skipped because this link is not a Reel.",
    });
  }

  for (const [serviceType, servicePresets] of groupedPresets.entries()) {
    const normalizedType = normalizeServiceCategory(serviceType);
    const useFallback = fallbackServiceTypes.has(normalizedType);
    const selection = selectPresetForServiceType({
      servicePresets,
      link: params.link,
      platform: params.platform,
      serviceType,
      useFallback,
      excludedServiceIds: avoidedIdsByType[normalizedType],
    });
    const selectedPreset = selection.preset;
    const debugSlotDecision = selection.debugSlotDecision;

    if (!selectedPreset) {
      if (useFallback) {
        results.push({
          service_type: serviceType,
          quantity: 0,
          panel_service_id: null,
          socpanel_service_id: null,
          is_fallback: true,
          debug_slot_decision: debugSlotDecision,
          error: "No fallback slot matched this link (or all fallback service IDs were excluded).",
        });
      }
      continue;
    }

    const preset = selectedPreset as {
      service_type: string;
      slot_index?: number;
      keywords?: unknown;
      comment_categories?: unknown;
      is_fallback?: boolean;
      api_provider_id?: string | null;
      api_providers?: { name?: string | null };
      panel_service_id?: string | null;
      socpanel_service_id?: string | null;
      quantity: number;
    };

    const primaryFallbackSource = useFallback
      ? selectPresetForServiceType({
          servicePresets,
          link: params.link,
          platform: params.platform,
          serviceType,
          useFallback: false,
        }).preset
      : null;
    const primaryFallbackSourcePreset = primaryFallbackSource as
      | {
          quantity?: number;
          keywords?: unknown;
          comment_categories?: unknown;
        }
      | null;

    const fallbackDefaults = fallbackDefaultsByType[normalizedType];
    const presetKeywords = normalizeKeywords(
      preset.keywords ?? preset.comment_categories
    );
    const primaryKeywords = normalizeKeywords(
      primaryFallbackSourcePreset?.keywords ??
        primaryFallbackSourcePreset?.comment_categories
    );
    const effectiveKeywords =
      useFallback && presetKeywords.length === 0
        ? normalizeKeywords(fallbackDefaults?.keywords ?? primaryKeywords)
        : presetKeywords;
    const effectiveQuantity =
      useFallback && Number(preset.quantity) <= 0
        ? Math.max(
            0,
            Number(
              fallbackDefaults?.quantity ??
                primaryFallbackSourcePreset?.quantity ??
                0
            )
          )
        : Number(preset.quantity);

    const serviceId = preset.panel_service_id || preset.socpanel_service_id || null;
    const providerId = preset.api_provider_id ?? null;
    const providerName =
      preset.api_providers?.name ?? (providerId ? "Provider" : "Default provider");

    const alreadySubmitted = await wasServiceAlreadySubmitted({
      platform: params.platform,
      link: params.link,
      serviceType: preset.service_type,
    });

    if (alreadySubmitted) {
      results.push({
        service_type: serviceType,
        slot_index: preset.slot_index ?? 1,
        keywords: effectiveKeywords,
        is_fallback: Boolean(preset.is_fallback),
        api_provider_id: providerId,
        provider_name: providerName,
        panel_service_id: serviceId,
        socpanel_service_id: serviceId,
        quantity: effectiveQuantity,
        debug_slot_decision: debugSlotDecision,
        error: "Duplicate order",
      });

      continue;
    }

    if (!serviceId) {
      results.push({
        service_type: serviceType,
        slot_index: preset.slot_index ?? 1,
        keywords: effectiveKeywords,
        is_fallback: Boolean(preset.is_fallback),
        api_provider_id: providerId,
        provider_name: providerName,
        panel_service_id: null,
        socpanel_service_id: null,
        quantity: effectiveQuantity,
        debug_slot_decision: debugSlotDecision,
        error: "No panel service ID mapped for this preset yet.",
      });
      continue;
    }

    if (effectiveQuantity <= 0) {
      results.push({
        service_type: serviceType,
        slot_index: preset.slot_index ?? 1,
        keywords: effectiveKeywords,
        is_fallback: Boolean(preset.is_fallback),
        api_provider_id: providerId,
        provider_name: providerName,
        panel_service_id: serviceId,
        socpanel_service_id: serviceId,
        quantity: effectiveQuantity,
        debug_slot_decision: debugSlotDecision,
        error: "Quantity must be greater than 0.",
      });
      continue;
    }

    try {
      let comments: string | undefined;
      let effectiveKeywordsForResult: string[] | undefined;

      if (isCommentServiceType(serviceType)) {
        if (!shouldSubmitComments({ platform: params.platform, tier: params.tier ?? "regular" })) {
          results.push({
            service_type: serviceType,
            slot_index: preset.slot_index ?? 1,
            keywords: effectiveKeywords,
            is_fallback: Boolean(preset.is_fallback),
            api_provider_id: providerId,
            provider_name: providerName,
            panel_service_id: serviceId,
            socpanel_service_id: serviceId,
            quantity: effectiveQuantity,
            debug_slot_decision: debugSlotDecision,
            skipped: true,
            error: "Comments are disabled for this platform.",
          });
          continue;
        }

        const matchedPoolKeywords = getMatchedKeywordsForLink(
          params.link,
          effectiveKeywords
        );
        const poolSelectionKeywords =
          matchedPoolKeywords.length > 0 ? matchedPoolKeywords : effectiveKeywords;

        effectiveKeywordsForResult = poolSelectionKeywords;

        let poolId = params.commentPoolId ?? null;

        if (poolId) {
          const { data: poolRow, error: poolErr } = await supabase
            .from("comment_pools")
            .select("id, name, category, platform")
            .eq("id", poolId)
            .single();

          if (poolErr || !poolRow || poolRow.platform !== params.platform) {
            results.push({
              service_type: serviceType,
              slot_index: preset.slot_index ?? 1,
              keywords: effectiveKeywords,
              is_fallback: Boolean(preset.is_fallback),
              api_provider_id: providerId,
              provider_name: providerName,
              panel_service_id: serviceId,
              socpanel_service_id: serviceId,
              quantity: effectiveQuantity,
              debug_slot_decision: debugSlotDecision,
              error: "Selected comment pool is invalid for this platform.",
            });
            continue;
          }

          if (
            poolSelectionKeywords.length > 0 &&
            !poolMatchesKeywords(poolRow, poolSelectionKeywords)
          ) {
            results.push({
              service_type: serviceType,
              slot_index: preset.slot_index ?? 1,
              keywords: poolSelectionKeywords,
              is_fallback: Boolean(preset.is_fallback),
              api_provider_id: providerId,
              provider_name: providerName,
              panel_service_id: serviceId,
              socpanel_service_id: serviceId,
              quantity: effectiveQuantity,
              debug_slot_decision: debugSlotDecision,
              error: `Selected comment pool does not match this slot's keywords.`,
            });
            continue;
          }
        }

        if (!poolId) {
          const autoPool = await findOldestAvailablePoolForCategories({
            platform: params.platform,
            categories: poolSelectionKeywords,
          });

          if (!autoPool) {
            const categoryHint =
              poolSelectionKeywords.length > 0
                ? ` in categories [${poolSelectionKeywords.join(", ")}]`
                : "";

            results.push({
              service_type: serviceType,
              slot_index: preset.slot_index ?? 1,
              keywords: poolSelectionKeywords,
              is_fallback: Boolean(preset.is_fallback),
              api_provider_id: providerId,
              provider_name: providerName,
              panel_service_id: serviceId,
              socpanel_service_id: serviceId,
              quantity: effectiveQuantity,
              debug_slot_decision: debugSlotDecision,
              error: `No unused comment pool found for ${params.platform}${categoryHint}.`,
            });
            continue;
          }

          poolId = autoPool.id;
        }

        const picked = await popComments(poolId as string, effectiveQuantity);

        if (picked.length < effectiveQuantity) {
          results.push({
            service_type: serviceType,
            slot_index: preset.slot_index ?? 1,
            keywords: effectiveKeywords,
            is_fallback: Boolean(preset.is_fallback),
            api_provider_id: providerId,
            provider_name: providerName,
            panel_service_id: serviceId,
            socpanel_service_id: serviceId,
            quantity: effectiveQuantity,
              debug_slot_decision: debugSlotDecision,
            error: `Only ${picked.length} unused comments left in the pool (needed ${effectiveQuantity}).`,
          });
          continue;
        }

        comments = picked.join("\n");
      }

      const res = await placePanelOrder({
        providerId,
        serviceId,
        link: params.link,
        quantity: effectiveQuantity,
        comments,
      });

      if (res.error) {
        results.push({
          service_type: serviceType,
          slot_index: preset.slot_index ?? 1,
          keywords: effectiveKeywords,
          is_fallback: Boolean(preset.is_fallback),
          api_provider_id: providerId,
          provider_name: providerName,
          panel_service_id: serviceId,
          socpanel_service_id: serviceId,
          quantity: effectiveQuantity,
          error: res.error,
          status: res.status,
          debug_detected_categories: isCommentServiceType(serviceType) ? detectedKeywords : undefined,
          debug_effective_categories: isCommentServiceType(serviceType)
            ? effectiveKeywordsForResult
            : undefined,
          debug_slot_decision: debugSlotDecision,
        });
      } else {
        results.push({
          service_type: serviceType,
          slot_index: preset.slot_index ?? 1,
          keywords: effectiveKeywords,
          is_fallback: Boolean(preset.is_fallback),
          api_provider_id: providerId,
          provider_name: providerName,
          panel_service_id: serviceId,
          socpanel_service_id: serviceId,
          quantity: effectiveQuantity,
          panel_order_id: res.order,
          socpanel_order_id: res.order,
          status: res.status,
          debug_detected_categories: isCommentServiceType(serviceType) ? detectedKeywords : undefined,
          debug_effective_categories: isCommentServiceType(serviceType)
            ? effectiveKeywordsForResult
            : undefined,
          debug_slot_decision: debugSlotDecision,
        });
      }
    } catch (error) {
      results.push({
        service_type: serviceType,
        slot_index: preset.slot_index ?? 1,
        keywords: effectiveKeywords,
        is_fallback: Boolean(preset.is_fallback),
        api_provider_id: providerId,
        provider_name: providerName,
        panel_service_id: serviceId,
        socpanel_service_id: serviceId,
        quantity: effectiveQuantity,
        debug_slot_decision: debugSlotDecision,
        error: error instanceof Error ? error.message : "Unknown error placing order.",
      });
    }
  }

  const realResults = results.filter((result) => !result.skipped);
  const hasError = realResults.some((result) => result.error);
  const nextStatus = hasError ? "failed" : "submitted";

  await supabase
    .from("orders")
    .update({
      services_ordered: results,
      status: nextStatus,
    })
    .eq("id", orderRow.id);

  return { orderId: orderRow.id, link: params.link, results, hasError };
}

export async function submitBatchOrders(params: {
  platform: Platform;
  tier?: string;
  links: string[];
  source?: string;
  commentPoolId?: string | null;
}) {
  const cleanLinks = [
    ...new Set(params.links.map((link) => link.trim()).filter(Boolean)),
  ];

  if (cleanLinks.length === 0) {
    throw new Error("Add at least one post link.");
  }

  const orders: Array<{ link: string; error?: string; hasError?: boolean; [key: string]: unknown }> = [];

  for (const link of cleanLinks) {
    try {
      orders.push(
        await submitOrderForLink({
          platform: params.platform,
          tier: params.tier,
          link,
          source: params.source ?? "manual",
          commentPoolId: params.commentPoolId ?? null,
        })
      );
    } catch (error) {
      orders.push({
        link,
        error: error instanceof Error ? error.message : "Failed to submit this link.",
        hasError: true,
      });
    }
  }

  return {
    count: orders.length,
    submitted: orders.filter((order: { error?: string }) => !order.error).length,
    failed: orders.filter((order: { error?: string }) => order.error).length,
    hasError: orders.some((order: { hasError?: boolean; error?: string }) => order.hasError || order.error),
    orders,
  };
}
