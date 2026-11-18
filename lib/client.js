window.__ModuleLoader__.load({ id: "dsh-mediaops", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/client/MediaOpsWorkbench.tsx
var import_react = require("react");

// src/client/api.ts
var API_PREFIX = "/api/dsh-mediaops";
var REFERENCE_LIMIT = 64e3;
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function stringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const items = value.flatMap((entry) => typeof entry === "string" && entry.trim() !== "" ? [entry.trim()] : []);
  return items.length > 0 ? items : void 0;
}
function boolean(value) {
  return value === true;
}
function id(value) {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return void 0;
}
function list(value, keys) {
  if (Array.isArray(value)) return value;
  const top = record(value);
  if (top === void 0) return [];
  for (const key of keys) {
    if (Array.isArray(top[key])) return top[key];
  }
  const data = record(top.data);
  if (data !== void 0) {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  if (Array.isArray(top.data)) return top.data;
  return [];
}
function normalizeTopic(value) {
  const item = record(value);
  const itemId = id(item?.id);
  const title = text(item?.title) ?? text(item?.name);
  if (item === void 0 || itemId === void 0 || title === void 0) return void 0;
  return {
    id: itemId,
    title,
    angle: text(item.angle),
    summary: text(item.summary) ?? text(item.description),
    content: text(item.content),
    tags: stringArray(item.tags),
    platforms: stringArray(item.platforms),
    status: text(item.status),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at)
  };
}
function normalizeViral(value) {
  const item = record(value);
  const itemId = id(item?.id);
  const title = text(item?.title) ?? text(item?.name);
  if (item === void 0 || itemId === void 0 || title === void 0) return void 0;
  const hot = typeof item.hot === "number" || typeof item.hot === "string" ? item.hot : typeof item.hotScore === "number" || typeof item.hotScore === "string" ? item.hotScore : void 0;
  return {
    id: itemId,
    title,
    platform: text(item.platform),
    author: text(item.author),
    summary: text(item.summary) ?? text(item.description),
    notes: text(item.notes),
    url: text(item.url),
    hot,
    tags: stringArray(item.tags),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
    lastSeenAt: text(item.lastSeenAt) ?? text(item.last_seen_at)
  };
}
function normalizeDraft(value) {
  const item = record(value);
  const itemId = id(item?.id);
  const title = text(item?.title) ?? text(item?.name);
  if (item === void 0 || itemId === void 0 || title === void 0) return void 0;
  return {
    id: itemId,
    title,
    topicId: id(item.topicId) ?? id(item.topic_id),
    body: text(item.body) ?? text(item.content),
    platforms: stringArray(item.platforms),
    status: text(item.status),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at)
  };
}
function normalizePublication(value) {
  const item = record(value);
  const itemId = id(item?.id);
  if (item === void 0 || itemId === void 0) return void 0;
  return {
    id: itemId,
    draftId: id(item.draftId) ?? id(item.draft_id),
    title: text(item.title),
    platform: text(item.platform),
    status: text(item.status),
    resultUrl: text(item.resultUrl) ?? text(item.result_url) ?? text(item.externalUrl),
    error: text(item.error),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
    createdAt: text(item.createdAt) ?? text(item.created_at)
  };
}
function normalizeOverview(value) {
  const item = record(value) ?? {};
  const counts = record(item.counts) ?? {};
  const capabilities = record(item.capabilities) ?? {};
  const numeric = (key, fallbackKey = key) => {
    const value2 = item[key] ?? counts[fallbackKey];
    return typeof value2 === "number" && Number.isFinite(value2) ? value2 : void 0;
  };
  return {
    skillCount: numeric("skillCount", "skills") ?? (typeof capabilities.totalSkills === "number" ? capabilities.totalSkills : void 0),
    topicCount: numeric("topicCount", "topics"),
    viralCount: numeric("viralCount", "viral") ?? (typeof counts.viralItems === "number" ? counts.viralItems : void 0),
    draftCount: numeric("draftCount", "drafts"),
    publicationCount: numeric("publicationCount", "publications"),
    publishedCount: numeric("publishedCount", "published"),
    version: text(item.version)
  };
}
async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    credentials: "same-origin",
    headers
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = text(payload.error) ?? text(payload.message) ?? "";
    } catch {
    }
    throw new Error(detail === "" ? `HTTP ${response.status}` : `${detail} (HTTP ${response.status})`);
  }
  if (response.status === 204) return void 0;
  return response.json();
}
var REFERENCE_KINDS = /* @__PURE__ */ new Set(["topic", "viral", "draft", "publication"]);
function normalizeReference(value) {
  const item = record(value);
  const kind = text(item?.kind);
  const itemId = id(item?.id);
  const label = text(item?.label) ?? text(item?.title);
  if (item === void 0 || kind === void 0 || !REFERENCE_KINDS.has(kind) || itemId === void 0 || label === void 0) return void 0;
  if (itemId.length > 512 || label.length > 512) return void 0;
  const description = text(item.description)?.slice(0, 2e3);
  const hint = text(item.hint)?.slice(0, 512);
  return {
    kind,
    id: itemId,
    label,
    ...description === void 0 ? {} : { description },
    ...hint === void 0 ? {} : { hint },
    updatedAt: text(item.updatedAt) ?? text(item.updated_at)
  };
}
async function fetchReferences(query = "", signal) {
  const params = new URLSearchParams({ limit: "48" });
  if (query.trim() !== "") params.set("q", query.trim());
  const payload = await request(`/references?${params}`, signal === void 0 ? {} : { signal });
  return list(payload, ["items", "references"]).flatMap((item) => normalizeReference(item) ?? []);
}
async function fetchWorkbench(signal) {
  const options = signal === void 0 ? {} : { signal };
  const settled = await Promise.allSettled([
    request("/overview", options),
    request("/topics?limit=200", options),
    request("/viral?limit=200", options),
    request("/drafts?limit=200", options),
    request("/publications?limit=200", options)
  ]);
  if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
  const errors = settled.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
  if (errors.length === settled.length) throw errors[0];
  const value = (index) => {
    const entry = settled[index];
    return entry?.status === "fulfilled" ? entry.value : void 0;
  };
  return {
    overview: normalizeOverview(value(0)),
    topics: list(value(1), ["items", "topics"]).flatMap((item) => normalizeTopic(item) ?? []),
    viral: list(value(2), ["items", "viralItems", "viral"]).flatMap((item) => normalizeViral(item) ?? []),
    drafts: list(value(3), ["items", "drafts"]).flatMap((item) => normalizeDraft(item) ?? []),
    publications: list(value(4), ["items", "publications"]).flatMap((item) => normalizePublication(item) ?? [])
  };
}
async function createTopic(input) {
  const payload = await request("/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const top = record(payload);
  const normalized = normalizeTopic(top?.topic ?? top?.item ?? payload);
  if (normalized === void 0) throw new Error("Host \u672A\u8FD4\u56DE\u6709\u6548\u9009\u9898");
  return normalized;
}
async function promoteViral(id2) {
  const payload = await request(`/viral/${encodeURIComponent(id2)}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const top = record(payload);
  const normalized = normalizeTopic(top?.topic ?? top?.item ?? payload);
  if (normalized === void 0) throw new Error("Host \u672A\u8FD4\u56DE\u6574\u7406\u540E\u7684\u9009\u9898");
  return normalized;
}
async function fetchReference(kind, id2, signal) {
  const response = await fetch(`${API_PREFIX}/reference/${kind}/${encodeURIComponent(id2)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json, text/plain" },
    signal
  });
  if (!response.ok) throw new Error(`MediaOps \u5F15\u7528\u8BFB\u53D6\u5931\u8D25 (HTTP ${response.status})`);
  const contentType = response.headers.get("content-type") ?? "";
  let serialized;
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    const item = record(payload);
    serialized = text(item?.text) ?? text(item?.reference) ?? text(item?.content) ?? "";
  } else {
    serialized = await response.text();
  }
  if (serialized.trim() === "") throw new Error("MediaOps \u5F15\u7528\u5185\u5BB9\u4E3A\u7A7A");
  return serialized.length > REFERENCE_LIMIT ? `${serialized.slice(0, REFERENCE_LIMIT)}
[MediaOps reference truncated]` : serialized;
}
var MODEL_GROUPS = /* @__PURE__ */ new Set(["image", "video", "music", "voice"]);
var MODEL_FIELD_KINDS = /* @__PURE__ */ new Set(["text", "url", "select", "boolean"]);
var SENSITIVE_FIELD_NAME = /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|ACCESS[_-]?KEY)/iu;
function normalizeModelField(value) {
  const item = record(value);
  const key = text(item?.key);
  const label = text(item?.label);
  const kind = text(item?.kind);
  if (!item || !key || !label || !kind || !MODEL_FIELD_KINDS.has(kind)) return void 0;
  const secret = boolean(item.secret) || SENSITIVE_FIELD_NAME.test(key);
  return {
    key,
    label,
    required: boolean(item.required),
    secret,
    kind,
    choices: stringArray(item.choices),
    placeholder: text(item.placeholder),
    help: text(item.help),
    ...secret ? { configured: boolean(item.configured) } : { value: typeof item.value === "string" ? item.value : "" }
  };
}
function normalizeModelProvider(value) {
  const item = record(value);
  const itemId = text(item?.id);
  const label = text(item?.label);
  if (!item || !itemId || !label || !Array.isArray(item.fields)) return void 0;
  return {
    id: itemId,
    label,
    capabilities: stringArray(item.capabilities) ?? [],
    enabled: boolean(item.enabled),
    selected: boolean(item.selected),
    configured: boolean(item.configured),
    ready: boolean(item.ready),
    allowPrivateNetwork: boolean(item.allowPrivateNetwork),
    missingRequired: stringArray(item.missingRequired) ?? [],
    fields: item.fields.flatMap((entry) => normalizeModelField(entry) ?? []),
    updatedAt: text(item.updatedAt)
  };
}
function normalizeModelGroup(value) {
  const item = record(value);
  const itemId = text(item?.id);
  const label = text(item?.label);
  if (!item || !itemId || !MODEL_GROUPS.has(itemId) || !label || !Array.isArray(item.providers)) return void 0;
  return {
    id: itemId,
    label,
    description: text(item.description) ?? "",
    selectedProvider: text(item.selectedProvider),
    providers: item.providers.flatMap((entry) => normalizeModelProvider(entry) ?? [])
  };
}
function normalizeModelConfig(value) {
  const item = record(value);
  return {
    version: typeof item?.version === "number" && Number.isSafeInteger(item.version) ? item.version : 1,
    groups: Array.isArray(item?.groups) ? item.groups.flatMap((entry) => normalizeModelGroup(entry) ?? []) : []
  };
}
async function fetchModelConfig(signal) {
  return normalizeModelConfig(await request("/model-config", signal === void 0 ? {} : { signal }));
}
async function updateModelProvider(groupId, providerId, update) {
  const payload = await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  return normalizeModelConfig(payload);
}
async function clearModelProvider(groupId, providerId) {
  return normalizeModelConfig(await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}`, { method: "DELETE" }));
}
async function verifyModelProvider(groupId, providerId) {
  const payload = record(await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}/verify`, { method: "POST" }));
  return {
    configured: boolean(payload?.configured),
    ready: boolean(payload?.ready),
    errors: stringArray(payload?.errors) ?? []
  };
}

// src/client/MediaOpsWorkbench.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var EMPTY = {
  overview: {},
  topics: [],
  viral: [],
  drafts: [],
  publications: []
};
var styles = {
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    padding: 18,
    color: "inherit",
    fontSize: 13,
    lineHeight: 1.5
  },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 20, lineHeight: 1.25 },
  subtitle: { margin: "4px 0 0", opacity: 0.68, maxWidth: 720 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tabs: { display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid rgba(127,127,127,.22)", paddingBottom: 8 },
  button: {
    border: "1px solid rgba(127,127,127,.34)",
    borderRadius: 8,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    padding: "6px 11px"
  },
  buttonPrimary: {
    border: "1px solid #2563eb",
    borderRadius: 8,
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
    font: "inherit",
    padding: "6px 12px"
  },
  buttonActive: { background: "rgba(37,99,235,.16)", borderColor: "#3b82f6" },
  disabled: { cursor: "default", opacity: 0.5 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  metric: { border: "1px solid rgba(127,127,127,.24)", borderRadius: 12, padding: 12, background: "rgba(127,127,127,.06)" },
  metricValue: { display: "block", fontSize: 24, fontWeight: 650, lineHeight: 1.2 },
  metricLabel: { display: "block", marginTop: 4, opacity: 0.65 },
  panel: { border: "1px solid rgba(127,127,127,.24)", borderRadius: 12, padding: 14, background: "rgba(127,127,127,.045)" },
  panelTitle: { margin: "0 0 10px", fontSize: 15 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 },
  card: { border: "1px solid rgba(127,127,127,.22)", borderRadius: 10, padding: 12, minWidth: 0, background: "rgba(127,127,127,.045)" },
  cardTitle: { margin: 0, fontSize: 14, overflowWrap: "anywhere" },
  muted: { opacity: 0.66, fontSize: 12 },
  body: { margin: "7px 0", opacity: 0.86, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  badge: { display: "inline-flex", alignItems: "center", borderRadius: 99, background: "rgba(127,127,127,.14)", padding: "2px 7px", fontSize: 11 },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 180,
    border: "1px solid rgba(127,127,127,.34)",
    borderRadius: 8,
    background: "rgba(127,127,127,.08)",
    color: "inherit",
    font: "inherit",
    padding: "7px 9px"
  },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, alignItems: "end" },
  ok: { color: "#22c55e" },
  error: { color: "#ef4444" },
  empty: { border: "1px dashed rgba(127,127,127,.35)", borderRadius: 10, padding: 18, textAlign: "center", opacity: 0.7 },
  callout: { borderLeft: "3px solid #3b82f6", padding: "9px 12px", background: "rgba(59,130,246,.08)", borderRadius: "0 8px 8px 0" }
};
var TABS = [
  { id: "overview", label: "\u6982\u89C8" },
  { id: "topics", label: "\u9009\u9898\u5E93" },
  { id: "viral", label: "\u7206\u6B3E\u5E93" },
  { id: "drafts", label: "\u8349\u7A3F" },
  { id: "publications", label: "\u53D1\u5E03\u961F\u5217" }
];
var REFERENCE_KIND_LABEL = {
  topic: "\u9009\u9898",
  viral: "\u7206\u6B3E",
  draft: "\u8349\u7A3F",
  publication: "\u53D1\u5E03\u8BB0\u5F55"
};
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function formatTime(value) {
  if (value === void 0) return void 0;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
function safeUrl(value) {
  if (value === void 0) return void 0;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : void 0;
  } catch {
    return void 0;
  }
}
function referenceClipboardText(reference) {
  const label = reference.label.replace(/[\[\]()\r\n]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160) || "\u672A\u547D\u540D\u5185\u5BB9";
  return `@[${label}](dsh-mediaops:${reference.kind}:${encodeURIComponent(reference.id)})`;
}
function StatusBadge({ value }) {
  return value === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: value });
}
function Empty({ children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.empty, children });
}
function TopicCard({ item, onCopy }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.cardTitle, children: item.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, { value: item.status })
    ] }),
    item.angle !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.body, children: item.angle }) : null,
    item.summary !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.muted, children: item.summary }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, marginTop: 10 }, children: [
      item.tags?.slice(0, 5).map((tag) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.badge, children: [
        "#",
        tag
      ] }, tag)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, onClick: () => onCopy(item), children: "\u590D\u5236\u5B9A\u4F4D\u6587\u672C" })
    ] }),
    formatTime(item.updatedAt) !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.muted, marginTop: 8 }, children: [
      "\u66F4\u65B0\u4E8E ",
      formatTime(item.updatedAt)
    ] }) : null
  ] });
}
function ViralCard({ item, busy, onPromote }) {
  const href = safeUrl(item.url);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.cardTitle, children: item.title }),
      item.platform !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: item.platform }) : null
    ] }),
    item.summary !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.body, children: item.summary }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
      item.hot !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.muted, children: [
        "\u70ED\u5EA6 ",
        item.hot
      ] }) : null,
      item.author !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.muted, children: [
        "\u4F5C\u8005 ",
        item.author
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, marginTop: 10 }, children: [
      href !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, target: "_blank", rel: "noreferrer", style: { color: "#60a5fa" }, children: "\u67E5\u770B\u6765\u6E90" }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          disabled: busy,
          style: busy ? { ...styles.buttonPrimary, ...styles.disabled } : styles.buttonPrimary,
          onClick: () => onPromote(item),
          children: busy ? "\u6574\u7406\u4E2D\u2026" : "\u6574\u7406\u4E3A\u9009\u9898"
        }
      )
    ] })
  ] });
}
function DraftCard({ item }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.cardTitle, children: item.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, { value: item.status })
    ] }),
    item.body !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.body, children: [
      item.body.slice(0, 240),
      item.body.length > 240 ? "\u2026" : ""
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: item.platforms?.map((platform) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: platform }, platform)) })
  ] });
}
function PublicationCard({ item }) {
  const href = safeUrl(item.resultUrl);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.cardTitle, children: item.title ?? `\u53D1\u5E03\u4EFB\u52A1 ${item.id.slice(0, 8)}` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, { value: item.status })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, marginTop: 8 }, children: [
      item.platform !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: item.platform }) : null,
      href !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, target: "_blank", rel: "noreferrer", style: { color: "#60a5fa" }, children: "\u67E5\u770B\u7ED3\u679C" }) : null
    ] }),
    item.error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.error, marginTop: 8 }, children: item.error }) : null,
    formatTime(item.updatedAt ?? item.createdAt) !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.muted, marginTop: 8 }, children: formatTime(item.updatedAt ?? item.createdAt) }) : null
  ] });
}
function ReferenceCard({ item, onCopy }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.cardTitle, children: item.label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: REFERENCE_KIND_LABEL[item.kind] })
    ] }),
    item.description !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.body, children: item.description }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, marginTop: 8 }, children: [
      item.hint !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.muted, children: item.hint }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, onClick: () => onCopy(item), children: "\u590D\u5236 @ \u5F15\u7528" })
    ] })
  ] });
}
function MediaOpsWorkbench({ compact: compact2 = false }) {
  const [tab, setTab] = (0, import_react.useState)("overview");
  const [snapshot, setSnapshot] = (0, import_react.useState)(EMPTY);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [message, setMessage] = (0, import_react.useState)(null);
  const [title, setTitle] = (0, import_react.useState)("");
  const [angle, setAngle] = (0, import_react.useState)("");
  const [tags, setTags] = (0, import_react.useState)("");
  const [creating, setCreating] = (0, import_react.useState)(false);
  const [promoting, setPromoting] = (0, import_react.useState)(null);
  const [referenceQuery, setReferenceQuery] = (0, import_react.useState)("");
  const [referenceResults, setReferenceResults] = (0, import_react.useState)([]);
  const [referenceLoading, setReferenceLoading] = (0, import_react.useState)(false);
  const [referenceSearched, setReferenceSearched] = (0, import_react.useState)(false);
  const controllerRef = (0, import_react.useRef)(null);
  const referenceControllerRef = (0, import_react.useRef)(null);
  const reload = (0, import_react.useCallback)(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const next = await fetchWorkbench(controller.signal);
      if (!controller.signal.aborted) {
        setSnapshot(next);
        setMessage(null);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ kind: "error", text: `\u8BFB\u53D6 MediaOps \u6570\u636E\u5931\u8D25\uFF1A${errorText(error)}` });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void reload();
    return () => {
      controllerRef.current?.abort();
      referenceControllerRef.current?.abort();
    };
  }, [reload]);
  const counts = (0, import_react.useMemo)(() => ({
    skills: snapshot.overview.skillCount ?? 112,
    topics: snapshot.overview.topicCount ?? snapshot.topics.length,
    viral: snapshot.overview.viralCount ?? snapshot.viral.length,
    drafts: snapshot.overview.draftCount ?? snapshot.drafts.length,
    published: snapshot.overview.publishedCount ?? snapshot.publications.filter((item) => item.status === "published").length
  }), [snapshot]);
  const submitTopic = (0, import_react.useCallback)(async (event) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle === "") {
      setMessage({ kind: "error", text: "\u8BF7\u5148\u586B\u5199\u9009\u9898\u6807\u9898" });
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const topic = await createTopic({
        title: cleanTitle,
        angle: angle.trim() || void 0,
        tags: tags.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
      });
      setTitle("");
      setAngle("");
      setTags("");
      await reload();
      setMessage({ kind: "ok", text: `\u5DF2\u521B\u5EFA\u9009\u9898\u300C${topic.title}\u300D` });
      setTab("topics");
    } catch (error) {
      setMessage({ kind: "error", text: `\u521B\u5EFA\u5931\u8D25\uFF1A${errorText(error)}` });
    } finally {
      setCreating(false);
    }
  }, [angle, reload, tags, title]);
  const promote = (0, import_react.useCallback)(async (item) => {
    setPromoting(item.id);
    setMessage(null);
    try {
      const topic = await promoteViral(item.id);
      await reload();
      setMessage({ kind: "ok", text: `\u5DF2\u628A\u300C${item.title}\u300D\u6574\u7406\u4E3A\u9009\u9898\u300C${topic.title}\u300D` });
      setTab("topics");
    } catch (error) {
      setMessage({ kind: "error", text: `\u6574\u7406\u5931\u8D25\uFF1A${errorText(error)}` });
    } finally {
      setPromoting(null);
    }
  }, [reload]);
  const copyTopic = (0, import_react.useCallback)(async (item) => {
    const value = referenceClipboardText({ kind: "topic", id: item.id, label: item.title });
    try {
      if (navigator.clipboard === void 0) throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u526A\u8D34\u677F");
      await navigator.clipboard.writeText(value);
      setMessage({ kind: "ok", text: `\u5DF2\u590D\u5236\u300C${item.title}\u300D\u7684\u5B9A\u4F4D\u6587\u672C\uFF1B\u8981\u53D1\u9001\u5B8C\u6574\u7ED3\u6784\u5316\u8D44\u6599\uFF0C\u8BF7\u5728\u5BF9\u8BDD\u8F93\u5165\u6846\u952E\u5165 @ \u5E76\u4ECE\u9009\u9898\u5E93\u9009\u62E9` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u590D\u5236\u5931\u8D25\uFF1A${errorText(error)}` });
    }
  }, []);
  const submitReferenceSearch = (0, import_react.useCallback)(async (event) => {
    event.preventDefault();
    referenceControllerRef.current?.abort();
    const controller = new AbortController();
    referenceControllerRef.current = controller;
    setReferenceLoading(true);
    setReferenceSearched(true);
    try {
      const items = await fetchReferences(referenceQuery, controller.signal);
      if (!controller.signal.aborted) {
        setReferenceResults(items);
        setMessage(null);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ kind: "error", text: `\u641C\u7D22\u5F15\u7528\u5931\u8D25\uFF1A${errorText(error)}` });
    } finally {
      if (!controller.signal.aborted) setReferenceLoading(false);
    }
  }, [referenceQuery]);
  const copyReference = (0, import_react.useCallback)(async (item) => {
    try {
      if (navigator.clipboard === void 0) throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u526A\u8D34\u677F");
      await navigator.clipboard.writeText(referenceClipboardText(item));
      setMessage({ kind: "ok", text: `\u5DF2\u590D\u5236\u300C${item.label}\u300D\u7684 @ \u5F15\u7528\u5B9A\u4F4D\u6587\u672C` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u590D\u5236\u5931\u8D25\uFF1A${errorText(error)}` });
    }
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { style: compact2 ? { ...styles.page, height: "auto", padding: "4px 2px" } : styles.page, "aria-label": "DSH-MediaOps \u5DE5\u4F5C\u53F0", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { style: styles.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { style: styles.h1, children: "DSH-MediaOps" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.subtitle, children: "\u4ECE\u7206\u6B3E\u53D1\u73B0\u3001\u9009\u9898\u6C89\u6DC0\u3001\u5185\u5BB9\u751F\u4EA7\u5230\u5BA1\u6838\u53D1\u5E03\uFF0C\u90FD\u53EF\u4EE5\u76F4\u63A5\u5728\u5BF9\u8BDD\u4E2D\u5B8C\u6210\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        snapshot.overview.version !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.badge, children: [
          "v",
          snapshot.overview.version
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: loading ? { ...styles.button, ...styles.disabled } : styles.button, disabled: loading, onClick: () => void reload(), children: loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u5237\u65B0" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { style: styles.tabs, "aria-label": "MediaOps \u6570\u636E\u89C6\u56FE", children: TABS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        "aria-current": tab === item.id ? "page" : void 0,
        style: tab === item.id ? { ...styles.button, ...styles.buttonActive } : styles.button,
        onClick: () => setTab(item.id),
        children: item.label
      },
      item.id
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.panel, "aria-label": "\u7EDF\u4E00\u5F15\u7528\u641C\u7D22", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.panelTitle, children: "\u641C\u7D22\u5F15\u7528" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { style: styles.row, onSubmit: (event) => void submitReferenceSearch(event), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { flex: "1 1 320px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.muted, children: "\u641C\u7D22\u9009\u9898\u3001\u7206\u6B3E\u3001\u8349\u7A3F\u548C\u53D1\u5E03\u8BB0\u5F55" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "search",
              style: styles.input,
              value: referenceQuery,
              maxLength: 200,
              onChange: (event) => setReferenceQuery(event.target.value),
              placeholder: "\u6807\u9898\u3001\u6B63\u6587\u3001\u5E73\u53F0\u6216\u72B6\u6001"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", disabled: referenceLoading, style: referenceLoading ? { ...styles.button, ...styles.disabled } : styles.button, children: referenceLoading ? "\u641C\u7D22\u4E2D\u2026" : "\u641C\u7D22" })
      ] }),
      referenceSearched ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 10 }, "aria-live": "polite", children: referenceResults.length === 0 && !referenceLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "\u6CA1\u6709\u627E\u5230\u53EF\u5F15\u7528\u5185\u5BB9\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.grid, children: referenceResults.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReferenceCard, { item, onCopy: (value) => void copyReference(value) }, `${item.kind}:${item.id}`)) }) }) : null
    ] }),
    message !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", style: message.kind === "ok" ? styles.ok : styles.error, children: message.text }) : null,
    tab === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { style: styles.metrics, "aria-label": "MediaOps \u6982\u89C8\u6570\u636E", children: [
        ["\u80FD\u529B", counts.skills],
        ["\u9009\u9898", counts.topics],
        ["\u7206\u6B3E", counts.viral],
        ["\u8349\u7A3F", counts.drafts],
        ["\u5DF2\u53D1\u5E03", counts.published]
      ].map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.metric, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: styles.metricValue, children: value }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.metricLabel, children: label })
      ] }, String(label))) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.panel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.panelTitle, children: "\u5BF9\u8BDD\u5373\u5DE5\u4F5C\u53F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.callout, children: [
          "\u5728\u8F93\u5165\u6846\u952E\u5165 ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "@" }),
          " \u53EF\u5F15\u7528\u9009\u9898\u3001\u7206\u6B3E\u3001\u8349\u7A3F\u6216\u53D1\u5E03\u8BB0\u5F55\uFF1B\u952E\u5165 ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "/" }),
          " \u53EF\u542F\u52A8\u7206\u6B3E\u53D1\u73B0\u3001\u6574\u7406\u3001\u521B\u4F5C\u3001\u53D1\u5E03\u4E0E\u76D8\u70B9\u6D41\u7A0B\u3002\u53D1\u5E03\u6D41\u7A0B\u4F1A\u5148\u751F\u6210\u9884\u89C8\uFF0C\u53EA\u6709\u660E\u786E\u786E\u8BA4\u540E\u624D\u6267\u884C\u3002"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.panel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.panelTitle, children: "\u5FEB\u901F\u521B\u5EFA\u9009\u9898" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { style: styles.formGrid, onSubmit: (event) => void submitTopic(event), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.muted, children: "\u6807\u9898" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: title, maxLength: 240, onChange: (event) => setTitle(event.target.value), placeholder: "\u4F8B\u5982\uFF1AAI \u56E2\u961F\u5982\u4F55\u505A\u5185\u5BB9\u590D\u76D8" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.muted, children: "\u5207\u5165\u89D2\u5EA6" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: angle, maxLength: 500, onChange: (event) => setAngle(event.target.value), placeholder: "\u53D7\u4F17\u3001\u51B2\u7A81\u6216\u65B0\u9C9C\u89C2\u70B9" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.muted, children: "\u6807\u7B7E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: tags, maxLength: 300, onChange: (event) => setTags(event.target.value), placeholder: "AI, \u5185\u5BB9\u8FD0\u8425" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", disabled: creating, style: creating ? { ...styles.buttonPrimary, ...styles.disabled } : styles.buttonPrimary, children: creating ? "\u521B\u5EFA\u4E2D\u2026" : "\u521B\u5EFA" })
        ] })
      ] })
    ] }) : null,
    tab === "topics" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { children: snapshot.topics.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "\u9009\u9898\u5E93\u8FD8\u662F\u7A7A\u7684\u3002\u53EF\u5728\u6982\u89C8\u4E2D\u521B\u5EFA\uFF0C\u6216\u4ECE\u7206\u6B3E\u5E93\u6574\u7406\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.grid, children: snapshot.topics.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopicCard, { item, onCopy: copyTopic }, item.id)) }) }) : null,
    tab === "viral" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { children: snapshot.viral.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "\u7206\u6B3E\u5E93\u8FD8\u662F\u7A7A\u7684\u3002\u5728\u5BF9\u8BDD\u6846\u8F93\u5165 `/`\uFF0C\u9009\u62E9\u300C\u62C9\u53D6\u4ECA\u65E5\u7206\u6B3E\u300D\u5F00\u59CB\u53D1\u73B0\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.grid, children: snapshot.viral.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ViralCard, { item, busy: promoting === item.id, onPromote: (value) => void promote(value) }, item.id)) }) }) : null,
    tab === "drafts" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { children: snapshot.drafts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "\u6682\u65E0\u8349\u7A3F\u3002\u53EF\u5728\u5BF9\u8BDD\u6846 @ \u4E00\u4E2A\u9009\u9898\uFF0C\u7136\u540E\u8F93\u5165 `/` \u5E76\u9009\u62E9\u300C\u57FA\u4E8E\u9009\u9898\u521B\u4F5C\u300D\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.grid, children: snapshot.drafts.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DraftCard, { item }, item.id)) }) }) : null,
    tab === "publications" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { children: snapshot.publications.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "\u6682\u65E0\u53D1\u5E03\u4EFB\u52A1\u3002\u53D1\u5E03\u5FC5\u987B\u7ECF\u8FC7\u9884\u89C8\u548C\u660E\u786E\u786E\u8BA4\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.grid, children: snapshot.publications.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PublicationCard, { item }, item.id)) }) }) : null
  ] });
}

// src/client/contracts.ts
function parseLibraryReference(value) {
  if (value === void 0 || value.length > 4096) return void 0;
  try {
    const parsed = JSON.parse(value);
    if (parsed.kind !== "topic" && parsed.kind !== "viral" && parsed.kind !== "draft" && parsed.kind !== "publication") return void 0;
    if (typeof parsed.id !== "string" || parsed.id === "" || parsed.id.length > 512) return void 0;
    if (typeof parsed.label !== "string" || parsed.label === "" || parsed.label.length > 512) return void 0;
    return { kind: parsed.kind, id: parsed.id, label: parsed.label };
  } catch {
    return void 0;
  }
}

// src/client/triggers.ts
var MENTION_SOURCE = "mediaops-library";
var ACTION_SOURCE = "mediaops-actions";
function compact(value, limit = 100) {
  if (value === void 0) return void 0;
  const oneLine = value.replace(/\s+/gu, " ").trim();
  if (oneLine === "") return void 0;
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}\u2026` : oneLine;
}
function encodeReference(reference) {
  return JSON.stringify(reference);
}
function safeClipboardLabel(value) {
  return value.replace(/[\[\]()\r\n]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160) || "\u672A\u547D\u540D\u5185\u5BB9";
}
function clipboardReference(reference) {
  const label = safeClipboardLabel(reference.label);
  return `@[${label}](dsh-mediaops:${reference.kind}:${encodeURIComponent(reference.id)})`;
}
var REFERENCE_SECTIONS = {
  topic: "\u9009\u9898\u5E93",
  viral: "\u7206\u6B3E\u5E93",
  draft: "\u8349\u7A3F\u5E93",
  publication: "\u53D1\u5E03\u8BB0\u5F55"
};
function referenceCandidates(items) {
  return items.slice(0, 16).map((item) => {
    const description = compact(item.description);
    const hint = compact(item.hint, 120);
    return {
      name: item.label,
      ...description === void 0 ? {} : { description },
      ...hint === void 0 ? {} : { hint },
      section: REFERENCE_SECTIONS[item.kind],
      value: encodeReference({ kind: item.kind, id: item.id, label: item.label })
    };
  });
}
function createMentionSource() {
  return {
    trigger: "@",
    name: MENTION_SOURCE,
    order: 30,
    showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      try {
        const items = await fetchReferences(query, signal);
        return signal.aborted ? [] : referenceCandidates(items);
      } catch {
        return [];
      }
    },
    onPick({ candidate }) {
      const reference = parseLibraryReference(candidate.value);
      if (reference === void 0) return void 0;
      return {
        insert: {
          source: MENTION_SOURCE,
          ref: encodeReference(reference),
          label: reference.label,
          clipboardText: clipboardReference(reference)
        }
      };
    },
    codec: {
      clipboardText(ref) {
        const reference = parseLibraryReference(ref);
        return reference === void 0 ? "@[MediaOps \u5F15\u7528\u65E0\u6548](dsh-mediaops:invalid)" : clipboardReference(reference);
      },
      async serialize(ref, signal) {
        const reference = parseLibraryReference(ref);
        if (reference === void 0) throw new Error("MediaOps \u5F15\u7528\u5DF2\u635F\u574F\uFF0C\u8BF7\u5220\u9664\u540E\u91CD\u65B0\u9009\u62E9");
        return fetchReference(reference.kind, reference.id, signal);
      }
    }
  };
}
var QUICK_ACTIONS = [
  {
    id: "discover",
    name: "\u62C9\u53D6\u4ECA\u65E5\u7206\u6B3E",
    description: "\u626B\u63CF\u6307\u5B9A\u5E73\u53F0\u70ED\u699C\uFF0C\u5206\u6790\u53EF\u590D\u7528\u7ED3\u6784\u5E76\u4FDD\u5B58\u5230\u7206\u6B3E\u5E93",
    prompt: "\u8BF7\u7528 DSH-MediaOps \u62C9\u53D6\u4ECA\u5929\u7684\u70ED\u95E8\u5185\u5BB9\uFF0C\u6309\u5E73\u53F0\u3001\u70ED\u5EA6\u548C\u5185\u5BB9\u7ED3\u6784\u6574\u7406\uFF1B\u5148\u7ED9\u6211\u5019\u9009\u6E05\u5355\uFF0C\u5F97\u5230\u6211\u786E\u8BA4\u540E\u628A\u9009\u4E2D\u7684\u5185\u5BB9\u4FDD\u5B58\u5230\u7206\u6B3E\u5E93\u3002"
  },
  {
    id: "promote",
    name: "\u7206\u6B3E\u6574\u7406\u6210\u9009\u9898",
    description: "\u4ECE\u7206\u6B3E\u5E93\u63D0\u70BC\u53D7\u4F17\u3001\u94A9\u5B50\u3001\u89D2\u5EA6\u548C\u5E73\u53F0\u6253\u6CD5",
    prompt: "\u8BF7\u641C\u7D22 DSH-MediaOps \u7206\u6B3E\u5E93\uFF0C\u627E\u51FA\u503C\u5F97\u8DDF\u8FDB\u7684\u5185\u5BB9\uFF0C\u53BB\u91CD\u5E76\u63D0\u70BC\u4E3A\u53EF\u6267\u884C\u9009\u9898\uFF1B\u5C55\u793A\u6765\u6E90\u5173\u7CFB\uFF0C\u5F97\u5230\u6211\u786E\u8BA4\u540E\u5199\u5165\u9009\u9898\u5E93\u3002"
  },
  {
    id: "create",
    name: "\u57FA\u4E8E\u9009\u9898\u521B\u4F5C",
    description: "\u4ECE\u9009\u9898\u5E93\u9009\u62E9\u5185\u5BB9\uFF0C\u6309\u76EE\u6807\u5E73\u53F0\u751F\u6210\u8349\u7A3F",
    prompt: "\u8BF7\u8BA9\u6211\u4ECE DSH-MediaOps \u9009\u9898\u5E93\u9009\u62E9\u4E00\u4E2A\u9009\u9898\uFF0C\u7136\u540E\u6839\u636E\u76EE\u6807\u5E73\u53F0\u751F\u6210\u5185\u5BB9\u8349\u7A3F\uFF1B\u4FDD\u7559\u9009\u9898\u6765\u6E90\u4E0E\u7248\u672C\uFF0C\u5148\u5BA1\u7A3F\uFF0C\u4E0D\u8981\u76F4\u63A5\u53D1\u5E03\u3002"
  },
  {
    id: "publish",
    name: "\u5BA1\u6838\u5E76\u53D1\u5E03",
    description: "\u68C0\u67E5\u8349\u7A3F\u548C\u8D26\u53F7\u72B6\u6001\uFF0C\u751F\u6210\u53D1\u5E03\u9884\u89C8\u5E76\u7B49\u5F85\u660E\u786E\u786E\u8BA4",
    prompt: "\u8BF7\u6253\u5F00 DSH-MediaOps \u5F85\u53D1\u5E03\u8349\u7A3F\uFF0C\u5148\u505A\u5E73\u53F0\u89C4\u8303\u68C0\u67E5\u5E76\u751F\u6210\u53D1\u5E03\u9884\u89C8\uFF08\u5E73\u53F0\u3001\u8D26\u53F7\u3001\u6807\u9898\u3001\u6B63\u6587\u3001\u7D20\u6750\u3001\u5B9A\u65F6\u548C\u5E42\u7B49\u952E\uFF09\uFF1B\u53EA\u6709\u5728\u6211\u660E\u786E\u786E\u8BA4\u53D1\u5E03\u540E\u624D\u6267\u884C\u3002"
  },
  {
    id: "review",
    name: "\u4ECA\u65E5\u5185\u5BB9\u76D8\u70B9",
    description: "\u6C47\u603B\u9009\u9898\u3001\u8349\u7A3F\u3001\u53D1\u5E03\u7ED3\u679C\u548C\u5F85\u5904\u7406\u4E8B\u9879",
    prompt: "\u8BF7\u6C47\u603B DSH-MediaOps \u4ECA\u5929\u65B0\u589E\u7684\u7206\u6B3E\u3001\u9009\u9898\u3001\u8349\u7A3F\u548C\u53D1\u5E03\u8BB0\u5F55\uFF0C\u6307\u51FA\u963B\u585E\u9879\u3001\u98CE\u9669\u4E0E\u4E0B\u4E00\u6B65\u4F18\u5148\u7EA7\u3002"
  }
];
function actionCandidate(action) {
  return {
    name: action.name,
    description: action.description,
    section: "DSH-MediaOps",
    value: action.id
  };
}
function createActionSource() {
  return {
    trigger: "/",
    name: ACTION_SOURCE,
    order: 40,
    showGroupTitle: false,
    async candidates(_session, { query, position, signal }) {
      if (signal.aborted || position !== "leading") return [];
      const needle = query.trim().toLocaleLowerCase();
      return QUICK_ACTIONS.filter((action) => needle === "" || `${action.name} ${action.description} ${action.id}`.toLocaleLowerCase().includes(needle)).map(actionCandidate);
    },
    onPick({ candidate }) {
      const action = QUICK_ACTIONS.find((item) => item.id === candidate.value);
      return action === void 0 ? void 0 : { text: action.prompt, continue: true };
    }
  };
}

// src/client/ModelSettings.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var EMPTY2 = { version: 1, groups: [] };
var styles2 = {
  page: { boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "auto", padding: 18, color: "inherit", fontSize: 13, lineHeight: 1.5 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 20, lineHeight: 1.25 },
  subtitle: { margin: "4px 0 0", opacity: 0.68, maxWidth: 760 },
  tabs: { display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid rgba(127,127,127,.22)", paddingBottom: 8 },
  button: { border: "1px solid rgba(127,127,127,.34)", borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit", padding: "6px 11px" },
  primary: { border: "1px solid #2563eb", borderRadius: 8, background: "#2563eb", color: "#fff", cursor: "pointer", font: "inherit", padding: "7px 12px" },
  danger: { border: "1px solid rgba(239,68,68,.7)", borderRadius: 8, background: "transparent", color: "#ef4444", cursor: "pointer", font: "inherit", padding: "6px 11px" },
  active: { background: "rgba(37,99,235,.16)", borderColor: "#3b82f6" },
  disabled: { cursor: "default", opacity: 0.5 },
  panel: { border: "1px solid rgba(127,127,127,.24)", borderRadius: 12, padding: 14, background: "rgba(127,127,127,.045)" },
  panelTitle: { margin: "0 0 5px", fontSize: 15 },
  muted: { opacity: 0.68, fontSize: 12 },
  form: { display: "grid", gap: 12, marginTop: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10 },
  field: { display: "grid", alignContent: "start", gap: 4 },
  input: { boxSizing: "border-box", width: "100%", minWidth: 160, border: "1px solid rgba(127,127,127,.34)", borderRadius: 8, background: "rgba(127,127,127,.08)", color: "inherit", font: "inherit", padding: "8px 9px" },
  select: { boxSizing: "border-box", width: "100%", border: "1px solid rgba(127,127,127,.34)", borderRadius: 8, background: "rgba(127,127,127,.08)", color: "inherit", font: "inherit", padding: "8px 9px" },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  between: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  badge: { display: "inline-flex", alignItems: "center", borderRadius: 99, background: "rgba(127,127,127,.14)", padding: "2px 7px", fontSize: 11 },
  ok: { color: "#22c55e" },
  error: { color: "#ef4444" },
  warning: { borderLeft: "3px solid #f59e0b", padding: "9px 12px", background: "rgba(245,158,11,.09)", borderRadius: "0 8px 8px 0" },
  info: { borderLeft: "3px solid #3b82f6", padding: "9px 12px", background: "rgba(59,130,246,.08)", borderRadius: "0 8px 8px 0" },
  secretRow: { display: "grid", gridTemplateColumns: "minmax(160px, 1fr) auto", gap: 6 }
};
function errorText2(error) {
  return error instanceof Error ? error.message : String(error);
}
function currentGroup(snapshot, groupId) {
  return snapshot.groups.find((item) => item.id === groupId) ?? snapshot.groups[0];
}
function currentProvider(group, providerId) {
  return group?.providers.find((item) => item.id === providerId) ?? group?.providers.find((item) => item.selected) ?? group?.providers[0];
}
function ModelSettings() {
  const [snapshot, setSnapshot] = (0, import_react2.useState)(EMPTY2);
  const [groupId, setGroupId] = (0, import_react2.useState)("image");
  const [providerId, setProviderId] = (0, import_react2.useState)("");
  const [values, setValues] = (0, import_react2.useState)({});
  const [secrets, setSecrets] = (0, import_react2.useState)({});
  const [enabled, setEnabled] = (0, import_react2.useState)(false);
  const [allowPrivateNetwork, setAllowPrivateNetwork] = (0, import_react2.useState)(false);
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const [saving, setSaving] = (0, import_react2.useState)(false);
  const [message, setMessage] = (0, import_react2.useState)(null);
  const controllerRef = (0, import_react2.useRef)(null);
  const group = (0, import_react2.useMemo)(() => currentGroup(snapshot, groupId), [groupId, snapshot]);
  const provider = (0, import_react2.useMemo)(() => currentProvider(group, providerId), [group, providerId]);
  const load = (0, import_react2.useCallback)(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const next = await fetchModelConfig(controller.signal);
      if (!controller.signal.aborted) setSnapshot(next);
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ kind: "error", text: `\u8BFB\u53D6\u6A21\u578B\u914D\u7F6E\u5931\u8D25\uFF1A${errorText2(error)}` });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);
  (0, import_react2.useEffect)(() => {
    if (!group) return;
    if (group.id !== groupId) setGroupId(group.id);
    const next = currentProvider(group, providerId);
    if (!next) return;
    if (next.id !== providerId) setProviderId(next.id);
  }, [group, groupId, providerId]);
  (0, import_react2.useEffect)(() => {
    if (!provider) return;
    setValues(Object.fromEntries(provider.fields.filter((field) => !field.secret).map((field) => [field.key, field.value ?? ""])));
    setSecrets({});
    setEnabled(provider.enabled);
    setAllowPrivateNetwork(provider.allowPrivateNetwork);
  }, [group?.id, provider?.id, provider?.updatedAt]);
  const selectGroup = (0, import_react2.useCallback)((next) => {
    setGroupId(next.id);
    setProviderId(next.selectedProvider ?? next.providers[0]?.id ?? "");
    setMessage(null);
  }, []);
  const save = (0, import_react2.useCallback)(async (event) => {
    event.preventDefault();
    if (!group || !provider) return;
    if (allowPrivateNetwork && !provider.allowPrivateNetwork && !window.confirm("\u5141\u8BB8\u79C1\u7F51\u540E\uFF0C\u8BE5 provider \u53EF\u4EE5\u8FDE\u63A5\u5185\u7F51\u5730\u5740\u3002\u53EA\u6709\u5728\u4F60\u4FE1\u4EFB\u6B64 API \u7AEF\u70B9\u65F6\u7EE7\u7EED\u3002")) return;
    setSaving(true);
    setMessage(null);
    try {
      const update = {
        enabled,
        allowPrivateNetwork,
        setAsDefault: true,
        values: Object.fromEntries(provider.fields.filter((field) => !field.secret).map((field) => [field.key, field.kind === "boolean" ? values[field.key] === "1" : values[field.key] ?? ""])),
        secretChanges: Object.fromEntries(provider.fields.filter((field) => field.secret).map((field) => {
          const value = secrets[field.key]?.trim() ?? "";
          return [field.key, value ? { action: "replace", value } : { action: "keep" }];
        }))
      };
      const next = await updateModelProvider(group.id, provider.id, update);
      setSnapshot(next);
      setSecrets({});
      setMessage({ kind: "ok", text: `\u5DF2\u5B89\u5168\u4FDD\u5B58 ${provider.label}\uFF0C\u5E76\u8BBE\u4E3A${group.label}\u9ED8\u8BA4 provider` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u4FDD\u5B58\u5931\u8D25\uFF1A${errorText2(error)}` });
    } finally {
      setSaving(false);
    }
  }, [allowPrivateNetwork, enabled, group, provider, secrets, values]);
  const clearSecret = (0, import_react2.useCallback)(async (key, label) => {
    if (!group || !provider || !window.confirm(`\u786E\u8BA4\u6E05\u9664 ${provider.label} \u7684 ${label}\uFF1F\u6E05\u9664\u540E\u65E0\u6CD5\u6062\u590D\u3002`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await updateModelProvider(group.id, provider.id, { secretChanges: { [key]: { action: "clear" } } });
      setSnapshot(next);
      setSecrets((current) => ({ ...current, [key]: "" }));
      setMessage({ kind: "ok", text: `\u5DF2\u6E05\u9664 ${label}` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u6E05\u9664\u5931\u8D25\uFF1A${errorText2(error)}` });
    } finally {
      setSaving(false);
    }
  }, [group, provider]);
  const clearProvider = (0, import_react2.useCallback)(async () => {
    if (!group || !provider || !window.confirm(`\u786E\u8BA4\u5220\u9664 ${provider.label} \u7684\u5168\u90E8\u914D\u7F6E\u548C\u51ED\u8BC1\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await clearModelProvider(group.id, provider.id);
      setSnapshot(next);
      setSecrets({});
      setMessage({ kind: "ok", text: `\u5DF2\u5220\u9664 ${provider.label} \u7684\u5168\u90E8\u914D\u7F6E` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u5220\u9664\u5931\u8D25\uFF1A${errorText2(error)}` });
    } finally {
      setSaving(false);
    }
  }, [group, provider]);
  const verify = (0, import_react2.useCallback)(async () => {
    if (!group || !provider) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await verifyModelProvider(group.id, provider.id);
      setMessage(result.ready ? { kind: "ok", text: "\u79BB\u7EBF\u9A8C\u8BC1\u901A\u8FC7\uFF1A\u5FC5\u586B\u9879\u9F50\u5168\u3001\u683C\u5F0F\u6709\u6548\u4E14 provider \u5DF2\u542F\u7528\u3002\u5B9E\u9645\u8FDE\u901A\u6027\u4F1A\u5728\u9996\u6B21\u53D7\u63A7\u751F\u6210\u65F6\u9A8C\u8BC1\u3002" } : { kind: "error", text: `\u9A8C\u8BC1\u672A\u901A\u8FC7\uFF1A${result.errors.join("\uFF1B") || "\u914D\u7F6E\u4E0D\u5B8C\u6574"}` });
    } catch (error) {
      setMessage({ kind: "error", text: `\u9A8C\u8BC1\u5931\u8D25\uFF1A${errorText2(error)}` });
    } finally {
      setSaving(false);
    }
  }, [group, provider]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("main", { style: styles2.page, "aria-label": "DSH-MediaOps \u591A\u6A21\u6001\u6A21\u578B\u8BBE\u7F6E", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { style: styles2.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h1", { style: styles2.h1, children: "\u591A\u6A21\u6001\u6A21\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles2.subtitle, children: "\u96C6\u4E2D\u914D\u7F6E\u6587\u751F\u56FE\u3001\u6587\u751F\u89C6\u9891\u3001\u97F3\u4E50\u4E0E\u4E91\u7AEF\u8BED\u97F3 API\u3002\u5BC6\u94A5\u53EA\u4FDD\u5B58\u5728\u672C\u673A Host\uFF0C\u4E0D\u4F1A\u56DE\u4F20\u6D4F\u89C8\u5668\u3001\u5199\u5165\u4E1A\u52A1 state \u6216\u8FDB\u5165\u5BF9\u8BDD\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: loading, style: loading ? { ...styles2.button, ...styles2.disabled } : styles2.button, onClick: () => void load(), children: loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u5237\u65B0" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.info, children: [
      "\u5B9E\u9645\u751F\u6210\u7531 ",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "mediaops_run_model_script" }),
      " \u53D7\u63A7\u6267\u884C\uFF1A\u56FA\u5B9A\u811A\u672C\u3001\u56FA\u5B9A argv \u767D\u540D\u5355\u3001\u5F53\u524D workspace \u8DEF\u5F84\u7EA6\u675F\uFF0C\u5E76\u5728\u53EF\u80FD\u4EA7\u751F API \u8D39\u7528\u524D\u8BF7\u6C42 DSH \u539F\u751F\u5BA1\u6279\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("nav", { style: styles2.tabs, "aria-label": "\u6A21\u578B\u7C7B\u522B", children: snapshot.groups.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", "aria-current": group?.id === item.id ? "page" : void 0, style: group?.id === item.id ? { ...styles2.button, ...styles2.active } : styles2.button, onClick: () => selectGroup(item), children: item.label }, item.id)) }),
    message ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", style: message.kind === "ok" ? styles2.ok : styles2.error, children: message.text }) : null,
    !loading && !group ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles2.panel, children: "Host \u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u6A21\u578B\u7C7B\u522B\u3002" }) : null,
    group ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: styles2.panel, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.between, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: styles2.panelTitle, children: group.label }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles2.muted, children: group.description })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: styles2.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles2.muted, children: "Provider" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("select", { style: styles2.select, value: provider?.id ?? "", onChange: (event) => setProviderId(event.target.value), children: group.providers.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: item.id, children: [
            item.label,
            item.selected ? "\uFF08\u9ED8\u8BA4\uFF09" : ""
          ] }, item.id)) })
        ] })
      ] }),
      provider ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { style: styles2.form, onSubmit: (event) => void save(event), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.row, children: [
          provider.capabilities.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles2.badge, children: item }, item)),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: provider.ready ? styles2.ok : styles2.muted, children: provider.ready ? "\u25CF \u53EF\u8FD0\u884C" : provider.configured ? "\u25CB \u914D\u7F6E\u672A\u5C31\u7EEA" : "\u25CB \u672A\u914D\u7F6E" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles2.grid, children: provider.fields.map((field) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: styles2.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
            field.label,
            field.required ? " *" : ""
          ] }),
          field.secret ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.secretRow, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "password",
                autoComplete: "new-password",
                style: styles2.input,
                value: secrets[field.key] ?? "",
                maxLength: 32768,
                placeholder: field.configured ? "\u5DF2\u914D\u7F6E\uFF1B\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8" : "\u8F93\u5165\u540E\u5C06\u5B89\u5168\u4FDD\u5B58",
                onChange: (event) => setSecrets((current) => ({ ...current, [field.key]: event.target.value }))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: !field.configured || saving, style: !field.configured || saving ? { ...styles2.button, ...styles2.disabled } : styles2.button, onClick: () => void clearSecret(field.key, field.label), children: "\u6E05\u9664" })
          ] }) : field.kind === "select" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { style: styles2.select, value: values[field.key] ?? "", onChange: (event) => setValues((current) => ({ ...current, [field.key]: event.target.value })), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u81EA\u52A8 / \u672A\u8BBE\u7F6E" }),
            field.choices?.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: item, children: item }, item))
          ] }) : field.kind === "boolean" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: values[field.key] === "1", onChange: (event) => setValues((current) => ({ ...current, [field.key]: event.target.checked ? "1" : "" })) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: field.kind === "url" ? "url" : "text", style: styles2.input, value: values[field.key] ?? "", maxLength: 8192, placeholder: field.placeholder, onChange: (event) => setValues((current) => ({ ...current, [field.key]: event.target.value })) }),
          field.help ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles2.muted, children: field.help }) : null
        ] }, field.key)) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: styles2.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
          "\u542F\u7528\u6B64 provider"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: styles2.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: allowPrivateNetwork, onChange: (event) => setAllowPrivateNetwork(event.target.checked) }),
          "\u5141\u8BB8\u79C1\u6709\u7F51\u7EDC\u5730\u5740\uFF08\u4EC5\u81EA\u6258\u7BA1 API\uFF09"
        ] }),
        allowPrivateNetwork ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles2.warning, children: "\u5DF2\u5141\u8BB8\u8BE5 provider \u8BBF\u95EE\u5185\u7F51\u6216 HTTP \u7AEF\u70B9\u3002\u4EC5\u7528\u4E8E\u4F60\u63A7\u5236\u5E76\u4FE1\u4EFB\u7684\u81EA\u6258\u7BA1\u670D\u52A1\uFF1B\u516C\u5F00 SaaS \u4E0D\u5E94\u5F00\u542F\u3002" }) : null,
        provider.missingRequired.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.muted, children: [
          "\u7F3A\u5C11\uFF1A",
          provider.missingRequired.join("\u3001")
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles2.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", disabled: saving, style: saving ? { ...styles2.primary, ...styles2.disabled } : styles2.primary, children: saving ? "\u5904\u7406\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u8BBE\u4E3A\u9ED8\u8BA4" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: saving, style: saving ? { ...styles2.button, ...styles2.disabled } : styles2.button, onClick: () => void verify(), children: "\u79BB\u7EBF\u9A8C\u8BC1" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: saving || !provider.configured, style: saving || !provider.configured ? { ...styles2.danger, ...styles2.disabled } : styles2.danger, onClick: () => void clearProvider(), children: "\u5220\u9664\u5168\u90E8\u914D\u7F6E" })
        ] })
      ] }) : null
    ] }) : null
  ] });
}

// src/client/index.tsx
var MEDIAOPS_SIDEBAR_TAB_ID = "dsh-mediaops/rightbar";
var inject = ["slots", "inputTriggers", "sidebarRightTabs"];
function apply(ctx) {
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createMentionSource()),
    "dsh-mediaops: @ library source"
  );
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createActionSource()),
    "dsh-mediaops: / workflow source"
  );
  ctx.slots.inject("conversation.view", () => ctx.slots.register(
    {
      name: "conversation.view",
      id: "mediaops",
      order: 20,
      label: "MediaOps"
    },
    () => (0, import_react3.createElement)(MediaOpsWorkbench)
  ));
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    {
      name: "settings.section",
      id: "mediaops",
      order: 35,
      label: "MediaOps"
    },
    () => (0, import_react3.createElement)(MediaOpsWorkbench, { compact: true })
  ));
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    {
      name: "settings.section",
      id: "mediaops-models",
      order: 36,
      label: "\u591A\u6A21\u6001\u6A21\u578B"
    },
    () => (0, import_react3.createElement)(ModelSettings)
  ));
  ctx.effect(
    () => ctx.sidebarRightTabs.register({
      id: MEDIAOPS_SIDEBAR_TAB_ID,
      kind: "mediaops",
      title: () => "MediaOps",
      guide: [{
        id: "dsh-mediaops",
        order: 10,
        title: () => "MediaOps",
        description: () => "\u9009\u9898\u3001\u7206\u6B3E\u3001\u8349\u7A3F\u4E0E\u53D1\u5E03\u961F\u5217"
      }]
    }),
    "dsh-mediaops: rightbar tab type"
  );
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    {
      name: "sidebar.right.pane.tab",
      key: MEDIAOPS_SIDEBAR_TAB_ID
    },
    () => (0, import_react3.createElement)(MediaOpsWorkbench, { compact: true })
  ));
}
return module.exports; } });
