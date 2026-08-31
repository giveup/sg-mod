(() => {
const ENDPOINTS = new Map([
  ["/v6/main/init", "main-init"],
  ["/v6/main/indexV8", "list"],
  ["/v6/page/dataList", "list"],
  ["/v6/feed/detail", "detail"],
  ["/v6/feed/replyList", "list"],
  ["/v6/search", "list"],
]);

const SPONSOR_TEMPLATES = new Set([
  "Sponsor",
  "sponsorCard",
  "feedDetailReplySponsorCard",
  "sponsorForSearch",
]);

const TRACKING_URL_FIELDS = new Set([
  "extra_url",
  "goods_buy_url",
  "goods_url",
  "link_url",
  "product_goods_url",
  "sell_url",
  "shareUrl",
  "url",
]);

const TRACKING_QUERY_PARAMETERS = new Set([
  "scm",
  "scm_id",
  "share_from",
  "share_source",
  "source_from",
  "spm",
  "spm_id_from",
  "track_id",
  "tracking_id",
  "trace_id",
  "ut_sk",
]);

const DEFAULT_OPTIONS = Object.freeze({
  blockAds: true,
  blockCommerceAttachments: true,
  customizeMainInit: true,
  blockImageCarousel: true,
  blockZhuanti: true,
  blockGoodsRankingCards: true,
  stripTrackingParameters: true,
  blockSearchHotContent: true,
  blockListCards: false,
});

function endpointForUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "api.coolapk.com") return undefined;
    const role = ENDPOINTS.get(parsed.pathname);
    if (!role) return undefined;
    const endpoint = { path: parsed.pathname, role };
    if (parsed.pathname === "/v6/search" && parsed.searchParams.get("type") === "hotSearch") {
      endpoint.variant = "hot-search";
    }
    return endpoint;
  } catch {
    return undefined;
  }
}

function normalizeOptions(options = {}) {
  const input = options && typeof options === "object" ? options : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_OPTIONS).map(([key, fallback]) => {
      const value = input[key];
      if (value === true || value === "true") return [key, true];
      if (value === false || value === "false") return [key, false];
      return [key, fallback];
    }),
  );
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isNonEmpty = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
};

const assign = (object, key, value, stats) => {
  if (!hasOwn(object, key)) return false;
  if (object[key] === value) return false;
  object[key] = value;
  stats.clearedFields[key] = (stats.clearedFields[key] || 0) + 1;
  return true;
};

const isSponsorItem = (item) => {
  if (!isObject(item)) return false;
  if (SPONSOR_TEMPLATES.has(item.entityTemplate)) return true;
  const statName = item?.extraDataArr?.cardStatName;
  return typeof statName === "string" && /^feed_detail(?:_reply)?_ad(?:\/|$)/.test(statName);
};

const isImageCarousel = (item) => (
  typeof item?.entityTemplate === "string" && item.entityTemplate.startsWith("imageCarouselCard")
);

const isListCard = (item) => item?.entityTemplate === "listCard";

const isZhuantiCard = (item) => {
  const cardPageName = item?.extraDataArr?.cardPageName;
  return typeof cardPageName === "string" && cardPageName.includes("ZHUANTI");
};

const isGoodsRankingCard = (item) => item?.entityTemplate === "goodsRankingCard";

const decodeQueryName = (value) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
};

const isTrackingQueryParameter = (name, field) => (
  name.startsWith("utm_") ||
  TRACKING_QUERY_PARAMETERS.has(name) ||
  (field === "shareUrl" && name === "s")
);

const stripTrackingQuery = (value, field) => {
  if (typeof value !== "string") return value;
  const queryStart = value.indexOf("?");
  if (queryStart < 0) return value;
  const fragmentStart = value.indexOf("#", queryStart + 1);
  const queryEnd = fragmentStart < 0 ? value.length : fragmentStart;
  const query = value.slice(queryStart + 1, queryEnd);
  if (query === "") return value;

  const parts = query.split("&");
  let write = 0;
  let removed = false;
  for (let read = 0; read < parts.length; read += 1) {
    const part = parts[read];
    const equals = part.indexOf("=");
    const rawName = equals < 0 ? part : part.slice(0, equals);
    if (isTrackingQueryParameter(decodeQueryName(rawName), field)) {
      removed = true;
      continue;
    }
    parts[write] = part;
    write += 1;
  }
  if (!removed) return value;
  parts.length = write;
  const fragment = fragmentStart < 0 ? "" : value.slice(fragmentStart);
  return `${value.slice(0, queryStart)}${write > 0 ? `?${parts.join("&")}` : ""}${fragment}`;
};

const stripTrackingLinks = (item, stats) => {
  if (!isObject(item)) return false;
  let changed = false;
  for (const field of TRACKING_URL_FIELDS) {
    if (!hasOwn(item, field) || typeof item[field] !== "string") continue;
    const filtered = stripTrackingQuery(item[field], field);
    if (filtered !== item[field]) changed = assign(item, field, filtered, stats) || changed;
  }
  return changed;
};

const isTradeAttachment = (item) => {
  if (!isObject(item)) return false;
  if (item.entityTemplate !== "feedErshou" && item.extra_title !== "闲鱼链接") return false;
  if (typeof item.extra_url !== "string") return false;
  try {
    const host = new URL(item.extra_url).hostname;
    return host === "m.tb.cn" || host === "h5.m.goofish.com" || host.endsWith(".goofish.com");
  } catch {
    return false;
  }
};

const stripCommerceAttachments = (item, stats) => {
  if (!isObject(item)) return false;
  let changed = false;
  const extraEntities = Array.isArray(item.extra_entities) ? item.extra_entities : undefined;
  const hasSkuEntity = extraEntities?.some(
    (entity) => isObject(entity) && entity.sku_id != null,
  ) || false;
  const hasGoodsCover = typeof item.extra_pic === "string" && item.extra_pic.includes("/goods_cover/");
  const hasTradeAttachment = isTradeAttachment(item);
  const hasGoodsCollection = isNonEmpty(item.include_goods) || isNonEmpty(item.include_goods_ids);
  const hasCommerceEvidence = hasSkuEntity || hasGoodsCover || hasTradeAttachment || hasGoodsCollection;

  if (extraEntities && !hasGoodsCover && !hasTradeAttachment) {
    let write = 0;
    const originalLength = extraEntities.length;
    for (let read = 0; read < originalLength; read += 1) {
      const entity = extraEntities[read];
      if (isObject(entity) && entity.sku_id != null) continue;
      extraEntities[write] = entity;
      write += 1;
    }
    if (write !== originalLength) {
      stats.filteredChildren.extra_entities =
        (stats.filteredChildren.extra_entities || 0) + originalLength - write;
      extraEntities.length = write;
      changed = true;
    }
  }

  if (isNonEmpty(item.include_goods)) changed = assign(item, "include_goods", null, stats) || changed;
  if (isNonEmpty(item.include_goods_ids)) changed = assign(item, "include_goods_ids", null, stats) || changed;
  if (hasOwn(item, "goodsDisplayLimit") && item.goodsDisplayLimit != null && item.goodsDisplayLimit !== 0) {
    changed = assign(item, "goodsDisplayLimit", 0, stats) || changed;
  }

  if (hasGoodsCover || hasTradeAttachment) {
    for (const key of ["extra_key", "extra_title", "extra_url", "extra_pic", "extra_info"]) {
      changed = assign(item, key, null, stats) || changed;
    }
    changed = assign(item, "extra_entities", null, stats) || changed;
  }
  if (hasCommerceEvidence && hasOwn(item, "is_include_goods") && item.is_include_goods !== 0) {
    changed = assign(item, "is_include_goods", 0, stats) || changed;
  }
  return changed;
};

const filterMainInit = (body, options, stats) => {
  if (!options.customizeMainInit || !Array.isArray(body.data)) return false;
  let changed = false;
  const data = body.data;
  let write = 0;
  const originalLength = data.length;
  for (let read = 0; read < originalLength; read += 1) {
    const item = data[read];
    if (!isObject(item)) {
      data[write] = item;
      write += 1;
      continue;
    }
    const template = typeof item.entityTemplate === "string" ? item.entityTemplate : "";
    if (template.includes("configCard") && String(item.title || "").includes("首页")) {
      stats.removedItems.mainInitHomeConfig = (stats.removedItems.mainInitHomeConfig || 0) + 1;
      changed = true;
      continue;
    }
    if (template.includes("textCard") || template.includes("configCard")) {
      changed = assign(item, "entities", null, stats) || changed;
    }
    data[write] = item;
    write += 1;
  }
  if (write !== originalLength) data.length = write;
  return changed;
};

const removalReasonForItem = (item, options) => {
  if (options.blockAds && isSponsorItem(item)) return "sponsor";
  if (options.blockImageCarousel && isImageCarousel(item)) return "imageCarousel";
  if (options.blockZhuanti && isZhuantiCard(item)) return "zhuanti";
  if (options.blockGoodsRankingCards && isGoodsRankingCard(item)) return "goodsRankingCard";
  if (options.blockListCards && isListCard(item)) return "listCard";
  return undefined;
};

const filterEntityArrays = (rootArray, options, stats) => {
  let changed = false;
  const pending = [rootArray];
  while (pending.length > 0) {
    const items = pending.pop();
    let write = 0;
    const originalLength = items.length;
    for (let read = 0; read < originalLength; read += 1) {
      const item = items[read];
      const removalReason = removalReasonForItem(item, options);
      if (removalReason) {
        stats.removedItems[removalReason] = (stats.removedItems[removalReason] || 0) + 1;
        changed = true;
        continue;
      }
      if (options.blockCommerceAttachments) {
        changed = stripCommerceAttachments(item, stats) || changed;
      }
      if (options.stripTrackingParameters) {
        changed = stripTrackingLinks(item, stats) || changed;
      }
      if (isObject(item) && Array.isArray(item.entities) && item.entities.length > 0) {
        pending.push(item.entities);
      }
      items[write] = item;
      write += 1;
    }
    if (write !== originalLength) items.length = write;
  }
  return changed;
};

const filterList = (body, options, stats) => {
  if (!Array.isArray(body.data)) return false;
  return filterEntityArrays(body.data, options, stats);
};

const filterSearchHotContent = (body, options, stats) => {
  if (!options.blockSearchHotContent || !Array.isArray(body.data) || body.data.length === 0) {
    return false;
  }
  stats.removedItems.searchHotContent = body.data.length;
  body.data.length = 0;
  return true;
};

const filterDetail = (body, options, stats) => {
  if (!isObject(body.data)) return false;
  const data = body.data;
  let changed = false;
  if (options.blockAds) {
    if (data.detailSponsorCard != null) changed = assign(data, "detailSponsorCard", null, stats) || changed;
    if (Array.isArray(data.hotReplyRows)) {
      const rows = data.hotReplyRows;
      let write = 0;
      const originalLength = rows.length;
      for (let read = 0; read < originalLength; read += 1) {
        const item = rows[read];
        if (isSponsorItem(item)) continue;
        rows[write] = item;
        write += 1;
      }
      if (write !== originalLength) {
        stats.removedItems.hotReplySponsor =
          (stats.removedItems.hotReplySponsor || 0) + originalLength - write;
        rows.length = write;
        changed = true;
      }
    }
  }
  if (options.blockCommerceAttachments) changed = stripCommerceAttachments(data, stats) || changed;
  if (options.stripTrackingParameters) changed = stripTrackingLinks(data, stats) || changed;
  return changed;
};

function filterCoolapkResponse({ url, body, options = {} }) {
  const endpoint = endpointForUrl(url);
  const stats = {
    endpoint: endpoint?.path,
    removedItems: {},
    clearedFields: {},
    filteredChildren: {},
  };
  if (!endpoint || typeof body !== "string" || body === "") {
    return { body, changed: false, stats };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { body, changed: false, stats };
  }
  if (!isObject(parsed)) return { body, changed: false, stats };

  const normalized = normalizeOptions(options);
  let changed = false;
  if (endpoint.role === "main-init") changed = filterMainInit(parsed, normalized, stats);
  else if (endpoint.variant === "hot-search") {
    changed = filterSearchHotContent(parsed, normalized, stats) || filterList(parsed, normalized, stats);
  }
  else if (endpoint.role === "list") changed = filterList(parsed, normalized, stats);
  else if (endpoint.role === "detail") changed = filterDetail(parsed, normalized, stats);

  return {
    body: changed ? JSON.stringify(parsed) : body,
    changed,
    stats,
  };
}


const PREFIX = "[Coolapk JSON Filter]";

function parseSurgeOptions(argument) {
  if (argument && typeof argument === "object") return normalizeOptions(argument);
  if (typeof argument === "string" && !argument.includes("{{{")) {
    try {
      return normalizeOptions(JSON.parse(argument));
    } catch {
      return normalizeOptions();
    }
  }
  return normalizeOptions();
}

function runSurgeResponse({ request, response, done, argument, log = console.log }) {
  try {
    const originalBody = response?.body;
    if (typeof originalBody !== "string" || originalBody === "") {
      done({});
      return;
    }
    const result = filterCoolapkResponse({
      url: request?.url,
      body: originalBody,
      options: parseSurgeOptions(argument),
    });
    if (!result.changed) {
      done({});
      return;
    }
    const removed = Object.values(result.stats.removedItems).reduce((sum, count) => sum + count, 0);
    const cleared = Object.values(result.stats.clearedFields).reduce((sum, count) => sum + count, 0);
    log(`${PREFIX} ${result.stats.endpoint}: removed ${removed}, cleared ${cleared}`);
    done({ body: result.body });
  } catch (error) {
    log(`${PREFIX} fail-open: ${error?.message ?? String(error)}`);
    done({});
  }
}

if (typeof $done === "function") {
  runSurgeResponse({
    request: $request,
    response: $response,
    done: $done,
    argument: typeof $argument === "undefined" ? undefined : $argument,
  });
}

})();
