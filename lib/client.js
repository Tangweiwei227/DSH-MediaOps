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
var import_react2 = require("react");

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
async function fetchTopics(query = "", signal) {
  const params = new URLSearchParams({ limit: "50" });
  if (query.trim() !== "") params.set("q", query.trim());
  const payload = await request(`/topics?${params}`, signal === void 0 ? {} : { signal });
  return list(payload, ["items", "topics"]).flatMap((item) => {
    const normalized = normalizeTopic(item);
    return normalized === void 0 ? [] : [normalized];
  });
}
async function fetchViral(query = "", signal) {
  const params = new URLSearchParams({ limit: "50" });
  if (query.trim() !== "") params.set("q", query.trim());
  const payload = await request(`/viral?${params}`, signal === void 0 ? {} : { signal });
  return list(payload, ["items", "viralItems", "viral"]).flatMap((item) => {
    const normalized = normalizeViral(item);
    return normalized === void 0 ? [] : [normalized];
  });
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
  const controllerRef = (0, import_react.useRef)(null);
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
    return () => controllerRef.current?.abort();
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
    const label = item.title.replace(/[\[\]()\r\n]/gu, " ").slice(0, 160);
    const value = `@[${label}](dsh-mediaops:topic:${encodeURIComponent(item.id)})`;
    try {
      if (navigator.clipboard === void 0) throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u526A\u8D34\u677F");
      await navigator.clipboard.writeText(value);
      setMessage({ kind: "ok", text: `\u5DF2\u590D\u5236\u300C${item.title}\u300D\u7684\u5B9A\u4F4D\u6587\u672C\uFF1B\u8981\u53D1\u9001\u5B8C\u6574\u7ED3\u6784\u5316\u8D44\u6599\uFF0C\u8BF7\u5728\u5BF9\u8BDD\u8F93\u5165\u6846\u952E\u5165 @ \u5E76\u4ECE\u9009\u9898\u5E93\u9009\u62E9` });
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
          " \u53EF\u5F15\u7528\u9009\u9898\u5E93\u6216\u7206\u6B3E\u5E93\uFF1B\u952E\u5165 ",
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
    if (parsed.kind !== "topic" && parsed.kind !== "viral") return void 0;
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
function topicCandidates(items) {
  return items.slice(0, 12).map((item) => {
    const description = compact(item.angle ?? item.summary ?? item.content);
    const hint = item.status ?? item.tags?.slice(0, 3).join(" \xB7 ");
    return {
      name: item.title,
      ...description === void 0 ? {} : { description },
      ...hint === void 0 || hint === "" ? {} : { hint },
      section: "\u9009\u9898\u5E93",
      value: encodeReference({ kind: "topic", id: item.id, label: item.title })
    };
  });
}
function viralCandidates(items) {
  return items.slice(0, 12).map((item) => {
    const description = compact(item.summary ?? item.notes);
    const hint = [item.platform, item.hot === void 0 ? void 0 : `\u70ED\u5EA6 ${item.hot}`].filter(Boolean).join(" \xB7 ");
    return {
      name: item.title,
      ...description === void 0 ? {} : { description },
      ...hint === "" ? {} : { hint },
      section: "\u7206\u6B3E\u5E93",
      value: encodeReference({ kind: "viral", id: item.id, label: item.title })
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
      const [topics, viral] = await Promise.allSettled([
        fetchTopics(query, signal),
        fetchViral(query, signal)
      ]);
      if (signal.aborted) return [];
      return [
        ...topicCandidates(topics.status === "fulfilled" ? topics.value : []),
        ...viralCandidates(viral.status === "fulfilled" ? viral.value : [])
      ];
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

// src/client/index.tsx
var inject = ["slots", "inputTriggers"];
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
    () => (0, import_react2.createElement)(MediaOpsWorkbench)
  ));
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    {
      name: "settings.section",
      id: "mediaops",
      order: 35,
      label: "MediaOps"
    },
    () => (0, import_react2.createElement)(MediaOpsWorkbench, { compact: true })
  ));
}
return module.exports; } });
