module.exports = [
"[project]/docs/node_modules/fumadocs-core/dist/fetch-2XFMBLBA.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "fetchDocs",
    ()=>fetchDocs
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$U67V476Y$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-U67V476Y.js [app-ssr] (ecmascript)");
;
// src/search/client/fetch.ts
var cache = /* @__PURE__ */ new Map();
async function fetchDocs(query, { api = "/api/search", locale, tag }) {
    const url = new URL(api, window.location.origin);
    url.searchParams.set("query", query);
    if (locale) url.searchParams.set("locale", locale);
    if (tag) url.searchParams.set("tag", Array.isArray(tag) ? tag.join(",") : tag);
    const key = `${url.pathname}?${url.searchParams}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const res = await fetch(key);
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    cache.set(key, result);
    return result;
}
;
}),
];

//# sourceMappingURL=126f3_fumadocs-core_dist_fetch-2XFMBLBA_299e8abb.js.map