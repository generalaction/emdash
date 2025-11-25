(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/docs/node_modules/fumadocs-core/dist/chunk-ZMWYLUDP.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/utils/remove-undefined.ts
__turbopack_context__.s([
    "removeUndefined",
    ()=>removeUndefined
]);
function removeUndefined(value, deep = false) {
    const obj = value;
    for(const key in obj){
        if (obj[key] === void 0) delete obj[key];
        if (!deep) continue;
        const entry = obj[key];
        if (typeof entry === "object" && entry !== null) {
            removeUndefined(entry, deep);
            continue;
        }
        if (Array.isArray(entry)) {
            for (const item of entry)removeUndefined(item, deep);
        }
    }
    return value;
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/chunk-OTD7MV33.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/search/index.ts
__turbopack_context__.s([
    "createContentHighlighter",
    ()=>createContentHighlighter
]);
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildRegexFromQuery(q) {
    const trimmed = q.trim();
    if (trimmed.length === 0) return null;
    const terms = Array.from(new Set(trimmed.split(/\s+/).map((t)=>t.trim()).filter(Boolean)));
    if (terms.length === 0) return null;
    const escaped = terms.map(escapeRegExp).join("|");
    return new RegExp(`(${escaped})`, "gi");
}
function createContentHighlighter(query) {
    const regex = typeof query === "string" ? buildRegexFromQuery(query) : query;
    return {
        highlight (content) {
            if (!regex) return [
                {
                    type: "text",
                    content
                }
            ];
            const out = [];
            let i = 0;
            for (const match of content.matchAll(regex)){
                if (i < match.index) {
                    out.push({
                        type: "text",
                        content: content.substring(i, match.index)
                    });
                }
                out.push({
                    type: "text",
                    content: match[0],
                    styles: {
                        highlight: true
                    }
                });
                i = match.index + match[0].length;
            }
            if (i < content.length) {
                out.push({
                    type: "text",
                    content: content.substring(i)
                });
            }
            return out;
        }
    };
}
;
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/languages.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SPLITTERS",
    ()=>SPLITTERS,
    "STEMMERS",
    ()=>STEMMERS,
    "SUPPORTED_LANGUAGES",
    ()=>SUPPORTED_LANGUAGES,
    "getLocale",
    ()=>getLocale
]);
const STEMMERS = {
    arabic: 'ar',
    armenian: 'am',
    bulgarian: 'bg',
    czech: 'cz',
    danish: 'dk',
    dutch: 'nl',
    english: 'en',
    finnish: 'fi',
    french: 'fr',
    german: 'de',
    greek: 'gr',
    hungarian: 'hu',
    indian: 'in',
    indonesian: 'id',
    irish: 'ie',
    italian: 'it',
    lithuanian: 'lt',
    nepali: 'np',
    norwegian: 'no',
    portuguese: 'pt',
    romanian: 'ro',
    russian: 'ru',
    serbian: 'rs',
    slovenian: 'ru',
    spanish: 'es',
    swedish: 'se',
    tamil: 'ta',
    turkish: 'tr',
    ukrainian: 'uk',
    sanskrit: 'sk'
};
const SPLITTERS = {
    dutch: /[^A-Za-zàèéìòóù0-9_'-]+/gim,
    english: /[^A-Za-zàèéìòóù0-9_'-]+/gim,
    french: /[^a-z0-9äâàéèëêïîöôùüûœç-]+/gim,
    italian: /[^A-Za-zàèéìòóù0-9_'-]+/gim,
    norwegian: /[^a-z0-9_æøåÆØÅäÄöÖüÜ]+/gim,
    portuguese: /[^a-z0-9à-úÀ-Ú]/gim,
    russian: /[^a-z0-9а-яА-ЯёЁ]+/gim,
    spanish: /[^a-z0-9A-Zá-úÁ-ÚñÑüÜ]+/gim,
    swedish: /[^a-z0-9_åÅäÄöÖüÜ-]+/gim,
    german: /[^a-z0-9A-ZäöüÄÖÜß]+/gim,
    finnish: /[^a-z0-9äöÄÖ]+/gim,
    danish: /[^a-z0-9æøåÆØÅ]+/gim,
    hungarian: /[^a-z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ]+/gim,
    romanian: /[^a-z0-9ăâîșțĂÂÎȘȚ]+/gim,
    serbian: /[^a-z0-9čćžšđČĆŽŠĐ]+/gim,
    turkish: /[^a-z0-9çÇğĞıİöÖşŞüÜ]+/gim,
    lithuanian: /[^a-z0-9ąčęėįšųūžĄČĘĖĮŠŲŪŽ]+/gim,
    arabic: /[^a-z0-9أ-ي]+/gim,
    nepali: /[^a-z0-9अ-ह]+/gim,
    irish: /[^a-z0-9áéíóúÁÉÍÓÚ]+/gim,
    indian: /[^a-z0-9अ-ह]+/gim,
    armenian: /[^a-z0-9ա-ֆ]+/gim,
    greek: /[^a-z0-9α-ωά-ώ]+/gim,
    indonesian: /[^a-z0-9]+/gim,
    ukrainian: /[^a-z0-9а-яА-ЯіїєІЇЄ]+/gim,
    slovenian: /[^a-z0-9čžšČŽŠ]+/gim,
    bulgarian: /[^a-z0-9а-яА-Я]+/gim,
    tamil: /[^a-z0-9அ-ஹ]+/gim,
    sanskrit: /[^a-z0-9A-Zāīūṛḷṃṁḥśṣṭḍṇṅñḻḹṝ]+/gim,
    czech: /[^A-Z0-9a-zěščřžýáíéúůóťďĚŠČŘŽÝÁÍÉÓÚŮŤĎ-]+/gim
};
const SUPPORTED_LANGUAGES = Object.keys(STEMMERS);
function getLocale(language) {
    return language !== undefined && SUPPORTED_LANGUAGES.includes(language) ? STEMMERS[language] : undefined;
} //# sourceMappingURL=languages.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MAX_ARGUMENT_FOR_STACK",
    ()=>MAX_ARGUMENT_FOR_STACK,
    "convertDistanceToMeters",
    ()=>convertDistanceToMeters,
    "flattenObject",
    ()=>flattenObject,
    "formatBytes",
    ()=>formatBytes,
    "formatNanoseconds",
    ()=>formatNanoseconds,
    "getDocumentProperties",
    ()=>getDocumentProperties,
    "getNanosecondTimeViaPerformance",
    ()=>getNanosecondTimeViaPerformance,
    "getNanosecondsTime",
    ()=>getNanosecondsTime,
    "getNested",
    ()=>getNested,
    "getOwnProperty",
    ()=>getOwnProperty,
    "getTokenFrequency",
    ()=>getTokenFrequency,
    "insertSortedValue",
    ()=>insertSortedValue,
    "intersect",
    ()=>intersect,
    "isAsyncFunction",
    ()=>isAsyncFunction,
    "isInsideNode",
    ()=>isInsideNode,
    "isInsideWebWorker",
    ()=>isInsideWebWorker,
    "isPromise",
    ()=>isPromise,
    "isServer",
    ()=>isServer,
    "removeVectorsFromHits",
    ()=>removeVectorsFromHits,
    "safeArrayPush",
    ()=>safeArrayPush,
    "setDifference",
    ()=>setDifference,
    "setIntersection",
    ()=>setIntersection,
    "setUnion",
    ()=>setUnion,
    "sleep",
    ()=>sleep,
    "sortTokenScorePredicate",
    ()=>sortTokenScorePredicate,
    "sprintf",
    ()=>sprintf,
    "uniqueId",
    ()=>uniqueId
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/docs/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
;
const baseId = Date.now().toString().slice(5);
let lastId = 0;
const k = 1024;
const nano = BigInt(1e3);
const milli = BigInt(1e6);
const second = BigInt(1e9);
const isServer = typeof window === 'undefined';
const MAX_ARGUMENT_FOR_STACK = 65535;
function safeArrayPush(arr, newArr) {
    if (newArr.length < MAX_ARGUMENT_FOR_STACK) {
        Array.prototype.push.apply(arr, newArr);
    } else {
        const newArrLength = newArr.length;
        for(let i = 0; i < newArrLength; i += MAX_ARGUMENT_FOR_STACK){
            Array.prototype.push.apply(arr, newArr.slice(i, i + MAX_ARGUMENT_FOR_STACK));
        }
    }
}
function sprintf(template, ...args) {
    return template.replace(/%(?:(?<position>\d+)\$)?(?<width>-?\d*\.?\d*)(?<type>[dfs])/g, function(...replaceArgs) {
        const groups = replaceArgs[replaceArgs.length - 1];
        const { width: rawWidth, type, position } = groups;
        const replacement = position ? args[Number.parseInt(position) - 1] : args.shift();
        const width = rawWidth === '' ? 0 : Number.parseInt(rawWidth);
        switch(type){
            case 'd':
                return replacement.toString().padStart(width, '0');
            case 'f':
                {
                    let value = replacement;
                    const [padding, precision] = rawWidth.split('.').map((w)=>Number.parseFloat(w));
                    if (typeof precision === 'number' && precision >= 0) {
                        value = value.toFixed(precision);
                    }
                    return typeof padding === 'number' && padding >= 0 ? value.toString().padStart(width, '0') : value.toString();
                }
            case 's':
                return width < 0 ? replacement.toString().padEnd(-width, ' ') : replacement.toString().padStart(width, ' ');
            default:
                return replacement;
        }
    });
}
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) {
        return '0 Bytes';
    }
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = [
        'Bytes',
        'KB',
        'MB',
        'GB',
        'TB',
        'PB',
        'EB',
        'ZB',
        'YB'
    ];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
function isInsideWebWorker() {
    // @ts-expect-error - WebWorker global scope
    return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
}
function isInsideNode() {
    return typeof __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"] !== 'undefined' && __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].release && __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].release.name === 'node';
}
function getNanosecondTimeViaPerformance() {
    return BigInt(Math.floor(performance.now() * 1e6));
}
function formatNanoseconds(value) {
    if (typeof value === 'number') {
        value = BigInt(value);
    }
    if (value < nano) {
        return `${value}ns`;
    } else if (value < milli) {
        return `${value / nano}μs`;
    } else if (value < second) {
        return `${value / milli}ms`;
    }
    return `${value / second}s`;
}
function getNanosecondsTime() {
    if (isInsideWebWorker()) {
        return getNanosecondTimeViaPerformance();
    }
    if (isInsideNode()) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].hrtime.bigint();
    }
    if (typeof __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"] !== 'undefined' && typeof __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"]?.hrtime?.bigint === 'function') {
        return __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].hrtime.bigint();
    }
    if (typeof performance !== 'undefined') {
        return getNanosecondTimeViaPerformance();
    }
    // @todo: fallback to V8 native method to get microtime
    return BigInt(0);
}
function uniqueId() {
    return `${baseId}-${lastId++}`;
}
function getOwnProperty(object, property) {
    // Checks if `hasOwn` method is defined avoiding errors with older Node.js versions
    if (Object.hasOwn === undefined) {
        return Object.prototype.hasOwnProperty.call(object, property) ? object[property] : undefined;
    }
    return Object.hasOwn(object, property) ? object[property] : undefined;
}
function getTokenFrequency(token, tokens) {
    let count = 0;
    for (const t of tokens){
        if (t === token) {
            count++;
        }
    }
    return count;
}
function insertSortedValue(arr, el, compareFn = sortTokenScorePredicate) {
    let low = 0;
    let high = arr.length;
    let mid;
    while(low < high){
        mid = low + high >>> 1;
        if (compareFn(el, arr[mid]) < 0) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    arr.splice(low, 0, el);
    return arr;
}
function sortTokenScorePredicate(a, b) {
    if (b[1] === a[1]) {
        return a[0] - b[0];
    }
    return b[1] - a[1];
}
function intersect(arrays) {
    if (arrays.length === 0) {
        return [];
    } else if (arrays.length === 1) {
        return arrays[0];
    }
    for(let i = 1; i < arrays.length; i++){
        if (arrays[i].length < arrays[0].length) {
            const tmp = arrays[0];
            arrays[0] = arrays[i];
            arrays[i] = tmp;
        }
    }
    const set = new Map();
    for (const elem of arrays[0]){
        set.set(elem, 1);
    }
    for(let i = 1; i < arrays.length; i++){
        let found = 0;
        for (const elem of arrays[i]){
            const count = set.get(elem);
            if (count === i) {
                set.set(elem, count + 1);
                found++;
            }
        }
        if (found === 0) return [];
    }
    return arrays[0].filter((e)=>{
        const count = set.get(e);
        if (count !== undefined) set.set(e, 0);
        return count === arrays.length;
    });
}
function getDocumentProperties(doc, paths) {
    const properties = {};
    const pathsLength = paths.length;
    for(let i = 0; i < pathsLength; i++){
        const path = paths[i];
        const pathTokens = path.split('.');
        let current = doc;
        const pathTokensLength = pathTokens.length;
        for(let j = 0; j < pathTokensLength; j++){
            current = current[pathTokens[j]];
            // We found an object but we were supposed to be done
            if (typeof current === 'object') {
                if (current !== null && 'lat' in current && 'lon' in current && typeof current.lat === 'number' && typeof current.lon === 'number') {
                    current = properties[path] = current;
                    break;
                } else if (!Array.isArray(current) && current !== null && j === pathTokensLength - 1) {
                    current = undefined;
                    break;
                }
            } else if ((current === null || typeof current !== 'object') && j < pathTokensLength - 1) {
                // We can't recurse anymore but we were supposed to
                current = undefined;
                break;
            }
        }
        if (typeof current !== 'undefined') {
            properties[path] = current;
        }
    }
    return properties;
}
function getNested(obj, path) {
    const props = getDocumentProperties(obj, [
        path
    ]);
    return props[path];
}
function flattenObject(obj, prefix = '') {
    const result = {};
    for(const key in obj){
        const prop = `${prefix}${key}`;
        const objKey = obj[key];
        if (typeof objKey === 'object' && objKey !== null) {
            Object.assign(result, flattenObject(objKey, `${prop}.`));
        } else {
            result[prop] = objKey;
        }
    }
    return result;
}
const mapDistanceToMeters = {
    cm: 0.01,
    m: 1,
    km: 1000,
    ft: 0.3048,
    yd: 0.9144,
    mi: 1609.344
};
function convertDistanceToMeters(distance, unit) {
    const ratio = mapDistanceToMeters[unit];
    if (ratio === undefined) {
        throw new Error((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_DISTANCE_SUFFIX', distance).message);
    }
    return distance * ratio;
}
function removeVectorsFromHits(searchResult, vectorProperties) {
    searchResult.hits = searchResult.hits.map((result)=>({
            ...result,
            document: {
                ...result.document,
                // Remove embeddings from the result
                ...vectorProperties.reduce((acc, prop)=>{
                    const path = prop.split('.');
                    const lastKey = path.pop();
                    let obj = acc;
                    for (const key of path){
                        obj[key] = obj[key] ?? {};
                        obj = obj[key];
                    }
                    obj[lastKey] = null;
                    return acc;
                }, result.document)
            }
        }));
}
function isPromise(obj) {
    return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
}
function isAsyncFunction(func) {
    if (Array.isArray(func)) {
        return func.some((item)=>isAsyncFunction(item));
    }
    return func?.constructor?.name === 'AsyncFunction';
}
const withIntersection = 'intersection' in new Set();
function setIntersection(...sets) {
    // Fast path 1
    if (sets.length === 0) {
        return new Set();
    }
    // Fast path 2
    if (sets.length === 1) {
        return sets[0];
    }
    // Fast path 3
    if (sets.length === 2) {
        const set1 = sets[0];
        const set2 = sets[1];
        if (withIntersection) {
            return set1.intersection(set2);
        }
        const result = new Set();
        const base = set1.size < set2.size ? set1 : set2;
        const other = base === set1 ? set2 : set1;
        for (const value of base){
            if (other.has(value)) {
                result.add(value);
            }
        }
        return result;
    }
    // Slow path
    // Find the smallest set
    const min = {
        index: 0,
        size: sets[0].size
    };
    for(let i = 1; i < sets.length; i++){
        if (sets[i].size < min.size) {
            min.index = i;
            min.size = sets[i].size;
        }
    }
    if (withIntersection) {
        let base = sets[min.index];
        for(let i = 0; i < sets.length; i++){
            if (i === min.index) {
                continue;
            }
            base = base.intersection(sets[i]);
        }
        return base;
    }
    // manual implementation:
    // intersect all sets with the smallest set
    const base = sets[min.index];
    for(let i = 0; i < sets.length; i++){
        if (i === min.index) {
            continue;
        }
        const other = sets[i];
        for (const value of base){
            if (!other.has(value)) {
                base.delete(value);
            }
        }
    }
    return base;
}
const withUnion = 'union' in new Set();
function setUnion(set1, set2) {
    if (withUnion) {
        if (set1) {
            return set1.union(set2);
        }
        return set2;
    }
    if (!set1) {
        return new Set(set2);
    }
    return new Set([
        ...set1,
        ...set2
    ]);
}
function setDifference(set1, set2) {
    const result = new Set();
    for (const value of set1){
        if (!set2.has(value)) {
            result.add(value);
        }
    }
    return result;
}
function sleep(ms) {
    if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined') {
        const nil = new Int32Array(new SharedArrayBuffer(4));
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
            if (typeof ms !== 'number' && typeof ms !== 'bigint') {
                throw TypeError('sleep: ms must be a number');
            }
            throw RangeError('sleep: ms must be a number that is greater than 0 but less than Infinity');
        }
        Atomics.wait(nil, 0, 0, Number(ms));
    } else {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
            if (typeof ms !== 'number' && typeof ms !== 'bigint') {
                throw TypeError('sleep: ms must be a number');
            }
            throw RangeError('sleep: ms must be a number that is greater than 0 but less than Infinity');
        }
        const target = Date.now() + Number(ms);
        while(target > Date.now()){
        /* empty */ }
    }
} //# sourceMappingURL=utils.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createError",
    ()=>createError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/languages.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
const allLanguages = __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SUPPORTED_LANGUAGES"].join('\n - ');
const errors = {
    NO_LANGUAGE_WITH_CUSTOM_TOKENIZER: 'Do not pass the language option to create when using a custom tokenizer.',
    LANGUAGE_NOT_SUPPORTED: `Language "%s" is not supported.\nSupported languages are:\n - ${allLanguages}`,
    INVALID_STEMMER_FUNCTION_TYPE: `config.stemmer property must be a function.`,
    MISSING_STEMMER: `As of version 1.0.0 @orama/orama does not ship non English stemmers by default. To solve this, please explicitly import and specify the "%s" stemmer from the package @orama/stemmers. See https://docs.orama.com/docs/orama-js/text-analysis/stemming for more information.`,
    CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY: 'Custom stop words array must only contain strings.',
    UNSUPPORTED_COMPONENT: `Unsupported component "%s".`,
    COMPONENT_MUST_BE_FUNCTION: `The component "%s" must be a function.`,
    COMPONENT_MUST_BE_FUNCTION_OR_ARRAY_FUNCTIONS: `The component "%s" must be a function or an array of functions.`,
    INVALID_SCHEMA_TYPE: `Unsupported schema type "%s" at "%s". Expected "string", "boolean" or "number" or array of them.`,
    DOCUMENT_ID_MUST_BE_STRING: `Document id must be of type "string". Got "%s" instead.`,
    DOCUMENT_ALREADY_EXISTS: `A document with id "%s" already exists.`,
    DOCUMENT_DOES_NOT_EXIST: `A document with id "%s" does not exists.`,
    MISSING_DOCUMENT_PROPERTY: `Missing searchable property "%s".`,
    INVALID_DOCUMENT_PROPERTY: `Invalid document property "%s": expected "%s", got "%s"`,
    UNKNOWN_INDEX: `Invalid property name "%s". Expected a wildcard string ("*") or array containing one of the following properties: %s`,
    INVALID_BOOST_VALUE: `Boost value must be a number greater than, or less than 0.`,
    INVALID_FILTER_OPERATION: `You can only use one operation per filter, you requested %d.`,
    SCHEMA_VALIDATION_FAILURE: `Cannot insert document due schema validation failure on "%s" property.`,
    INVALID_SORT_SCHEMA_TYPE: `Unsupported sort schema type "%s" at "%s". Expected "string" or "number".`,
    CANNOT_SORT_BY_ARRAY: `Cannot configure sort for "%s" because it is an array (%s).`,
    UNABLE_TO_SORT_ON_UNKNOWN_FIELD: `Unable to sort on unknown field "%s". Allowed fields: %s`,
    SORT_DISABLED: `Sort is disabled. Please read the documentation at https://docs.orama.com/docs/orama-js for more information.`,
    UNKNOWN_GROUP_BY_PROPERTY: `Unknown groupBy property "%s".`,
    INVALID_GROUP_BY_PROPERTY: `Invalid groupBy property "%s". Allowed types: "%s", but given "%s".`,
    UNKNOWN_FILTER_PROPERTY: `Unknown filter property "%s".`,
    UNKNOWN_VECTOR_PROPERTY: `Unknown vector property "%s". Make sure the property exists in the schema and is configured as a vector.`,
    INVALID_VECTOR_SIZE: `Vector size must be a number greater than 0. Got "%s" instead.`,
    INVALID_VECTOR_VALUE: `Vector value must be a number greater than 0. Got "%s" instead.`,
    INVALID_INPUT_VECTOR: `Property "%s" was declared as a %s-dimensional vector, but got a %s-dimensional vector instead.\nInput vectors must be of the size declared in the schema, as calculating similarity between vectors of different sizes can lead to unexpected results.`,
    WRONG_SEARCH_PROPERTY_TYPE: `Property "%s" is not searchable. Only "string" properties are searchable.`,
    FACET_NOT_SUPPORTED: `Facet doens't support the type "%s".`,
    INVALID_DISTANCE_SUFFIX: `Invalid distance suffix "%s". Valid suffixes are: cm, m, km, mi, yd, ft.`,
    INVALID_SEARCH_MODE: `Invalid search mode "%s". Valid modes are: "fulltext", "vector", "hybrid".`,
    MISSING_VECTOR_AND_SECURE_PROXY: `No vector was provided and no secure proxy was configured. Please provide a vector or configure an Orama Secure Proxy to perform hybrid search.`,
    MISSING_TERM: `"term" is a required parameter when performing hybrid search. Please provide a search term.`,
    INVALID_VECTOR_INPUT: `Invalid "vector" property. Expected an object with "value" and "property" properties, but got "%s" instead.`,
    PLUGIN_CRASHED: `A plugin crashed during initialization. Please check the error message for more information:`,
    PLUGIN_SECURE_PROXY_NOT_FOUND: `Could not find '@orama/secure-proxy-plugin' installed in your Orama instance.\nPlease install it before proceeding with creating an answer session.\nRead more at https://docs.orama.com/docs/orama-js/plugins/plugin-secure-proxy#plugin-secure-proxy\n`,
    PLUGIN_SECURE_PROXY_MISSING_CHAT_MODEL: `Could not find a chat model defined in the secure proxy plugin configuration.\nPlease provide a chat model before proceeding with creating an answer session.\nRead more at https://docs.orama.com/docs/orama-js/plugins/plugin-secure-proxy#plugin-secure-proxy\n`,
    ANSWER_SESSION_LAST_MESSAGE_IS_NOT_ASSISTANT: `The last message in the session is not an assistant message. Cannot regenerate non-assistant messages.`,
    PLUGIN_COMPONENT_CONFLICT: `The component "%s" is already defined. The plugin "%s" is trying to redefine it.`
};
function createError(code, ...args) {
    const error = new Error((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sprintf"])(errors[code] ?? `Unsupported Orama Error code: ${code}`, ...args));
    error.code = code;
    if ('captureStackTrace' in Error.prototype) {
        Error.captureStackTrace(error);
    }
    return error;
} //# sourceMappingURL=errors.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatElapsedTime",
    ()=>formatElapsedTime,
    "getDocumentIndexId",
    ()=>getDocumentIndexId,
    "getInnerType",
    ()=>getInnerType,
    "getVectorSize",
    ()=>getVectorSize,
    "isArrayType",
    ()=>isArrayType,
    "isGeoPointType",
    ()=>isGeoPointType,
    "isVectorType",
    ()=>isVectorType,
    "validateSchema",
    ()=>validateSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
;
function formatElapsedTime(n) {
    return {
        raw: Number(n),
        formatted: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNanoseconds"])(n)
    };
}
function getDocumentIndexId(doc) {
    if (doc.id) {
        if (typeof doc.id !== 'string') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof doc.id);
        }
        return doc.id;
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["uniqueId"])();
}
function validateSchema(doc, schema) {
    for (const [prop, type] of Object.entries(schema)){
        const value = doc[prop];
        if (typeof value === 'undefined') {
            continue;
        }
        if (type === 'geopoint' && typeof value === 'object' && typeof value.lon === 'number' && typeof value.lat === 'number') {
            continue;
        }
        if (type === 'enum' && (typeof value === 'string' || typeof value === 'number')) {
            continue;
        }
        if (type === 'enum[]' && Array.isArray(value)) {
            const valueLength = value.length;
            for(let i = 0; i < valueLength; i++){
                if (typeof value[i] !== 'string' && typeof value[i] !== 'number') {
                    return prop + '.' + i;
                }
            }
            continue;
        }
        if (isVectorType(type)) {
            const vectorSize = getVectorSize(type);
            if (!Array.isArray(value) || value.length !== vectorSize) {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_INPUT_VECTOR', prop, vectorSize, value.length);
            }
            continue;
        }
        if (isArrayType(type)) {
            if (!Array.isArray(value)) {
                return prop;
            }
            const expectedType = getInnerType(type);
            const valueLength = value.length;
            for(let i = 0; i < valueLength; i++){
                if (typeof value[i] !== expectedType) {
                    return prop + '.' + i;
                }
            }
            continue;
        }
        if (typeof type === 'object') {
            if (!value || typeof value !== 'object') {
                return prop;
            }
            // using as ResultDocument is not exactly right but trying to be type-safe here is not useful
            const subProp = validateSchema(value, type);
            if (subProp) {
                return prop + '.' + subProp;
            }
            continue;
        }
        if (typeof value !== type) {
            return prop;
        }
    }
    return undefined;
}
const IS_ARRAY_TYPE = {
    string: false,
    number: false,
    boolean: false,
    enum: false,
    geopoint: false,
    'string[]': true,
    'number[]': true,
    'boolean[]': true,
    'enum[]': true
};
const INNER_TYPE = {
    'string[]': 'string',
    'number[]': 'number',
    'boolean[]': 'boolean',
    'enum[]': 'enum'
};
function isGeoPointType(type) {
    return type === 'geopoint';
}
function isVectorType(type) {
    return typeof type === 'string' && /^vector\[\d+\]$/.test(type);
}
function isArrayType(type) {
    return typeof type === 'string' && IS_ARRAY_TYPE[type];
}
function getInnerType(type) {
    return INNER_TYPE[type];
}
function getVectorSize(type) {
    const size = Number(type.slice(7, -1));
    switch(true){
        case isNaN(size):
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_VECTOR_VALUE', type);
        case size <= 0:
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_VECTOR_SIZE', type);
        default:
            return size;
    }
} //# sourceMappingURL=defaults.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createInternalDocumentIDStore",
    ()=>createInternalDocumentIDStore,
    "getDocumentIdFromInternalId",
    ()=>getDocumentIdFromInternalId,
    "getInternalDocumentId",
    ()=>getInternalDocumentId,
    "load",
    ()=>load,
    "save",
    ()=>save
]);
function createInternalDocumentIDStore() {
    return {
        idToInternalId: new Map(),
        internalIdToId: [],
        save,
        load
    };
}
function save(store) {
    return {
        internalIdToId: store.internalIdToId
    };
}
function load(orama, raw) {
    const { internalIdToId } = raw;
    orama.internalDocumentIDStore.idToInternalId.clear();
    orama.internalDocumentIDStore.internalIdToId = [];
    const internalIdToIdLength = internalIdToId.length;
    for(let i = 0; i < internalIdToIdLength; i++){
        const internalIdItem = internalIdToId[i];
        orama.internalDocumentIDStore.idToInternalId.set(internalIdItem, i + 1);
        orama.internalDocumentIDStore.internalIdToId.push(internalIdItem);
    }
}
function getInternalDocumentId(store, id) {
    if (typeof id === 'string') {
        const internalId = store.idToInternalId.get(id);
        if (internalId) {
            return internalId;
        }
        const currentId = store.idToInternalId.size + 1;
        store.idToInternalId.set(id, currentId);
        store.internalIdToId.push(id);
        return currentId;
    }
    if (id > store.internalIdToId.length) {
        return getInternalDocumentId(store, id.toString());
    }
    return id;
}
function getDocumentIdFromInternalId(store, internalId) {
    if (store.internalIdToId.length < internalId) {
        throw new Error(`Invalid internalId ${internalId}`);
    }
    return store.internalIdToId[internalId - 1];
} //# sourceMappingURL=internal-document-id-store.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/documents-store.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "count",
    ()=>count,
    "create",
    ()=>create,
    "createDocumentsStore",
    ()=>createDocumentsStore,
    "get",
    ()=>get,
    "getAll",
    ()=>getAll,
    "getMultiple",
    ()=>getMultiple,
    "load",
    ()=>load,
    "remove",
    ()=>remove,
    "save",
    ()=>save,
    "store",
    ()=>store
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
;
function create(_, sharedInternalDocumentStore) {
    return {
        sharedInternalDocumentStore,
        docs: {},
        count: 0
    };
}
function get(store, id) {
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(store.sharedInternalDocumentStore, id);
    return store.docs[internalId];
}
function getMultiple(store, ids) {
    const idsLength = ids.length;
    const found = Array.from({
        length: idsLength
    });
    for(let i = 0; i < idsLength; i++){
        const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(store.sharedInternalDocumentStore, ids[i]);
        found[i] = store.docs[internalId];
    }
    return found;
}
function getAll(store) {
    return store.docs;
}
function store(store, id, internalId, doc) {
    if (typeof store.docs[internalId] !== 'undefined') {
        return false;
    }
    store.docs[internalId] = doc;
    store.count++;
    return true;
}
function remove(store, id) {
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(store.sharedInternalDocumentStore, id);
    if (typeof store.docs[internalId] === 'undefined') {
        return false;
    }
    delete store.docs[internalId];
    store.count--;
    return true;
}
function count(store) {
    return store.count;
}
function load(sharedInternalDocumentStore, raw) {
    const rawDocument = raw;
    return {
        docs: rawDocument.docs,
        count: rawDocument.count,
        sharedInternalDocumentStore
    };
}
function save(store) {
    return {
        docs: store.docs,
        count: store.count
    };
}
function createDocumentsStore() {
    return {
        create,
        get,
        getMultiple,
        getAll,
        store,
        remove,
        count,
        load,
        save
    };
} //# sourceMappingURL=documents-store.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/plugins.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AVAILABLE_PLUGIN_HOOKS",
    ()=>AVAILABLE_PLUGIN_HOOKS,
    "getAllPluginsByHook",
    ()=>getAllPluginsByHook
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
;
const AVAILABLE_PLUGIN_HOOKS = [
    'beforeInsert',
    'afterInsert',
    'beforeRemove',
    'afterRemove',
    'beforeUpdate',
    'afterUpdate',
    'beforeUpsert',
    'afterUpsert',
    'beforeSearch',
    'afterSearch',
    'beforeInsertMultiple',
    'afterInsertMultiple',
    'beforeRemoveMultiple',
    'afterRemoveMultiple',
    'beforeUpdateMultiple',
    'afterUpdateMultiple',
    'beforeUpsertMultiple',
    'afterUpsertMultiple',
    'beforeLoad',
    'afterLoad',
    'afterCreate'
];
function getAllPluginsByHook(orama, hook) {
    const pluginsToRun = [];
    const pluginsLength = orama.plugins?.length;
    if (!pluginsLength) {
        return pluginsToRun;
    }
    for(let i = 0; i < pluginsLength; i++){
        try {
            const plugin = orama.plugins[i];
            if (typeof plugin[hook] === 'function') {
                pluginsToRun.push(plugin[hook]);
            }
        } catch (error) {
            console.error('Caught error in getAllPluginsByHook:', error);
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('PLUGIN_CRASHED');
        }
    }
    return pluginsToRun;
} //# sourceMappingURL=plugins.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FUNCTION_COMPONENTS",
    ()=>FUNCTION_COMPONENTS,
    "OBJECT_COMPONENTS",
    ()=>OBJECT_COMPONENTS,
    "SINGLE_OR_ARRAY_COMPONENTS",
    ()=>SINGLE_OR_ARRAY_COMPONENTS,
    "runAfterCreate",
    ()=>runAfterCreate,
    "runAfterSearch",
    ()=>runAfterSearch,
    "runBeforeSearch",
    ()=>runBeforeSearch,
    "runMultipleHook",
    ()=>runMultipleHook,
    "runSingleHook",
    ()=>runSingleHook
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
const OBJECT_COMPONENTS = [
    'tokenizer',
    'index',
    'documentsStore',
    'sorter',
    'pinning'
];
const FUNCTION_COMPONENTS = [
    'validateSchema',
    'getDocumentIndexId',
    'getDocumentProperties',
    'formatElapsedTime'
];
const SINGLE_OR_ARRAY_COMPONENTS = [];
function runSingleHook(hooks, orama, id, doc) {
    const needAsync = hooks.some(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"]);
    if (needAsync) {
        return (async ()=>{
            for (const hook of hooks){
                await hook(orama, id, doc);
            }
        })();
    } else {
        for (const hook of hooks){
            hook(orama, id, doc);
        }
    }
}
function runMultipleHook(hooks, orama, docsOrIds) {
    const needAsync = hooks.some(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"]);
    if (needAsync) {
        return (async ()=>{
            for (const hook of hooks){
                await hook(orama, docsOrIds);
            }
        })();
    } else {
        for (const hook of hooks){
            hook(orama, docsOrIds);
        }
    }
}
function runAfterSearch(hooks, db, params, language, results) {
    const needAsync = hooks.some(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"]);
    if (needAsync) {
        return (async ()=>{
            for (const hook of hooks){
                await hook(db, params, language, results);
            }
        })();
    } else {
        for (const hook of hooks){
            hook(db, params, language, results);
        }
    }
}
function runBeforeSearch(hooks, db, params, language) {
    const needAsync = hooks.some(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"]);
    if (needAsync) {
        return (async ()=>{
            for (const hook of hooks){
                await hook(db, params, language);
            }
        })();
    } else {
        for (const hook of hooks){
            hook(db, params, language);
        }
    }
}
function runAfterCreate(hooks, db) {
    const needAsync = hooks.some(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"]);
    if (needAsync) {
        return (async ()=>{
            for (const hook of hooks){
                await hook(db);
            }
        })();
    } else {
        for (const hook of hooks){
            hook(db);
        }
    }
} //# sourceMappingURL=hooks.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/avl.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AVLNode",
    ()=>AVLNode,
    "AVLTree",
    ()=>AVLTree
]);
class AVLNode {
    k;
    v;
    l = null;
    r = null;
    h = 1;
    constructor(key, value){
        this.k = key;
        this.v = new Set(value);
    }
    updateHeight() {
        this.h = Math.max(AVLNode.getHeight(this.l), AVLNode.getHeight(this.r)) + 1;
    }
    static getHeight(node) {
        return node ? node.h : 0;
    }
    getBalanceFactor() {
        return AVLNode.getHeight(this.l) - AVLNode.getHeight(this.r);
    }
    rotateLeft() {
        const newRoot = this.r;
        this.r = newRoot.l;
        newRoot.l = this;
        this.updateHeight();
        newRoot.updateHeight();
        return newRoot;
    }
    rotateRight() {
        const newRoot = this.l;
        this.l = newRoot.r;
        newRoot.r = this;
        this.updateHeight();
        newRoot.updateHeight();
        return newRoot;
    }
    toJSON() {
        return {
            k: this.k,
            v: Array.from(this.v),
            l: this.l ? this.l.toJSON() : null,
            r: this.r ? this.r.toJSON() : null,
            h: this.h
        };
    }
    static fromJSON(json) {
        const node = new AVLNode(json.k, json.v);
        node.l = json.l ? AVLNode.fromJSON(json.l) : null;
        node.r = json.r ? AVLNode.fromJSON(json.r) : null;
        node.h = json.h;
        return node;
    }
}
class AVLTree {
    root = null;
    insertCount = 0;
    constructor(key, value){
        if (key !== undefined && value !== undefined) {
            this.root = new AVLNode(key, value);
        }
    }
    insert(key, value, rebalanceThreshold = 1000) {
        this.root = this.insertNode(this.root, key, value, rebalanceThreshold);
    }
    insertMultiple(key, value, rebalanceThreshold = 1000) {
        for (const v of value){
            this.insert(key, v, rebalanceThreshold);
        }
    }
    // Rebalance the tree if the insert count reaches the threshold.
    // This will improve insertion performance since we won't be rebalancing the tree on every insert.
    // When inserting docs using `insertMultiple`, the threshold will be set to the number of docs being inserted.
    // We can force rebalancing the tree by setting the threshold to 1 (default).
    rebalance() {
        if (this.root) {
            this.root = this.rebalanceNode(this.root);
        }
    }
    toJSON() {
        return {
            root: this.root ? this.root.toJSON() : null,
            insertCount: this.insertCount
        };
    }
    static fromJSON(json) {
        const tree = new AVLTree();
        tree.root = json.root ? AVLNode.fromJSON(json.root) : null;
        tree.insertCount = json.insertCount || 0;
        return tree;
    }
    insertNode(node, key, value, rebalanceThreshold) {
        if (node === null) {
            return new AVLNode(key, [
                value
            ]);
        }
        const path = [];
        let current = node;
        let parent = null;
        while(current !== null){
            path.push({
                parent,
                node: current
            });
            if (key < current.k) {
                if (current.l === null) {
                    current.l = new AVLNode(key, [
                        value
                    ]);
                    path.push({
                        parent: current,
                        node: current.l
                    });
                    break;
                } else {
                    parent = current;
                    current = current.l;
                }
            } else if (key > current.k) {
                if (current.r === null) {
                    current.r = new AVLNode(key, [
                        value
                    ]);
                    path.push({
                        parent: current,
                        node: current.r
                    });
                    break;
                } else {
                    parent = current;
                    current = current.r;
                }
            } else {
                // Key already exists
                current.v.add(value);
                /*
                if (Array.isArray(current.v)) {
                  if (Array.isArray(value)) {
                    ;(current.v as any[]).push(...(value as V[]))
                  } else {
                    ;(current.v as any[]).push(value)
                  }
                } else {
                  current.v = new Set([value])
                }
                */ return node;
            }
        }
        // Update heights and rebalance if necessary
        let needRebalance = false;
        if (this.insertCount++ % rebalanceThreshold === 0) {
            needRebalance = true;
        }
        for(let i = path.length - 1; i >= 0; i--){
            const { parent, node: currentNode } = path[i];
            currentNode.updateHeight();
            if (needRebalance) {
                const rebalancedNode = this.rebalanceNode(currentNode);
                if (parent) {
                    if (parent.l === currentNode) {
                        parent.l = rebalancedNode;
                    } else if (parent.r === currentNode) {
                        parent.r = rebalancedNode;
                    }
                } else {
                    // This is the root node
                    node = rebalancedNode;
                }
            }
        }
        return node;
    }
    rebalanceNode(node) {
        const balanceFactor = node.getBalanceFactor();
        if (balanceFactor > 1) {
            // Left heavy
            if (node.l && node.l.getBalanceFactor() >= 0) {
                // Left Left Case
                return node.rotateRight();
            } else if (node.l) {
                // Left Right Case
                node.l = node.l.rotateLeft();
                return node.rotateRight();
            }
        }
        if (balanceFactor < -1) {
            // Right heavy
            if (node.r && node.r.getBalanceFactor() <= 0) {
                // Right Right Case
                return node.rotateLeft();
            } else if (node.r) {
                // Right Left Case
                node.r = node.r.rotateRight();
                return node.rotateLeft();
            }
        }
        return node;
    }
    find(key) {
        const node = this.findNodeByKey(key);
        return node ? node.v : null;
    }
    contains(key) {
        return this.find(key) !== null;
    }
    getSize() {
        let count = 0;
        const stack = [];
        let current = this.root;
        while(current || stack.length > 0){
            while(current){
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            count++;
            current = current.r;
        }
        return count;
    }
    isBalanced() {
        if (!this.root) return true;
        const stack = [
            this.root
        ];
        while(stack.length > 0){
            const node = stack.pop();
            const balanceFactor = node.getBalanceFactor();
            if (Math.abs(balanceFactor) > 1) {
                return false;
            }
            if (node.l) stack.push(node.l);
            if (node.r) stack.push(node.r);
        }
        return true;
    }
    remove(key) {
        this.root = this.removeNode(this.root, key);
    }
    removeDocument(key, id) {
        const node = this.findNodeByKey(key);
        if (!node) {
            return;
        }
        if (node.v.size === 1) {
            this.root = this.removeNode(this.root, key);
        } else {
            node.v = new Set([
                ...node.v.values()
            ].filter((v)=>v !== id));
        }
    }
    findNodeByKey(key) {
        let node = this.root;
        while(node){
            if (key < node.k) {
                node = node.l;
            } else if (key > node.k) {
                node = node.r;
            } else {
                return node;
            }
        }
        return null;
    }
    removeNode(node, key) {
        if (node === null) return null;
        const path = [];
        let current = node;
        while(current !== null && current.k !== key){
            path.push(current);
            if (key < current.k) {
                current = current.l;
            } else {
                current = current.r;
            }
        }
        if (current === null) {
            // Key not found
            return node;
        }
        // Node with only one child or no child
        if (current.l === null || current.r === null) {
            const child = current.l ? current.l : current.r;
            if (path.length === 0) {
                // Node to be deleted is root
                node = child;
            } else {
                const parent = path[path.length - 1];
                if (parent.l === current) {
                    parent.l = child;
                } else {
                    parent.r = child;
                }
            }
        } else {
            // Node with two children: Get the inorder successor
            let successorParent = current;
            let successor = current.r;
            while(successor.l !== null){
                successorParent = successor;
                successor = successor.l;
            }
            // Copy the successor's content to current node
            current.k = successor.k;
            current.v = successor.v;
            // Delete the successor
            if (successorParent.l === successor) {
                successorParent.l = successor.r;
            } else {
                successorParent.r = successor.r;
            }
            current = successorParent;
        }
        // Update heights and rebalance
        path.push(current);
        for(let i = path.length - 1; i >= 0; i--){
            const currentNode = path[i];
            currentNode.updateHeight();
            const rebalancedNode = this.rebalanceNode(currentNode);
            if (i > 0) {
                const parent = path[i - 1];
                if (parent.l === currentNode) {
                    parent.l = rebalancedNode;
                } else if (parent.r === currentNode) {
                    parent.r = rebalancedNode;
                }
            } else {
                // Root node
                node = rebalancedNode;
            }
        }
        return node;
    }
    rangeSearch(min, max) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while(current || stack.length > 0){
            while(current){
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            if (current.k >= min && current.k <= max) {
                for (const value of current.v){
                    result.add(value);
                }
            }
            if (current.k > max) {
                break;
            }
            current = current.r;
        }
        return result;
    }
    greaterThan(key, inclusive = false) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while(current || stack.length > 0){
            while(current){
                stack.push(current);
                current = current.r; // Traverse right subtree first
            }
            current = stack.pop();
            if (inclusive && current.k >= key || !inclusive && current.k > key) {
                for (const value of current.v){
                    result.add(value);
                }
            } else if (current.k <= key) {
                break; // Since we're traversing in descending order, we can break early
            }
            current = current.l;
        }
        return result;
    }
    lessThan(key, inclusive = false) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while(current || stack.length > 0){
            while(current){
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            if (inclusive && current.k <= key || !inclusive && current.k < key) {
                for (const value of current.v){
                    result.add(value);
                }
            } else if (current.k > key) {
                break; // Since we're traversing in ascending order, we can break early
            }
            current = current.r;
        }
        return result;
    }
} //# sourceMappingURL=avl.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/flat.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FlatTree",
    ()=>FlatTree
]);
class FlatTree {
    numberToDocumentId;
    constructor(){
        this.numberToDocumentId = new Map();
    }
    insert(key, value) {
        if (this.numberToDocumentId.has(key)) {
            this.numberToDocumentId.get(key).add(value);
        } else {
            this.numberToDocumentId.set(key, new Set([
                value
            ]));
        }
    }
    find(key) {
        const idSet = this.numberToDocumentId.get(key);
        return idSet ? Array.from(idSet) : null;
    }
    remove(key) {
        this.numberToDocumentId.delete(key);
    }
    removeDocument(id, key) {
        const idSet = this.numberToDocumentId.get(key);
        if (idSet) {
            idSet.delete(id);
            if (idSet.size === 0) {
                this.numberToDocumentId.delete(key);
            }
        }
    }
    contains(key) {
        return this.numberToDocumentId.has(key);
    }
    getSize() {
        let size = 0;
        for (const idSet of this.numberToDocumentId.values()){
            size += idSet.size;
        }
        return size;
    }
    filter(operation) {
        const operationKeys = Object.keys(operation);
        if (operationKeys.length !== 1) {
            throw new Error('Invalid operation');
        }
        const operationType = operationKeys[0];
        switch(operationType){
            case 'eq':
                {
                    const value = operation[operationType];
                    const idSet = this.numberToDocumentId.get(value);
                    return idSet ? Array.from(idSet) : [];
                }
            case 'in':
                {
                    const values = operation[operationType];
                    const resultSet = new Set();
                    for (const value of values){
                        const idSet = this.numberToDocumentId.get(value);
                        if (idSet) {
                            for (const id of idSet){
                                resultSet.add(id);
                            }
                        }
                    }
                    return Array.from(resultSet);
                }
            case 'nin':
                {
                    const excludeValues = new Set(operation[operationType]);
                    const resultSet = new Set();
                    for (const [key, idSet] of this.numberToDocumentId.entries()){
                        if (!excludeValues.has(key)) {
                            for (const id of idSet){
                                resultSet.add(id);
                            }
                        }
                    }
                    return Array.from(resultSet);
                }
            default:
                throw new Error('Invalid operation');
        }
    }
    filterArr(operation) {
        const operationKeys = Object.keys(operation);
        if (operationKeys.length !== 1) {
            throw new Error('Invalid operation');
        }
        const operationType = operationKeys[0];
        switch(operationType){
            case 'containsAll':
                {
                    const values = operation[operationType];
                    const idSets = values.map((value)=>this.numberToDocumentId.get(value) ?? new Set());
                    if (idSets.length === 0) return [];
                    const intersection = idSets.reduce((prev, curr)=>{
                        return new Set([
                            ...prev
                        ].filter((id)=>curr.has(id)));
                    });
                    return Array.from(intersection);
                }
            case 'containsAny':
                {
                    const values = operation[operationType];
                    const idSets = values.map((value)=>this.numberToDocumentId.get(value) ?? new Set());
                    if (idSets.length === 0) return [];
                    const union = idSets.reduce((prev, curr)=>{
                        return new Set([
                            ...prev,
                            ...curr
                        ]);
                    });
                    return Array.from(union);
                }
            default:
                throw new Error('Invalid operation');
        }
    }
    static fromJSON(json) {
        if (!json.numberToDocumentId) {
            throw new Error('Invalid Flat Tree JSON');
        }
        const tree = new FlatTree();
        for (const [key, ids] of json.numberToDocumentId){
            tree.numberToDocumentId.set(key, new Set(ids));
        }
        return tree;
    }
    toJSON() {
        return {
            numberToDocumentId: Array.from(this.numberToDocumentId.entries()).map(([key, idSet])=>[
                    key,
                    Array.from(idSet)
                ])
        };
    }
} //# sourceMappingURL=flat.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/levenshtein.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Inspired by:
 * https://github.com/Yomguithereal/talisman/blob/86ae55cbd040ff021d05e282e0e6c71f2dde21f8/src/metrics/levenshtein.js#L218-L340
 */ __turbopack_context__.s([
    "boundedLevenshtein",
    ()=>boundedLevenshtein,
    "levenshtein",
    ()=>levenshtein,
    "syncBoundedLevenshtein",
    ()=>syncBoundedLevenshtein
]);
function _boundedLevenshtein(term, word, tolerance) {
    // Handle base cases
    if (tolerance < 0) return -1;
    if (term === word) return 0;
    const m = term.length;
    const n = word.length;
    // Special case for empty strings
    if (m === 0) return n <= tolerance ? n : -1;
    if (n === 0) return m <= tolerance ? m : -1;
    // term = term.toLowerCase()
    // word = word.toLowerCase()
    const diff = Math.abs(m - n);
    // Special case for prefixes
    // If the searching word starts with the indexed word, return early.
    if (term.startsWith(word)) {
        // We just check if the remaining characters are within the tolerance
        return diff <= tolerance ? diff : -1;
    }
    // If the indexed word starts with the searching word, return early.
    if (word.startsWith(term)) {
        // any prefixed word is within the tolerance
        return 0;
    }
    // If the length difference is greater than the tolerance, return early
    if (diff > tolerance) return -1;
    // Initialize the matrix
    const matrix = [];
    for(let i = 0; i <= m; i++){
        matrix[i] = [
            i
        ];
        for(let j = 1; j <= n; j++){
            matrix[i][j] = i === 0 ? j : 0;
        }
    }
    // Fill the matrix
    for(let i = 1; i <= m; i++){
        let rowMin = Infinity;
        for(let j = 1; j <= n; j++){
            if (term[i - 1] === word[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + 1 // substitution
                );
            }
            rowMin = Math.min(rowMin, matrix[i][j]);
        }
        // Early termination if all values in this row exceed tolerance
        if (rowMin > tolerance) {
            return -1;
        }
    }
    return matrix[m][n] <= tolerance ? matrix[m][n] : -1;
}
function boundedLevenshtein(term, w, tolerance) {
    const distance = _boundedLevenshtein(term, w, tolerance);
    return {
        distance,
        isBounded: distance >= 0
    };
}
function syncBoundedLevenshtein(term, w, tolerance) {
    const distance = _boundedLevenshtein(term, w, tolerance);
    return {
        distance,
        isBounded: distance >= 0
    };
}
function levenshtein(a, b) {
    /* c8 ignore next 3 */ if (!a.length) {
        return b.length;
    }
    /* c8 ignore next 3 */ if (!b.length) {
        return a.length;
    }
    const swap = a;
    if (a.length > b.length) {
        a = b;
        b = swap;
    }
    const row = Array.from({
        length: a.length + 1
    }, (_, i)=>i);
    let val = 0;
    for(let i = 1; i <= b.length; i++){
        let prev = i;
        for(let j = 1; j <= a.length; j++){
            if (b[i - 1] === a[j - 1]) {
                val = row[j - 1];
            } else {
                val = Math.min(row[j - 1] + 1, Math.min(prev + 1, row[j] + 1));
            }
            row[j - 1] = prev;
            prev = val;
        }
        row[a.length] = prev;
    }
    return row[a.length];
} //# sourceMappingURL=levenshtein.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/radix.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* eslint-disable @typescript-eslint/no-this-alias */ __turbopack_context__.s([
    "RadixNode",
    ()=>RadixNode,
    "RadixTree",
    ()=>RadixTree
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$levenshtein$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/levenshtein.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
class RadixNode {
    // Node key
    k;
    // Node subword
    s;
    // Node children
    c = new Map();
    // Node documents
    d = new Set();
    // Node end
    e;
    // Node word
    w = '';
    constructor(key, subWord, end){
        this.k = key;
        this.s = subWord;
        this.e = end;
    }
    updateParent(parent) {
        this.w = parent.w + this.s;
    }
    addDocument(docID) {
        this.d.add(docID);
    }
    removeDocument(docID) {
        return this.d.delete(docID);
    }
    findAllWords(output, term, exact, tolerance) {
        const stack = [
            this
        ];
        while(stack.length > 0){
            const node = stack.pop();
            if (node.e) {
                const { w, d: docIDs } = node;
                if (exact && w !== term) {
                    continue;
                }
                // check if _output[w] exists and then add the doc to it
                // always check in own property to prevent access to inherited properties
                // fix https://github.com/oramasearch/orama/issues/137
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getOwnProperty"])(output, w) !== null) {
                    if (tolerance) {
                        const difference = Math.abs(term.length - w.length);
                        if (difference <= tolerance && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$levenshtein$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["syncBoundedLevenshtein"])(term, w, tolerance).isBounded) {
                            output[w] = [];
                        } else {
                            continue;
                        }
                    } else {
                        output[w] = [];
                    }
                }
                // check if _output[w] exists and then add the doc to it
                // always check in own property to prevent access to inherited properties
                // fix https://github.com/oramasearch/orama/issues/137
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getOwnProperty"])(output, w) != null && docIDs.size > 0) {
                    const docs = output[w];
                    for (const docID of docIDs){
                        if (!docs.includes(docID)) {
                            docs.push(docID);
                        }
                    }
                }
            }
            if (node.c.size > 0) {
                stack.push(...node.c.values());
            }
        }
        return output;
    }
    insert(word, docId) {
        let node = this;
        let i = 0;
        const wordLength = word.length;
        while(i < wordLength){
            const currentCharacter = word[i];
            const childNode = node.c.get(currentCharacter);
            if (childNode) {
                const edgeLabel = childNode.s;
                const edgeLabelLength = edgeLabel.length;
                let j = 0;
                // Find the common prefix length between edgeLabel and the remaining word
                while(j < edgeLabelLength && i + j < wordLength && edgeLabel[j] === word[i + j]){
                    j++;
                }
                if (j === edgeLabelLength) {
                    // Edge label fully matches; proceed to the child node
                    node = childNode;
                    i += j;
                    if (i === wordLength) {
                        // The word is a prefix of an existing word
                        if (!childNode.e) {
                            childNode.e = true;
                        }
                        childNode.addDocument(docId);
                        return;
                    }
                    continue;
                }
                // Split the edgeLabel at the common prefix
                const commonPrefix = edgeLabel.slice(0, j);
                const newEdgeLabel = edgeLabel.slice(j);
                const newWordLabel = word.slice(i + j);
                // Create an intermediate node for the common prefix
                const inbetweenNode = new RadixNode(commonPrefix[0], commonPrefix, false);
                node.c.set(commonPrefix[0], inbetweenNode);
                inbetweenNode.updateParent(node);
                // Update the existing childNode
                childNode.s = newEdgeLabel;
                childNode.k = newEdgeLabel[0];
                inbetweenNode.c.set(newEdgeLabel[0], childNode);
                childNode.updateParent(inbetweenNode);
                if (newWordLabel) {
                    // Create a new node for the remaining part of the word
                    const newNode = new RadixNode(newWordLabel[0], newWordLabel, true);
                    newNode.addDocument(docId);
                    inbetweenNode.c.set(newWordLabel[0], newNode);
                    newNode.updateParent(inbetweenNode);
                } else {
                    // The word ends at the inbetweenNode
                    inbetweenNode.e = true;
                    inbetweenNode.addDocument(docId);
                }
                return;
            } else {
                // No matching child; create a new node
                const newNode = new RadixNode(currentCharacter, word.slice(i), true);
                newNode.addDocument(docId);
                node.c.set(currentCharacter, newNode);
                newNode.updateParent(node);
                return;
            }
        }
        // If we reach here, the word already exists in the tree
        if (!node.e) {
            node.e = true;
        }
        node.addDocument(docId);
    }
    _findLevenshtein(term, index, tolerance, originalTolerance, output) {
        const stack = [
            {
                node: this,
                index,
                tolerance
            }
        ];
        while(stack.length > 0){
            const { node, index, tolerance } = stack.pop();
            if (node.w.startsWith(term)) {
                node.findAllWords(output, term, false, 0);
                continue;
            }
            if (tolerance < 0) {
                continue;
            }
            if (node.e) {
                const { w, d: docIDs } = node;
                if (w) {
                    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$levenshtein$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["syncBoundedLevenshtein"])(term, w, originalTolerance).isBounded) {
                        output[w] = [];
                    }
                    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getOwnProperty"])(output, w) !== undefined && docIDs.size > 0) {
                        const docs = new Set(output[w]);
                        for (const docID of docIDs){
                            docs.add(docID);
                        }
                        output[w] = Array.from(docs);
                    }
                }
            }
            if (index >= term.length) {
                continue;
            }
            const currentChar = term[index];
            // 1. If node has child matching term[index], push { node: childNode, index +1, tolerance }
            if (node.c.has(currentChar)) {
                const childNode = node.c.get(currentChar);
                stack.push({
                    node: childNode,
                    index: index + 1,
                    tolerance
                });
            }
            // 2. Push { node, index +1, tolerance -1 } (Delete operation)
            stack.push({
                node: node,
                index: index + 1,
                tolerance: tolerance - 1
            });
            // 3. For each child:
            for (const [character, childNode] of node.c){
                // a) Insert operation
                stack.push({
                    node: childNode,
                    index: index,
                    tolerance: tolerance - 1
                });
                // b) Substitute operation
                if (character !== currentChar) {
                    stack.push({
                        node: childNode,
                        index: index + 1,
                        tolerance: tolerance - 1
                    });
                }
            }
        }
    }
    find(params) {
        const { term, exact, tolerance } = params;
        if (tolerance && !exact) {
            const output = {};
            this._findLevenshtein(term, 0, tolerance, tolerance, output);
            return output;
        } else {
            let node = this;
            let i = 0;
            const termLength = term.length;
            while(i < termLength){
                const character = term[i];
                const childNode = node.c.get(character);
                if (childNode) {
                    const edgeLabel = childNode.s;
                    const edgeLabelLength = edgeLabel.length;
                    let j = 0;
                    // Compare edge label with the term starting from position i
                    while(j < edgeLabelLength && i + j < termLength && edgeLabel[j] === term[i + j]){
                        j++;
                    }
                    if (j === edgeLabelLength) {
                        // Full match of edge label; proceed to the child node
                        node = childNode;
                        i += j;
                    } else if (i + j === termLength) {
                        // The term ends in the middle of the edge label - FIX: this handles prefix matches like 'p' matching 'phone'
                        // Check if the term matches from the beginning of the edge label
                        if (j === termLength - i) {
                            // Term is a prefix of the edge label
                            if (exact) {
                                // Exact match required but term doesn't end at a node
                                return {};
                            } else {
                                // Partial match; collect words starting from this node
                                const output = {};
                                // Just call findAllWords on the child node to collect all words in this subtree
                                childNode.findAllWords(output, term, exact, tolerance);
                                return output;
                            }
                        } else {
                            // Mismatch found
                            return {};
                        }
                    } else {
                        // Mismatch found
                        return {};
                    }
                } else {
                    // No matching child node
                    return {};
                }
            }
            // Term fully matched; collect words starting from this node
            const output = {};
            node.findAllWords(output, term, exact, tolerance);
            return output;
        }
    }
    contains(term) {
        let node = this;
        let i = 0;
        const termLength = term.length;
        while(i < termLength){
            const character = term[i];
            const childNode = node.c.get(character);
            if (childNode) {
                const edgeLabel = childNode.s;
                const edgeLabelLength = edgeLabel.length;
                let j = 0;
                while(j < edgeLabelLength && i + j < termLength && edgeLabel[j] === term[i + j]){
                    j++;
                }
                if (j < edgeLabelLength) {
                    return false;
                }
                i += edgeLabelLength;
                node = childNode;
            } else {
                return false;
            }
        }
        return true;
    }
    removeWord(term) {
        if (!term) {
            return false;
        }
        let node = this;
        const termLength = term.length;
        const stack = [];
        for(let i = 0; i < termLength; i++){
            const character = term[i];
            if (node.c.has(character)) {
                const childNode = node.c.get(character);
                stack.push({
                    parent: node,
                    character
                });
                i += childNode.s.length - 1;
                node = childNode;
            } else {
                return false;
            }
        }
        // Remove documents from the node
        node.d.clear();
        node.e = false;
        // Clean up any nodes that no longer lead to a word
        while(stack.length > 0 && node.c.size === 0 && !node.e && node.d.size === 0){
            const { parent, character } = stack.pop();
            parent.c.delete(character);
            node = parent;
        }
        return true;
    }
    removeDocumentByWord(term, docID, exact = true) {
        if (!term) {
            return true;
        }
        let node = this;
        const termLength = term.length;
        for(let i = 0; i < termLength; i++){
            const character = term[i];
            if (node.c.has(character)) {
                const childNode = node.c.get(character);
                i += childNode.s.length - 1;
                node = childNode;
                if (exact && node.w !== term) {
                // Do nothing if the exact condition is not met.
                } else {
                    node.removeDocument(docID);
                }
            } else {
                return false;
            }
        }
        return true;
    }
    static getCommonPrefix(a, b) {
        const len = Math.min(a.length, b.length);
        let i = 0;
        while(i < len && a.charCodeAt(i) === b.charCodeAt(i)){
            i++;
        }
        return a.slice(0, i);
    }
    toJSON() {
        return {
            w: this.w,
            s: this.s,
            e: this.e,
            k: this.k,
            d: Array.from(this.d),
            c: Array.from(this.c?.entries())?.map(([key, node])=>[
                    key,
                    node.toJSON()
                ])
        };
    }
    static fromJSON(json) {
        const node = new RadixNode(json.k, json.s, json.e);
        node.w = json.w;
        node.d = new Set(json.d);
        node.c = new Map(json?.c?.map(([key, nodeJson])=>[
                key,
                RadixNode.fromJSON(nodeJson)
            ]) || []);
        return node;
    }
}
class RadixTree extends RadixNode {
    constructor(){
        super('', '', false);
    }
    static fromJSON(json) {
        const tree = new RadixTree();
        tree.w = json.w;
        tree.s = json.s;
        tree.e = json.e;
        tree.k = json.k;
        tree.d = new Set(json.d);
        tree.c = new Map(json?.c?.map(([key, nodeJson])=>[
                key,
                RadixNode.fromJSON(nodeJson)
            ]) || []);
        return tree;
    }
    toJSON() {
        return super.toJSON();
    }
} //# sourceMappingURL=radix.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/bkd.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BKDTree",
    ()=>BKDTree
]);
const K = 2; // 2D points
const EARTH_RADIUS = 6371e3; // Earth radius in meters
class BKDNode {
    point;
    docIDs;
    left;
    right;
    parent;
    constructor(point, docIDs){
        this.point = point;
        this.docIDs = new Set(docIDs);
        this.left = null;
        this.right = null;
        this.parent = null;
    }
    toJSON() {
        return {
            point: this.point,
            docIDs: Array.from(this.docIDs),
            left: this.left ? this.left.toJSON() : null,
            right: this.right ? this.right.toJSON() : null
        };
    }
    static fromJSON(json, parent = null) {
        const node = new BKDNode(json.point, json.docIDs);
        node.parent = parent;
        if (json.left) {
            node.left = BKDNode.fromJSON(json.left, node);
        }
        if (json.right) {
            node.right = BKDNode.fromJSON(json.right, node);
        }
        return node;
    }
}
class BKDTree {
    root;
    nodeMap;
    constructor(){
        this.root = null;
        this.nodeMap = new Map();
    }
    getPointKey(point) {
        return `${point.lon},${point.lat}`;
    }
    insert(point, docIDs) {
        const pointKey = this.getPointKey(point);
        const existingNode = this.nodeMap.get(pointKey);
        if (existingNode) {
            docIDs.forEach((id)=>existingNode.docIDs.add(id));
            return;
        }
        const newNode = new BKDNode(point, docIDs);
        this.nodeMap.set(pointKey, newNode);
        if (this.root == null) {
            this.root = newNode;
            return;
        }
        let node = this.root;
        let depth = 0;
        // eslint-disable-next-line no-constant-condition
        while(true){
            const axis = depth % K;
            if (axis === 0) {
                if (point.lon < node.point.lon) {
                    if (node.left == null) {
                        node.left = newNode;
                        newNode.parent = node;
                        return;
                    }
                    node = node.left;
                } else {
                    if (node.right == null) {
                        node.right = newNode;
                        newNode.parent = node;
                        return;
                    }
                    node = node.right;
                }
            } else {
                if (point.lat < node.point.lat) {
                    if (node.left == null) {
                        node.left = newNode;
                        newNode.parent = node;
                        return;
                    }
                    node = node.left;
                } else {
                    if (node.right == null) {
                        node.right = newNode;
                        newNode.parent = node;
                        return;
                    }
                    node = node.right;
                }
            }
            depth++;
        }
    }
    contains(point) {
        const pointKey = this.getPointKey(point);
        return this.nodeMap.has(pointKey);
    }
    getDocIDsByCoordinates(point) {
        const pointKey = this.getPointKey(point);
        const node = this.nodeMap.get(pointKey);
        if (node) {
            return Array.from(node.docIDs);
        }
        return null;
    }
    removeDocByID(point, docID) {
        const pointKey = this.getPointKey(point);
        const node = this.nodeMap.get(pointKey);
        if (node) {
            node.docIDs.delete(docID);
            if (node.docIDs.size === 0) {
                this.nodeMap.delete(pointKey);
                this.deleteNode(node);
            }
        }
    }
    deleteNode(node) {
        const parent = node.parent;
        const child = node.left ? node.left : node.right;
        if (child) {
            child.parent = parent;
        }
        if (parent) {
            if (parent.left === node) {
                parent.left = child;
            } else if (parent.right === node) {
                parent.right = child;
            }
        } else {
            this.root = child;
            if (this.root) {
                this.root.parent = null;
            }
        }
    }
    searchByRadius(center, radius, inclusive = true, sort = 'asc', highPrecision = false) {
        const distanceFn = highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance;
        const stack = [
            {
                node: this.root,
                depth: 0
            }
        ];
        const result = [];
        while(stack.length > 0){
            const { node, depth } = stack.pop();
            if (node == null) continue;
            const dist = distanceFn(center, node.point);
            if (inclusive ? dist <= radius : dist > radius) {
                result.push({
                    point: node.point,
                    docIDs: Array.from(node.docIDs)
                });
            }
            if (node.left != null) {
                stack.push({
                    node: node.left,
                    depth: depth + 1
                });
            }
            if (node.right != null) {
                stack.push({
                    node: node.right,
                    depth: depth + 1
                });
            }
        }
        if (sort) {
            result.sort((a, b)=>{
                const distA = distanceFn(center, a.point);
                const distB = distanceFn(center, b.point);
                return sort.toLowerCase() === 'asc' ? distA - distB : distB - distA;
            });
        }
        return result;
    }
    searchByPolygon(polygon, inclusive = true, sort = null, highPrecision = false) {
        const stack = [
            {
                node: this.root,
                depth: 0
            }
        ];
        const result = [];
        while(stack.length > 0){
            const { node, depth } = stack.pop();
            if (node == null) continue;
            if (node.left != null) {
                stack.push({
                    node: node.left,
                    depth: depth + 1
                });
            }
            if (node.right != null) {
                stack.push({
                    node: node.right,
                    depth: depth + 1
                });
            }
            const isInsidePolygon = BKDTree.isPointInPolygon(polygon, node.point);
            if (isInsidePolygon && inclusive || !isInsidePolygon && !inclusive) {
                result.push({
                    point: node.point,
                    docIDs: Array.from(node.docIDs)
                });
            }
        }
        const centroid = BKDTree.calculatePolygonCentroid(polygon);
        if (sort) {
            const distanceFn = highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance;
            result.sort((a, b)=>{
                const distA = distanceFn(centroid, a.point);
                const distB = distanceFn(centroid, b.point);
                return sort.toLowerCase() === 'asc' ? distA - distB : distB - distA;
            });
        }
        return result;
    }
    toJSON() {
        return {
            root: this.root ? this.root.toJSON() : null
        };
    }
    static fromJSON(json) {
        const tree = new BKDTree();
        if (json.root) {
            tree.root = BKDNode.fromJSON(json.root);
            tree.buildNodeMap(tree.root);
        }
        return tree;
    }
    buildNodeMap(node) {
        if (node == null) return;
        const pointKey = this.getPointKey(node.point);
        this.nodeMap.set(pointKey, node);
        if (node.left) {
            this.buildNodeMap(node.left);
        }
        if (node.right) {
            this.buildNodeMap(node.right);
        }
    }
    static calculatePolygonCentroid(polygon) {
        let totalArea = 0;
        let centroidX = 0;
        let centroidY = 0;
        const polygonLength = polygon.length;
        for(let i = 0, j = polygonLength - 1; i < polygonLength; j = i++){
            const xi = polygon[i].lon;
            const yi = polygon[i].lat;
            const xj = polygon[j].lon;
            const yj = polygon[j].lat;
            const areaSegment = xi * yj - xj * yi;
            totalArea += areaSegment;
            centroidX += (xi + xj) * areaSegment;
            centroidY += (yi + yj) * areaSegment;
        }
        totalArea /= 2;
        const centroidCoordinate = 6 * totalArea;
        centroidX /= centroidCoordinate;
        centroidY /= centroidCoordinate;
        return {
            lon: centroidX,
            lat: centroidY
        };
    }
    static isPointInPolygon(polygon, point) {
        let isInside = false;
        const x = point.lon;
        const y = point.lat;
        const polygonLength = polygon.length;
        for(let i = 0, j = polygonLength - 1; i < polygonLength; j = i++){
            const xi = polygon[i].lon;
            const yi = polygon[i].lat;
            const xj = polygon[j].lon;
            const yj = polygon[j].lat;
            const intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
            if (intersect) isInside = !isInside;
        }
        return isInside;
    }
    static haversineDistance(coord1, coord2) {
        const P = Math.PI / 180;
        const lat1 = coord1.lat * P;
        const lat2 = coord2.lat * P;
        const deltaLat = (coord2.lat - coord1.lat) * P;
        const deltaLon = (coord2.lon - coord1.lon) * P;
        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS * c;
    }
    static vincentyDistance(coord1, coord2) {
        const a = 6378137;
        const f = 1 / 298.257223563;
        const b = (1 - f) * a;
        const P = Math.PI / 180;
        const lat1 = coord1.lat * P;
        const lat2 = coord2.lat * P;
        const deltaLon = (coord2.lon - coord1.lon) * P;
        const U1 = Math.atan((1 - f) * Math.tan(lat1));
        const U2 = Math.atan((1 - f) * Math.tan(lat2));
        const sinU1 = Math.sin(U1);
        const cosU1 = Math.cos(U1);
        const sinU2 = Math.sin(U2);
        const cosU2 = Math.cos(U2);
        let lambda = deltaLon;
        let prevLambda;
        let iterationLimit = 1000;
        let sinSigma;
        let cosSigma;
        let sigma;
        let sinAlpha;
        let cos2Alpha;
        let cos2SigmaM;
        do {
            const sinLambda = Math.sin(lambda);
            const cosLambda = Math.cos(lambda);
            sinSigma = Math.sqrt(cosU2 * sinLambda * (cosU2 * sinLambda) + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
            if (sinSigma === 0) return 0; // co-incident points
            cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
            sigma = Math.atan2(sinSigma, cosSigma);
            sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
            cos2Alpha = 1 - sinAlpha * sinAlpha;
            cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cos2Alpha;
            if (isNaN(cos2SigmaM)) cos2SigmaM = 0;
            const C = f / 16 * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
            prevLambda = lambda;
            lambda = deltaLon + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
        }while (Math.abs(lambda - prevLambda) > 1e-12 && --iterationLimit > 0)
        if (iterationLimit === 0) {
            return NaN;
        }
        const uSquared = cos2Alpha * (a * a - b * b) / (b * b);
        const A = 1 + uSquared / 16384 * (4096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)));
        const B = uSquared / 1024 * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)));
        const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
        const s = b * A * (sigma - deltaSigma);
        return s;
    }
} //# sourceMappingURL=bkd.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/bool.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BoolNode",
    ()=>BoolNode
]);
class BoolNode {
    true;
    false;
    constructor(){
        this.true = new Set();
        this.false = new Set();
    }
    insert(value, bool) {
        if (bool) {
            this.true.add(value);
        } else {
            this.false.add(value);
        }
    }
    delete(value, bool) {
        if (bool) {
            this.true.delete(value);
        } else {
            this.false.delete(value);
        }
    }
    getSize() {
        return this.true.size + this.false.size;
    }
    toJSON() {
        return {
            true: Array.from(this.true),
            false: Array.from(this.false)
        };
    }
    static fromJSON(json) {
        const node = new BoolNode();
        node.true = new Set(json.true);
        node.false = new Set(json.false);
        return node;
    }
} //# sourceMappingURL=bool.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/algorithms.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BM25",
    ()=>BM25,
    "prioritizeTokenScores",
    ()=>prioritizeTokenScores
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
;
function prioritizeTokenScores(arrays, boost, threshold = 0, keywordsCount) {
    if (boost === 0) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_BOOST_VALUE');
    }
    const tokenScoresMap = new Map();
    const mapsLength = arrays.length;
    for(let i = 0; i < mapsLength; i++){
        const arr = arrays[i];
        const entriesLength = arr.length;
        for(let j = 0; j < entriesLength; j++){
            const [token, score] = arr[j];
            const boostScore = score * boost;
            const oldScore = tokenScoresMap.get(token)?.[0];
            if (oldScore !== undefined) {
                tokenScoresMap.set(token, [
                    oldScore * 1.5 + boostScore,
                    (tokenScoresMap?.get(token)?.[1] || 0) + 1
                ]);
            } else {
                tokenScoresMap.set(token, [
                    boostScore,
                    1
                ]);
            }
        }
    }
    const tokenScores = [];
    for (const tokenScoreEntry of tokenScoresMap.entries()){
        tokenScores.push([
            tokenScoreEntry[0],
            tokenScoreEntry[1][0]
        ]);
    }
    const results = tokenScores.sort((a, b)=>b[1] - a[1]);
    // If threshold is 1, it means we will return all the results with at least one search term,
    // prioritizing the ones that contains more search terms (fuzzy match)
    if (threshold === 1) {
        return results;
    }
    // For threshold = 0 when keywordsCount is 1 (single term search),
    // we return all matches since they automatically contain 100% of keywords
    if (threshold === 0 && keywordsCount === 1) {
        return results;
    }
    // Prepare keywords count tracking for threshold handling
    const allResults = results.length;
    const tokenScoreWithKeywordsCount = [];
    for (const tokenScoreEntry of tokenScoresMap.entries()){
        tokenScoreWithKeywordsCount.push([
            tokenScoreEntry[0],
            tokenScoreEntry[1][0],
            tokenScoreEntry[1][1]
        ]);
    }
    // Find the index of the last result with all keywords.
    // Order the documents by the number of keywords they contain, and then by the score.
    const keywordsPerToken = tokenScoreWithKeywordsCount.sort((a, b)=>{
        // Compare by the third element, higher numbers first
        if (a[2] > b[2]) return -1;
        if (a[2] < b[2]) return 1;
        // If the third elements are equal, compare by the second element, higher numbers first
        if (a[1] > b[1]) return -1;
        if (a[1] < b[1]) return 1;
        // If both the second and third elements are equal, consider the elements equal
        return 0;
    });
    let lastTokenWithAllKeywords = undefined;
    for(let i = 0; i < allResults; i++){
        if (keywordsPerToken[i][2] === keywordsCount) {
            lastTokenWithAllKeywords = i;
        } else {
            break;
        }
    }
    // If no results had all the keywords, either bail out earlier or normalize
    if (typeof lastTokenWithAllKeywords === 'undefined') {
        if (threshold === 0) {
            return [];
        }
        lastTokenWithAllKeywords = 0;
    }
    const keywordsPerTokenLength = keywordsPerToken.length;
    const resultsWithIdAndScore = new Array(keywordsPerTokenLength);
    for(let i = 0; i < keywordsPerTokenLength; i++){
        resultsWithIdAndScore[i] = [
            keywordsPerToken[i][0],
            keywordsPerToken[i][1]
        ];
    }
    // If threshold is 0, it means we will only return all the results that contains ALL the search terms (exact match)
    if (threshold === 0) {
        return resultsWithIdAndScore.slice(0, lastTokenWithAllKeywords + 1);
    }
    // If the threshold is between 0 and 1, we will return all the results that contains at least the threshold of search terms
    // For example, if threshold is 0.5, we will return all the results that contains at least 50% of the search terms
    // (fuzzy match with a minimum threshold)
    const thresholdLength = lastTokenWithAllKeywords + Math.ceil(threshold * 100 * (allResults - lastTokenWithAllKeywords) / 100);
    return resultsWithIdAndScore.slice(0, Math.min(allResults, thresholdLength));
}
function BM25(tf, matchingCount, docsCount, fieldLength, averageFieldLength, { k, b, d }) {
    const idf = Math.log(1 + (docsCount - matchingCount + 0.5) / (matchingCount + 0.5));
    return idf * (d + tf * (k + 1)) / (tf + k * (1 - b + b * fieldLength / averageFieldLength));
} //# sourceMappingURL=algorithms.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/trees/vector.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_SIMILARITY",
    ()=>DEFAULT_SIMILARITY,
    "VectorIndex",
    ()=>VectorIndex,
    "findSimilarVectors",
    ()=>findSimilarVectors,
    "getMagnitude",
    ()=>getMagnitude
]);
const DEFAULT_SIMILARITY = 0.8;
class VectorIndex {
    size;
    vectors = new Map();
    constructor(size){
        this.size = size;
    }
    add(internalDocumentId, value) {
        if (!(value instanceof Float32Array)) {
            value = new Float32Array(value);
        }
        const magnitude = getMagnitude(value, this.size);
        this.vectors.set(internalDocumentId, [
            magnitude,
            value
        ]);
    }
    remove(internalDocumentId) {
        this.vectors.delete(internalDocumentId);
    }
    find(vector, similarity, whereFiltersIDs) {
        if (!(vector instanceof Float32Array)) {
            vector = new Float32Array(vector);
        }
        const results = findSimilarVectors(vector, whereFiltersIDs, this.vectors, this.size, similarity);
        return results;
    }
    toJSON() {
        const vectors = [];
        for (const [id, [magnitude, vector]] of this.vectors){
            vectors.push([
                id,
                [
                    magnitude,
                    Array.from(vector)
                ]
            ]);
        }
        return {
            size: this.size,
            vectors
        };
    }
    static fromJSON(json) {
        const raw = json;
        const index = new VectorIndex(raw.size);
        for (const [id, [magnitude, vector]] of raw.vectors){
            index.vectors.set(id, [
                magnitude,
                new Float32Array(vector)
            ]);
        }
        return index;
    }
}
function getMagnitude(vector, vectorLength) {
    let magnitude = 0;
    for(let i = 0; i < vectorLength; i++){
        magnitude += vector[i] * vector[i];
    }
    return Math.sqrt(magnitude);
}
function findSimilarVectors(targetVector, keys, vectors, length, threshold) {
    const targetMagnitude = getMagnitude(targetVector, length);
    const similarVectors = [];
    const base = keys ? keys : vectors.keys();
    for (const vectorId of base){
        const entry = vectors.get(vectorId);
        if (!entry) {
            continue;
        }
        const magnitude = entry[0];
        const vector = entry[1];
        let dotProduct = 0;
        for(let i = 0; i < length; i++){
            dotProduct += targetVector[i] * vector[i];
        }
        const similarity = dotProduct / (targetMagnitude * magnitude);
        if (similarity >= threshold) {
            similarVectors.push([
                vectorId,
                similarity
            ]);
        }
    }
    return similarVectors;
} //# sourceMappingURL=vector.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/index.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calculateResultScores",
    ()=>calculateResultScores,
    "create",
    ()=>create,
    "createIndex",
    ()=>createIndex,
    "getSearchableProperties",
    ()=>getSearchableProperties,
    "getSearchablePropertiesWithTypes",
    ()=>getSearchablePropertiesWithTypes,
    "insert",
    ()=>insert,
    "insertDocumentScoreParameters",
    ()=>insertDocumentScoreParameters,
    "insertTokenScoreParameters",
    ()=>insertTokenScoreParameters,
    "insertVector",
    ()=>insertVector,
    "load",
    ()=>load,
    "remove",
    ()=>remove,
    "removeDocumentScoreParameters",
    ()=>removeDocumentScoreParameters,
    "removeTokenScoreParameters",
    ()=>removeTokenScoreParameters,
    "save",
    ()=>save,
    "search",
    ()=>search,
    "searchByGeoWhereClause",
    ()=>searchByGeoWhereClause,
    "searchByWhereClause",
    ()=>searchByWhereClause
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$avl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/avl.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$flat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/flat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$radix$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/radix.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/bkd.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bool$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/bool.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$algorithms$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/algorithms.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/vector.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
function insertDocumentScoreParameters(index, prop, id, tokens, docsCount) {
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(index.sharedInternalDocumentStore, id);
    index.avgFieldLength[prop] = ((index.avgFieldLength[prop] ?? 0) * (docsCount - 1) + tokens.length) / docsCount;
    index.fieldLengths[prop][internalId] = tokens.length;
    index.frequencies[prop][internalId] = {};
}
function insertTokenScoreParameters(index, prop, id, tokens, token) {
    let tokenFrequency = 0;
    for (const t of tokens){
        if (t === token) {
            tokenFrequency++;
        }
    }
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(index.sharedInternalDocumentStore, id);
    const tf = tokenFrequency / tokens.length;
    index.frequencies[prop][internalId][token] = tf;
    if (!(token in index.tokenOccurrences[prop])) {
        index.tokenOccurrences[prop][token] = 0;
    }
    // increase a token counter that may not yet exist
    index.tokenOccurrences[prop][token] = (index.tokenOccurrences[prop][token] ?? 0) + 1;
}
function removeDocumentScoreParameters(index, prop, id, docsCount) {
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(index.sharedInternalDocumentStore, id);
    if (docsCount > 1) {
        index.avgFieldLength[prop] = (index.avgFieldLength[prop] * docsCount - index.fieldLengths[prop][internalId]) / (docsCount - 1);
    } else {
        index.avgFieldLength[prop] = undefined;
    }
    index.fieldLengths[prop][internalId] = undefined;
    index.frequencies[prop][internalId] = undefined;
}
function removeTokenScoreParameters(index, prop, token) {
    index.tokenOccurrences[prop][token]--;
}
function create(orama, sharedInternalDocumentStore, schema, index, prefix = '') {
    if (!index) {
        index = {
            sharedInternalDocumentStore,
            indexes: {},
            vectorIndexes: {},
            searchableProperties: [],
            searchablePropertiesWithTypes: {},
            frequencies: {},
            tokenOccurrences: {},
            avgFieldLength: {},
            fieldLengths: {}
        };
    }
    for (const [prop, type] of Object.entries(schema)){
        const path = `${prefix}${prefix ? '.' : ''}${prop}`;
        if (typeof type === 'object' && !Array.isArray(type)) {
            // Nested
            create(orama, sharedInternalDocumentStore, type, index, path);
            continue;
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isVectorType"])(type)) {
            index.searchableProperties.push(path);
            index.searchablePropertiesWithTypes[path] = type;
            index.vectorIndexes[path] = {
                type: 'Vector',
                node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["VectorIndex"]((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getVectorSize"])(type)),
                isArray: false
            };
        } else {
            const isArray = /\[/.test(type);
            switch(type){
                case 'boolean':
                case 'boolean[]':
                    index.indexes[path] = {
                        type: 'Bool',
                        node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bool$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BoolNode"](),
                        isArray
                    };
                    break;
                case 'number':
                case 'number[]':
                    index.indexes[path] = {
                        type: 'AVL',
                        node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$avl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AVLTree"](0, []),
                        isArray
                    };
                    break;
                case 'string':
                case 'string[]':
                    index.indexes[path] = {
                        type: 'Radix',
                        node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$radix$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RadixTree"](),
                        isArray
                    };
                    index.avgFieldLength[path] = 0;
                    index.frequencies[path] = {};
                    index.tokenOccurrences[path] = {};
                    index.fieldLengths[path] = {};
                    break;
                case 'enum':
                case 'enum[]':
                    index.indexes[path] = {
                        type: 'Flat',
                        node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$flat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FlatTree"](),
                        isArray
                    };
                    break;
                case 'geopoint':
                    index.indexes[path] = {
                        type: 'BKD',
                        node: new __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BKDTree"](),
                        isArray
                    };
                    break;
                default:
                    throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_SCHEMA_TYPE', Array.isArray(type) ? 'array' : type, path);
            }
            index.searchableProperties.push(path);
            index.searchablePropertiesWithTypes[path] = type;
        }
    }
    return index;
}
function insertScalarBuilder(implementation, index, prop, internalId, language, tokenizer, docsCount, options) {
    return (value)=>{
        const { type, node } = index.indexes[prop];
        switch(type){
            case 'Bool':
                {
                    node[value ? 'true' : 'false'].add(internalId);
                    break;
                }
            case 'AVL':
                {
                    const avlRebalanceThreshold = options?.avlRebalanceThreshold ?? 1;
                    node.insert(value, internalId, avlRebalanceThreshold);
                    break;
                }
            case 'Radix':
                {
                    const tokens = tokenizer.tokenize(value, language, prop, false);
                    implementation.insertDocumentScoreParameters(index, prop, internalId, tokens, docsCount);
                    for (const token of tokens){
                        implementation.insertTokenScoreParameters(index, prop, internalId, tokens, token);
                        node.insert(token, internalId);
                    }
                    break;
                }
            case 'Flat':
                {
                    node.insert(value, internalId);
                    break;
                }
            case 'BKD':
                {
                    node.insert(value, [
                        internalId
                    ]);
                    break;
                }
        }
    };
}
function insert(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount, options) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isVectorType"])(schemaType)) {
        return insertVector(index, prop, value, id, internalId);
    }
    const insertScalar = insertScalarBuilder(implementation, index, prop, internalId, language, tokenizer, docsCount, options);
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isArrayType"])(schemaType)) {
        return insertScalar(value);
    }
    const elements = value;
    const elementsLength = elements.length;
    for(let i = 0; i < elementsLength; i++){
        insertScalar(elements[i]);
    }
}
function insertVector(index, prop, value, id, internalDocumentId) {
    index.vectorIndexes[prop].node.add(internalDocumentId, value);
}
function removeScalar(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isVectorType"])(schemaType)) {
        index.vectorIndexes[prop].node.remove(internalId);
        return true;
    }
    const { type, node } = index.indexes[prop];
    switch(type){
        case 'AVL':
            {
                node.removeDocument(value, internalId);
                return true;
            }
        case 'Bool':
            {
                node[value ? 'true' : 'false'].delete(internalId);
                return true;
            }
        case 'Radix':
            {
                const tokens = tokenizer.tokenize(value, language, prop);
                implementation.removeDocumentScoreParameters(index, prop, id, docsCount);
                for (const token of tokens){
                    implementation.removeTokenScoreParameters(index, prop, token);
                    node.removeDocumentByWord(token, internalId);
                }
                return true;
            }
        case 'Flat':
            {
                node.removeDocument(internalId, value);
                return true;
            }
        case 'BKD':
            {
                node.removeDocByID(value, internalId);
                return false;
            }
    }
}
function remove(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isArrayType"])(schemaType)) {
        return removeScalar(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount);
    }
    const innerSchemaType = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getInnerType"])(schemaType);
    const elements = value;
    const elementsLength = elements.length;
    for(let i = 0; i < elementsLength; i++){
        removeScalar(implementation, index, prop, id, internalId, elements[i], innerSchemaType, language, tokenizer, docsCount);
    }
    return true;
}
function calculateResultScores(index, prop, term, ids, docsCount, bm25Relevance, resultsMap, boostPerProperty, whereFiltersIDs, keywordMatchesMap) {
    const documentIDs = Array.from(ids);
    const avgFieldLength = index.avgFieldLength[prop];
    const fieldLengths = index.fieldLengths[prop];
    const oramaOccurrences = index.tokenOccurrences[prop];
    const oramaFrequencies = index.frequencies[prop];
    // oramaOccurrences[term] can be undefined, 0, string, or { [k: string]: number }
    const termOccurrences = typeof oramaOccurrences[term] === 'number' ? oramaOccurrences[term] ?? 0 : 0;
    // Calculate TF-IDF value for each term, in each document, for each index.
    const documentIDsLength = documentIDs.length;
    for(let k = 0; k < documentIDsLength; k++){
        const internalId = documentIDs[k];
        if (whereFiltersIDs && !whereFiltersIDs.has(internalId)) {
            continue;
        }
        // Track keyword matches per property
        if (!keywordMatchesMap.has(internalId)) {
            keywordMatchesMap.set(internalId, new Map());
        }
        const propertyMatches = keywordMatchesMap.get(internalId);
        propertyMatches.set(prop, (propertyMatches.get(prop) || 0) + 1);
        const tf = oramaFrequencies?.[internalId]?.[term] ?? 0;
        const bm25 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$algorithms$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BM25"])(tf, termOccurrences, docsCount, fieldLengths[internalId], avgFieldLength, bm25Relevance);
        if (resultsMap.has(internalId)) {
            resultsMap.set(internalId, resultsMap.get(internalId) + bm25 * boostPerProperty);
        } else {
            resultsMap.set(internalId, bm25 * boostPerProperty);
        }
    }
}
function search(index, term, tokenizer, language, propertiesToSearch, exact, tolerance, boost, relevance, docsCount, whereFiltersIDs, threshold = 0) {
    const tokens = tokenizer.tokenize(term, language);
    const keywordsCount = tokens.length || 1;
    // Track keyword matches per document and property
    const keywordMatchesMap = new Map();
    // Track which tokens were found in the search
    const tokenFoundMap = new Map();
    const resultsMap = new Map();
    for (const prop of propertiesToSearch){
        if (!(prop in index.indexes)) {
            continue;
        }
        const tree = index.indexes[prop];
        const { type } = tree;
        if (type !== 'Radix') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('WRONG_SEARCH_PROPERTY_TYPE', prop);
        }
        const boostPerProperty = boost[prop] ?? 1;
        if (boostPerProperty <= 0) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_BOOST_VALUE', boostPerProperty);
        }
        // if the tokenizer returns an empty array, we returns all the documents
        if (tokens.length === 0 && !term) {
            tokens.push('');
        }
        // Process each token in the search term
        const tokenLength = tokens.length;
        for(let i = 0; i < tokenLength; i++){
            const token = tokens[i];
            const searchResult = tree.node.find({
                term: token,
                exact,
                tolerance
            });
            // See if this token was found (for threshold=0 filtering)
            const termsFound = Object.keys(searchResult);
            if (termsFound.length > 0) {
                tokenFoundMap.set(token, true);
            }
            // Process each matching term
            const termsFoundLength = termsFound.length;
            for(let j = 0; j < termsFoundLength; j++){
                const word = termsFound[j];
                const ids = searchResult[word];
                calculateResultScores(index, prop, word, ids, docsCount, relevance, resultsMap, boostPerProperty, whereFiltersIDs, keywordMatchesMap);
            }
        }
    }
    // Convert to array and sort by score
    const results = Array.from(resultsMap.entries()).map(([id, score])=>[
            id,
            score
        ]).sort((a, b)=>b[1] - a[1]);
    if (results.length === 0) {
        return [];
    }
    // If threshold is 1, return all results
    if (threshold === 1) {
        return results;
    }
    // For threshold=0, check if all tokens were found
    if (threshold === 0) {
        // Quick return for single tokens - already validated
        if (keywordsCount === 1) {
            return results;
        }
        // For multiple tokens, verify that ALL tokens were found
        // If any token wasn't found, return an empty result
        for (const token of tokens){
            if (!tokenFoundMap.get(token)) {
                return [];
            }
        }
        // Find documents that have all keywords in at least one property
        const fullMatches = results.filter(([id])=>{
            const propertyMatches = keywordMatchesMap.get(id);
            if (!propertyMatches) return false;
            // Check if any property has all keywords
            return Array.from(propertyMatches.values()).some((matches)=>matches === keywordsCount);
        });
        return fullMatches;
    }
    // Find documents that have all keywords in at least one property
    const fullMatches = results.filter(([id])=>{
        const propertyMatches = keywordMatchesMap.get(id);
        if (!propertyMatches) return false;
        // Check if any property has all keywords
        return Array.from(propertyMatches.values()).some((matches)=>matches === keywordsCount);
    });
    // If we have full matches and threshold < 1, return full matches plus a percentage of partial matches
    if (fullMatches.length > 0) {
        const remainingResults = results.filter(([id])=>!fullMatches.some(([fid])=>fid === id));
        const additionalResults = Math.ceil(remainingResults.length * threshold);
        return [
            ...fullMatches,
            ...remainingResults.slice(0, additionalResults)
        ];
    }
    // If no full matches, return all results
    return results;
}
function searchByWhereClause(index, tokenizer, filters, language) {
    // Handle logical operators
    if ('and' in filters && filters.and && Array.isArray(filters.and)) {
        const andFilters = filters.and;
        if (andFilters.length === 0) {
            return new Set();
        }
        const results = andFilters.map((filter)=>searchByWhereClause(index, tokenizer, filter, language));
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setIntersection"])(...results);
    }
    if ('or' in filters && filters.or && Array.isArray(filters.or)) {
        const orFilters = filters.or;
        if (orFilters.length === 0) {
            return new Set();
        }
        const results = orFilters.map((filter)=>searchByWhereClause(index, tokenizer, filter, language));
        // Use reduce to union all sets
        return results.reduce((acc, set)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setUnion"])(acc, set), new Set());
    }
    if ('not' in filters && filters.not) {
        const notFilter = filters.not;
        // Get all document IDs from the internal document store
        const allDocs = new Set();
        // Get all document IDs from the internal document store
        const docsStore = index.sharedInternalDocumentStore;
        for(let i = 1; i <= docsStore.internalIdToId.length; i++){
            allDocs.add(i);
        }
        const notResult = searchByWhereClause(index, tokenizer, notFilter, language);
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setDifference"])(allDocs, notResult);
    }
    // Handle regular property filters (existing logic)
    const filterKeys = Object.keys(filters);
    const filtersMap = filterKeys.reduce((acc, key)=>({
            [key]: new Set(),
            ...acc
        }), {});
    for (const param of filterKeys){
        const operation = filters[param];
        if (typeof index.indexes[param] === 'undefined') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNKNOWN_FILTER_PROPERTY', param);
        }
        const { node, type, isArray } = index.indexes[param];
        if (type === 'Bool') {
            const idx = node;
            const filteredIDs = operation ? idx.true : idx.false;
            filtersMap[param] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setUnion"])(filtersMap[param], filteredIDs);
            continue;
        }
        if (type === 'BKD') {
            let reqOperation;
            if ('radius' in operation) {
                reqOperation = 'radius';
            } else if ('polygon' in operation) {
                reqOperation = 'polygon';
            } else {
                throw new Error(`Invalid operation ${operation}`);
            }
            if (reqOperation === 'radius') {
                const { value, coordinates, unit = 'm', inside = true, highPrecision = false } = operation[reqOperation];
                const distanceInMeters = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["convertDistanceToMeters"])(value, unit);
                const ids = node.searchByRadius(coordinates, distanceInMeters, inside, undefined, highPrecision);
                filtersMap[param] = addGeoResult(filtersMap[param], ids);
            } else {
                const { coordinates, inside = true, highPrecision = false } = operation[reqOperation];
                const ids = node.searchByPolygon(coordinates, inside, undefined, highPrecision);
                filtersMap[param] = addGeoResult(filtersMap[param], ids);
            }
            continue;
        }
        if (type === 'Radix' && (typeof operation === 'string' || Array.isArray(operation))) {
            for (const raw of [
                operation
            ].flat()){
                const term = tokenizer.tokenize(raw, language, param);
                for (const t of term){
                    const filteredIDsResults = node.find({
                        term: t,
                        exact: true
                    });
                    filtersMap[param] = addFindResult(filtersMap[param], filteredIDsResults);
                }
            }
            continue;
        }
        const operationKeys = Object.keys(operation);
        if (operationKeys.length > 1) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_FILTER_OPERATION', operationKeys.length);
        }
        if (type === 'Flat') {
            const results = new Set(isArray ? node.filterArr(operation) : node.filter(operation));
            filtersMap[param] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setUnion"])(filtersMap[param], results);
            continue;
        }
        if (type === 'AVL') {
            const operationOpt = operationKeys[0];
            const operationValue = operation[operationOpt];
            let filteredIDs;
            switch(operationOpt){
                case 'gt':
                    {
                        filteredIDs = node.greaterThan(operationValue, false);
                        break;
                    }
                case 'gte':
                    {
                        filteredIDs = node.greaterThan(operationValue, true);
                        break;
                    }
                case 'lt':
                    {
                        filteredIDs = node.lessThan(operationValue, false);
                        break;
                    }
                case 'lte':
                    {
                        filteredIDs = node.lessThan(operationValue, true);
                        break;
                    }
                case 'eq':
                    {
                        const ret = node.find(operationValue);
                        filteredIDs = ret ?? new Set();
                        break;
                    }
                case 'between':
                    {
                        const [min, max] = operationValue;
                        filteredIDs = node.rangeSearch(min, max);
                        break;
                    }
                default:
                    throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_FILTER_OPERATION', operationOpt);
            }
            filtersMap[param] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setUnion"])(filtersMap[param], filteredIDs);
        }
    }
    // AND operation: calculate the intersection between all the IDs in filterMap
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setIntersection"])(...Object.values(filtersMap));
}
function getSearchableProperties(index) {
    return index.searchableProperties;
}
function getSearchablePropertiesWithTypes(index) {
    return index.searchablePropertiesWithTypes;
}
function load(sharedInternalDocumentStore, raw) {
    const { indexes: rawIndexes, vectorIndexes: rawVectorIndexes, searchableProperties, searchablePropertiesWithTypes, frequencies, tokenOccurrences, avgFieldLength, fieldLengths } = raw;
    const indexes = {};
    const vectorIndexes = {};
    for (const prop of Object.keys(rawIndexes)){
        const { node, type, isArray } = rawIndexes[prop];
        switch(type){
            case 'Radix':
                indexes[prop] = {
                    type: 'Radix',
                    node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$radix$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RadixTree"].fromJSON(node),
                    isArray
                };
                break;
            case 'Flat':
                indexes[prop] = {
                    type: 'Flat',
                    node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$flat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FlatTree"].fromJSON(node),
                    isArray
                };
                break;
            case 'AVL':
                indexes[prop] = {
                    type: 'AVL',
                    node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$avl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AVLTree"].fromJSON(node),
                    isArray
                };
                break;
            case 'BKD':
                indexes[prop] = {
                    type: 'BKD',
                    node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BKDTree"].fromJSON(node),
                    isArray
                };
                break;
            case 'Bool':
                indexes[prop] = {
                    type: 'Bool',
                    node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bool$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BoolNode"].fromJSON(node),
                    isArray
                };
                break;
            default:
                indexes[prop] = rawIndexes[prop];
        }
    }
    for (const idx of Object.keys(rawVectorIndexes)){
        vectorIndexes[idx] = {
            type: 'Vector',
            isArray: false,
            node: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["VectorIndex"].fromJSON(rawVectorIndexes[idx])
        };
    }
    return {
        sharedInternalDocumentStore,
        indexes,
        vectorIndexes,
        searchableProperties,
        searchablePropertiesWithTypes,
        frequencies,
        tokenOccurrences,
        avgFieldLength,
        fieldLengths
    };
}
function save(index) {
    const { indexes, vectorIndexes, searchableProperties, searchablePropertiesWithTypes, frequencies, tokenOccurrences, avgFieldLength, fieldLengths } = index;
    const dumpVectorIndexes = {};
    for (const idx of Object.keys(vectorIndexes)){
        dumpVectorIndexes[idx] = vectorIndexes[idx].node.toJSON();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedIndexes = {};
    for (const name of Object.keys(indexes)){
        const { type, node, isArray } = indexes[name];
        if (type === 'Flat' || type === 'Radix' || type === 'AVL' || type === 'BKD' || type === 'Bool') {
            savedIndexes[name] = {
                type,
                node: node.toJSON(),
                isArray
            };
        } else {
            savedIndexes[name] = indexes[name];
            savedIndexes[name].node = savedIndexes[name].node.toJSON();
        }
    }
    return {
        indexes: savedIndexes,
        vectorIndexes: dumpVectorIndexes,
        searchableProperties,
        searchablePropertiesWithTypes,
        frequencies,
        tokenOccurrences,
        avgFieldLength,
        fieldLengths
    };
}
function createIndex() {
    return {
        create,
        insert,
        remove,
        insertDocumentScoreParameters,
        insertTokenScoreParameters,
        removeDocumentScoreParameters,
        removeTokenScoreParameters,
        calculateResultScores,
        search,
        searchByWhereClause,
        getSearchableProperties,
        getSearchablePropertiesWithTypes,
        load,
        save
    };
}
function addGeoResult(set, ids) {
    if (!set) {
        set = new Set();
    }
    const idsLength = ids.length;
    for(let i = 0; i < idsLength; i++){
        const entry = ids[i].docIDs;
        const idsLength = entry.length;
        for(let j = 0; j < idsLength; j++){
            set.add(entry[j]);
        }
    }
    return set;
}
function createGeoTokenScores(ids, centerPoint, highPrecision = false) {
    const distanceFn = highPrecision ? __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BKDTree"].vincentyDistance : __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BKDTree"].haversineDistance;
    const results = [];
    // Calculate distances for all results to find the maximum
    const distances = [];
    for (const { point } of ids){
        distances.push(distanceFn(centerPoint, point));
    }
    const maxDistance = Math.max(...distances);
    // Create results with inverse distance scores (higher score = closer)
    let index = 0;
    for (const { docIDs } of ids){
        const distance = distances[index];
        // Use inverse score: closer points get higher scores
        // Add 1 to avoid division by zero for points at exact center
        const score = maxDistance - distance + 1;
        for (const docID of docIDs){
            results.push([
                docID,
                score
            ]);
        }
        index++;
    }
    // Sort by score (higher first - closer points)
    results.sort((a, b)=>b[1] - a[1]);
    return results;
}
function isGeosearchOnlyQuery(filters, index) {
    const filterKeys = Object.keys(filters);
    if (filterKeys.length !== 1) {
        return {
            isGeoOnly: false
        };
    }
    const param = filterKeys[0];
    const operation = filters[param];
    if (typeof index.indexes[param] === 'undefined') {
        return {
            isGeoOnly: false
        };
    }
    const { type } = index.indexes[param];
    if (type === 'BKD' && operation && ('radius' in operation || 'polygon' in operation)) {
        return {
            isGeoOnly: true,
            geoProperty: param,
            geoOperation: operation
        };
    }
    return {
        isGeoOnly: false
    };
}
function searchByGeoWhereClause(index, filters) {
    const indexTyped = index;
    const geoInfo = isGeosearchOnlyQuery(filters, indexTyped);
    if (!geoInfo.isGeoOnly || !geoInfo.geoProperty || !geoInfo.geoOperation) {
        return null;
    }
    const { node } = indexTyped.indexes[geoInfo.geoProperty];
    const operation = geoInfo.geoOperation;
    // Cast node to BKDTree since we already verified it's type 'BKD'
    const bkdNode = node;
    let results;
    if ('radius' in operation) {
        const { value, coordinates, unit = 'm', inside = true, highPrecision = false } = operation.radius;
        const centerPoint = coordinates;
        const distanceInMeters = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["convertDistanceToMeters"])(value, unit);
        results = bkdNode.searchByRadius(centerPoint, distanceInMeters, inside, 'asc', highPrecision);
        return createGeoTokenScores(results, centerPoint, highPrecision);
    } else if ('polygon' in operation) {
        const { coordinates, inside = true, highPrecision = false } = operation.polygon;
        results = bkdNode.searchByPolygon(coordinates, inside, 'asc', highPrecision);
        const centroid = __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$bkd$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BKDTree"].calculatePolygonCentroid(coordinates);
        return createGeoTokenScores(results, centroid, highPrecision);
    }
    return null;
}
function addFindResult(set, filteredIDsResults) {
    if (!set) {
        set = new Set();
    }
    const keys = Object.keys(filteredIDsResults);
    const keysLength = keys.length;
    for(let i = 0; i < keysLength; i++){
        const ids = filteredIDsResults[keys[i]];
        const idsLength = ids.length;
        for(let j = 0; j < idsLength; j++){
            set.add(ids[j]);
        }
    }
    return set;
} //# sourceMappingURL=index.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/sorter.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createSorter",
    ()=>createSorter,
    "load",
    ()=>load,
    "save",
    ()=>save
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/languages.js [app-client] (ecmascript)");
;
;
;
;
;
function innerCreate(orama, sharedInternalDocumentStore, schema, sortableDeniedProperties, prefix) {
    const sorter = {
        language: orama.tokenizer.language,
        sharedInternalDocumentStore,
        enabled: true,
        isSorted: true,
        sortableProperties: [],
        sortablePropertiesWithTypes: {},
        sorts: {}
    };
    for (const [prop, type] of Object.entries(schema)){
        const path = `${prefix}${prefix ? '.' : ''}${prop}`;
        if (sortableDeniedProperties.includes(path)) {
            continue;
        }
        if (typeof type === 'object' && !Array.isArray(type)) {
            // Nested
            const ret = innerCreate(orama, sharedInternalDocumentStore, type, sortableDeniedProperties, path);
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["safeArrayPush"])(sorter.sortableProperties, ret.sortableProperties);
            sorter.sorts = {
                ...sorter.sorts,
                ...ret.sorts
            };
            sorter.sortablePropertiesWithTypes = {
                ...sorter.sortablePropertiesWithTypes,
                ...ret.sortablePropertiesWithTypes
            };
            continue;
        }
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isVectorType"])(type)) {
            switch(type){
                case 'boolean':
                case 'number':
                case 'string':
                    sorter.sortableProperties.push(path);
                    sorter.sortablePropertiesWithTypes[path] = type;
                    sorter.sorts[path] = {
                        docs: new Map(),
                        orderedDocsToRemove: new Map(),
                        orderedDocs: [],
                        type: type
                    };
                    break;
                case 'geopoint':
                case 'enum':
                    continue;
                case 'enum[]':
                case 'boolean[]':
                case 'number[]':
                case 'string[]':
                    continue;
                default:
                    throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_SORT_SCHEMA_TYPE', Array.isArray(type) ? 'array' : type, path);
            }
        }
    }
    return sorter;
}
function create(orama, sharedInternalDocumentStore, schema, config) {
    const isSortEnabled = config?.enabled !== false;
    if (!isSortEnabled) {
        return {
            disabled: true
        };
    }
    return innerCreate(orama, sharedInternalDocumentStore, schema, (config || {}).unsortableProperties || [], '');
}
function insert(sorter, prop, id, value) {
    if (!sorter.enabled) {
        return;
    }
    sorter.isSorted = false;
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(sorter.sharedInternalDocumentStore, id);
    const s = sorter.sorts[prop];
    // This happen during a document updating
    // Because we re-use the same internalId
    // We need to clean-up the data structure before re-inserting
    // to avoid duplicates in the orderedDocs array
    // See: https://github.com/oramasearch/orama/issues/629
    if (s.orderedDocsToRemove.has(internalId)) {
        ensureOrderedDocsAreDeletedByProperty(sorter, prop);
    }
    s.docs.set(internalId, s.orderedDocs.length);
    s.orderedDocs.push([
        internalId,
        value
    ]);
}
function ensureIsSorted(sorter) {
    if (sorter.isSorted || !sorter.enabled) {
        return;
    }
    const properties = Object.keys(sorter.sorts);
    for (const prop of properties){
        ensurePropertyIsSorted(sorter, prop);
    }
    sorter.isSorted = true;
}
function stringSort(language, value, d) {
    return value[1].localeCompare(d[1], (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getLocale"])(language));
}
function numberSort(value, d) {
    return value[1] - d[1];
}
function booleanSort(value, d) {
    return d[1] ? -1 : 1;
}
function ensurePropertyIsSorted(sorter, prop) {
    const s = sorter.sorts[prop];
    let predicate;
    switch(s.type){
        case 'string':
            predicate = stringSort.bind(null, sorter.language);
            break;
        case 'number':
            predicate = numberSort.bind(null);
            break;
        case 'boolean':
            predicate = booleanSort.bind(null);
            break;
    }
    s.orderedDocs.sort(predicate);
    // Increment position for the greather documents
    const orderedDocsLength = s.orderedDocs.length;
    for(let i = 0; i < orderedDocsLength; i++){
        const docId = s.orderedDocs[i][0];
        s.docs.set(docId, i);
    }
}
function ensureOrderedDocsAreDeleted(sorter) {
    const properties = Object.keys(sorter.sorts);
    for (const prop of properties){
        ensureOrderedDocsAreDeletedByProperty(sorter, prop);
    }
}
function ensureOrderedDocsAreDeletedByProperty(sorter, prop) {
    const s = sorter.sorts[prop];
    if (!s.orderedDocsToRemove.size) return;
    s.orderedDocs = s.orderedDocs.filter((doc)=>!s.orderedDocsToRemove.has(doc[0]));
    s.orderedDocsToRemove.clear();
}
function remove(sorter, prop, id) {
    if (!sorter.enabled) {
        return;
    }
    const s = sorter.sorts[prop];
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(sorter.sharedInternalDocumentStore, id);
    const index = s.docs.get(internalId);
    if (!index) return;
    s.docs.delete(internalId);
    s.orderedDocsToRemove.set(internalId, true);
}
function sortBy(sorter, docIds, by) {
    if (!sorter.enabled) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SORT_DISABLED');
    }
    const property = by.property;
    const isDesc = by.order === 'DESC';
    const s = sorter.sorts[property];
    if (!s) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNABLE_TO_SORT_ON_UNKNOWN_FIELD', property, sorter.sortableProperties.join(', '));
    }
    ensureOrderedDocsAreDeletedByProperty(sorter, property);
    ensureIsSorted(sorter);
    docIds.sort((a, b)=>{
        // This sort algorithm works leveraging on
        // that s.docs is a map of docId -> position
        // If a document is not indexed, it will be not present in the map
        const indexOfA = s.docs.get((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(sorter.sharedInternalDocumentStore, a[0]));
        const indexOfB = s.docs.get((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(sorter.sharedInternalDocumentStore, b[0]));
        const isAIndexed = typeof indexOfA !== 'undefined';
        const isBIndexed = typeof indexOfB !== 'undefined';
        if (!isAIndexed && !isBIndexed) {
            return 0;
        }
        // unindexed documents are always at the end
        if (!isAIndexed) {
            return 1;
        }
        if (!isBIndexed) {
            return -1;
        }
        return isDesc ? indexOfB - indexOfA : indexOfA - indexOfB;
    });
    return docIds;
}
function getSortableProperties(sorter) {
    if (!sorter.enabled) {
        return [];
    }
    return sorter.sortableProperties;
}
function getSortablePropertiesWithTypes(sorter) {
    if (!sorter.enabled) {
        return {};
    }
    return sorter.sortablePropertiesWithTypes;
}
function load(sharedInternalDocumentStore, raw) {
    const rawDocument = raw;
    if (!rawDocument.enabled) {
        return {
            enabled: false
        };
    }
    const sorts = Object.keys(rawDocument.sorts).reduce((acc, prop)=>{
        const { docs, orderedDocs, type } = rawDocument.sorts[prop];
        acc[prop] = {
            docs: new Map(Object.entries(docs).map(([k, v])=>[
                    +k,
                    v
                ])),
            orderedDocsToRemove: new Map(),
            orderedDocs,
            type
        };
        return acc;
    }, {});
    return {
        sharedInternalDocumentStore,
        language: rawDocument.language,
        sortableProperties: rawDocument.sortableProperties,
        sortablePropertiesWithTypes: rawDocument.sortablePropertiesWithTypes,
        sorts,
        enabled: true,
        isSorted: rawDocument.isSorted
    };
}
function save(sorter) {
    if (!sorter.enabled) {
        return {
            enabled: false
        };
    }
    ensureOrderedDocsAreDeleted(sorter);
    ensureIsSorted(sorter);
    const sorts = Object.keys(sorter.sorts).reduce((acc, prop)=>{
        const { docs, orderedDocs, type } = sorter.sorts[prop];
        acc[prop] = {
            docs: Object.fromEntries(docs.entries()),
            orderedDocs,
            type
        };
        return acc;
    }, {});
    return {
        language: sorter.language,
        sortableProperties: sorter.sortableProperties,
        sortablePropertiesWithTypes: sorter.sortablePropertiesWithTypes,
        sorts,
        enabled: sorter.enabled,
        isSorted: sorter.isSorted
    };
}
function createSorter() {
    return {
        create,
        insert,
        remove,
        save,
        load,
        sortBy,
        getSortableProperties,
        getSortablePropertiesWithTypes
    };
} //# sourceMappingURL=sorter.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/diacritics.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "replaceDiacritics",
    ()=>replaceDiacritics
]);
const DIACRITICS_CHARCODE_START = 192;
const DIACRITICS_CHARCODE_END = 383;
const CHARCODE_REPLACE_MAPPING = [
    65,
    65,
    65,
    65,
    65,
    65,
    65,
    67,
    69,
    69,
    69,
    69,
    73,
    73,
    73,
    73,
    69,
    78,
    79,
    79,
    79,
    79,
    79,
    null,
    79,
    85,
    85,
    85,
    85,
    89,
    80,
    115,
    97,
    97,
    97,
    97,
    97,
    97,
    97,
    99,
    101,
    101,
    101,
    101,
    105,
    105,
    105,
    105,
    101,
    110,
    111,
    111,
    111,
    111,
    111,
    null,
    111,
    117,
    117,
    117,
    117,
    121,
    112,
    121,
    65,
    97,
    65,
    97,
    65,
    97,
    67,
    99,
    67,
    99,
    67,
    99,
    67,
    99,
    68,
    100,
    68,
    100,
    69,
    101,
    69,
    101,
    69,
    101,
    69,
    101,
    69,
    101,
    71,
    103,
    71,
    103,
    71,
    103,
    71,
    103,
    72,
    104,
    72,
    104,
    73,
    105,
    73,
    105,
    73,
    105,
    73,
    105,
    73,
    105,
    73,
    105,
    74,
    106,
    75,
    107,
    107,
    76,
    108,
    76,
    108,
    76,
    108,
    76,
    108,
    76,
    108,
    78,
    110,
    78,
    110,
    78,
    110,
    110,
    78,
    110,
    79,
    111,
    79,
    111,
    79,
    111,
    79,
    111,
    82,
    114,
    82,
    114,
    82,
    114,
    83,
    115,
    83,
    115,
    83,
    115,
    83,
    115,
    84,
    116,
    84,
    116,
    84,
    116,
    85,
    117,
    85,
    117,
    85,
    117,
    85,
    117,
    85,
    117,
    85,
    117,
    87,
    119,
    89,
    121,
    89,
    90,
    122,
    90,
    122,
    90,
    122,
    115
];
function replaceChar(charCode) {
    if (charCode < DIACRITICS_CHARCODE_START || charCode > DIACRITICS_CHARCODE_END) return charCode;
    /* c8 ignore next  */ return CHARCODE_REPLACE_MAPPING[charCode - DIACRITICS_CHARCODE_START] || charCode;
}
function replaceDiacritics(str) {
    const stringCharCode = [];
    for(let idx = 0; idx < str.length; idx++){
        stringCharCode[idx] = replaceChar(str.charCodeAt(idx));
    }
    return String.fromCharCode(...stringCharCode);
} //# sourceMappingURL=diacritics.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/english-stemmer.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
__turbopack_context__.s([
    "stemmer",
    ()=>stemmer
]);
const step2List = {
    ational: 'ate',
    tional: 'tion',
    enci: 'ence',
    anci: 'ance',
    izer: 'ize',
    bli: 'ble',
    alli: 'al',
    entli: 'ent',
    eli: 'e',
    ousli: 'ous',
    ization: 'ize',
    ation: 'ate',
    ator: 'ate',
    alism: 'al',
    iveness: 'ive',
    fulness: 'ful',
    ousness: 'ous',
    aliti: 'al',
    iviti: 'ive',
    biliti: 'ble',
    logi: 'log'
};
const step3List = {
    icate: 'ic',
    ative: '',
    alize: 'al',
    iciti: 'ic',
    ical: 'ic',
    ful: '',
    ness: ''
};
// Consonant
const c = '[^aeiou]';
// Vowel
const v = '[aeiouy]';
// Consonant sequence
const C = c + '[^aeiouy]*';
// Vowel sequence
const V = v + '[aeiou]*';
// [C]VC... is m>0
const mgr0 = '^(' + C + ')?' + V + C;
// [C]VC[V] is m=1
const meq1 = '^(' + C + ')?' + V + C + '(' + V + ')?$';
// [C]VCVC... is m>1
const mgr1 = '^(' + C + ')?' + V + C + V + C;
// vowel in stem
const s_v = '^(' + C + ')?' + v;
function stemmer(w) {
    let stem;
    let suffix;
    let re;
    let re2;
    let re3;
    let re4;
    if (w.length < 3) {
        return w;
    }
    const firstch = w.substring(0, 1);
    if (firstch == 'y') {
        w = firstch.toUpperCase() + w.substring(1);
    }
    re = /^(.+?)(ss|i)es$/;
    re2 = /^(.+?)([^s])s$/;
    if (re.test(w)) {
        w = w.replace(re, '$1$2');
    } else if (re2.test(w)) {
        w = w.replace(re2, '$1$2');
    }
    re = /^(.+?)eed$/;
    re2 = /^(.+?)(ed|ing)$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        re = new RegExp(mgr0);
        if (re.test(fp[1])) {
            re = /.$/;
            w = w.replace(re, '');
        }
    } else if (re2.test(w)) {
        const fp = re2.exec(w);
        stem = fp[1];
        re2 = new RegExp(s_v);
        if (re2.test(stem)) {
            w = stem;
            re2 = /(at|bl|iz)$/;
            re3 = new RegExp('([^aeiouylsz])\\1$');
            re4 = new RegExp('^' + C + v + '[^aeiouwxy]$');
            if (re2.test(w)) {
                w = w + 'e';
            } else if (re3.test(w)) {
                re = /.$/;
                w = w.replace(re, '');
            } else if (re4.test(w)) {
                w = w + 'e';
            }
        }
    }
    re = /^(.+?)y$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        stem = fp?.[1];
        re = new RegExp(s_v);
        if (stem && re.test(stem)) {
            w = stem + 'i';
        }
    }
    re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        stem = fp?.[1];
        suffix = fp?.[2];
        re = new RegExp(mgr0);
        if (stem && re.test(stem)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            w = stem + step2List[suffix];
        }
    }
    re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        stem = fp?.[1];
        suffix = fp?.[2];
        re = new RegExp(mgr0);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (stem && re.test(stem)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            w = stem + step3List[suffix];
        }
    }
    re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
    re2 = /^(.+?)(s|t)(ion)$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        stem = fp?.[1];
        re = new RegExp(mgr1);
        if (stem && re.test(stem)) {
            w = stem;
        }
    } else if (re2.test(w)) {
        const fp = re2.exec(w);
        stem = fp?.[1] ?? '' + fp?.[2] ?? '';
        re2 = new RegExp(mgr1);
        if (re2.test(stem)) {
            w = stem;
        }
    }
    re = /^(.+?)e$/;
    if (re.test(w)) {
        const fp = re.exec(w);
        stem = fp?.[1];
        re = new RegExp(mgr1);
        re2 = new RegExp(meq1);
        re3 = new RegExp('^' + C + v + '[^aeiouwxy]$');
        if (stem && (re.test(stem) || re2.test(stem) && !re3.test(stem))) {
            w = stem;
        }
    }
    re = /ll$/;
    re2 = new RegExp(mgr1);
    if (re.test(w) && re2.test(w)) {
        re = /.$/;
        w = w.replace(re, '');
    }
    if (firstch == 'y') {
        w = firstch.toLowerCase() + w.substring(1);
    }
    return w;
} //# sourceMappingURL=english-stemmer.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/index.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createTokenizer",
    ()=>createTokenizer,
    "normalizeToken",
    ()=>normalizeToken
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$diacritics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/diacritics.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/languages.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$english$2d$stemmer$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/english-stemmer.js [app-client] (ecmascript)");
;
;
;
;
function normalizeToken(prop, token, withCache = true) {
    const key = `${this.language}:${prop}:${token}`;
    if (withCache && this.normalizationCache.has(key)) {
        return this.normalizationCache.get(key);
    }
    // Remove stopwords if enabled
    if (this.stopWords?.includes(token)) {
        if (withCache) {
            this.normalizationCache.set(key, '');
        }
        return '';
    }
    // Apply stemming if enabled
    if (this.stemmer && !this.stemmerSkipProperties.has(prop)) {
        token = this.stemmer(token);
    }
    token = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$diacritics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["replaceDiacritics"])(token);
    if (withCache) {
        this.normalizationCache.set(key, token);
    }
    return token;
}
/* c8 ignore next 10 */ function trim(text) {
    while(text[text.length - 1] === ''){
        text.pop();
    }
    while(text[0] === ''){
        text.shift();
    }
    return text;
}
function tokenize(input, language, prop, withCache = true) {
    if (language && language !== this.language) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('LANGUAGE_NOT_SUPPORTED', language);
    }
    /* c8 ignore next 3 */ if (typeof input !== 'string') {
        return [
            input
        ];
    }
    const normalizeToken = this.normalizeToken.bind(this, prop ?? '');
    let tokens;
    if (prop && this.tokenizeSkipProperties.has(prop)) {
        tokens = [
            normalizeToken(input, withCache)
        ];
    } else {
        const splitRule = __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SPLITTERS"][this.language];
        tokens = input.toLowerCase().split(splitRule).map((t)=>normalizeToken(t, withCache)).filter(Boolean);
    }
    const trimTokens = trim(tokens);
    if (!this.allowDuplicates) {
        return Array.from(new Set(trimTokens));
    }
    return trimTokens;
}
function createTokenizer(config = {}) {
    if (!config.language) {
        config.language = 'english';
    } else if (!__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$languages$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SUPPORTED_LANGUAGES"].includes(config.language)) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('LANGUAGE_NOT_SUPPORTED', config.language);
    }
    // Handle stemming - It is disabled by default
    let stemmer;
    if (config.stemming || config.stemmer && !('stemming' in config)) {
        if (config.stemmer) {
            if (typeof config.stemmer !== 'function') {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_STEMMER_FUNCTION_TYPE');
            }
            stemmer = config.stemmer;
        } else {
            if (config.language === 'english') {
                stemmer = __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$english$2d$stemmer$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stemmer"];
            } else {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('MISSING_STEMMER', config.language);
            }
        }
    }
    // Handle stopwords
    let stopWords;
    if (config.stopWords !== false) {
        stopWords = [];
        if (Array.isArray(config.stopWords)) {
            stopWords = config.stopWords;
        } else if (typeof config.stopWords === 'function') {
            stopWords = config.stopWords(stopWords);
        } else if (config.stopWords) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY');
        }
        // Make sure stopWords is just an array of strings
        if (!Array.isArray(stopWords)) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY');
        }
        for (const s of stopWords){
            if (typeof s !== 'string') {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY');
            }
        }
    }
    // Create the tokenizer
    const tokenizer = {
        tokenize,
        language: config.language,
        stemmer,
        stemmerSkipProperties: new Set(config.stemmerSkipProperties ? [
            config.stemmerSkipProperties
        ].flat() : []),
        tokenizeSkipProperties: new Set(config.tokenizeSkipProperties ? [
            config.tokenizeSkipProperties
        ].flat() : []),
        stopWords,
        allowDuplicates: Boolean(config.allowDuplicates),
        normalizeToken,
        normalizationCache: new Map()
    };
    tokenizer.tokenize = tokenize.bind(tokenizer);
    tokenizer.normalizeToken = normalizeToken;
    return tokenizer;
} //# sourceMappingURL=index.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createPinning",
    ()=>createPinning,
    "getMatchingRules",
    ()=>getMatchingRules,
    "load",
    ()=>load,
    "save",
    ()=>save
]);
function create(sharedInternalDocumentStore) {
    return {
        sharedInternalDocumentStore,
        rules: new Map()
    };
}
function addRule(store, rule) {
    if (store.rules.has(rule.id)) {
        throw new Error(`PINNING_RULE_ALREADY_EXISTS: A pinning rule with id "${rule.id}" already exists. Use updateRule to modify it.`);
    }
    store.rules.set(rule.id, rule);
}
function updateRule(store, rule) {
    if (!store.rules.has(rule.id)) {
        throw new Error(`PINNING_RULE_NOT_FOUND: Cannot update pinning rule with id "${rule.id}" because it does not exist. Use addRule to create it.`);
    }
    store.rules.set(rule.id, rule);
}
function removeRule(store, ruleId) {
    return store.rules.delete(ruleId);
}
function getRule(store, ruleId) {
    return store.rules.get(ruleId);
}
function getAllRules(store) {
    return Array.from(store.rules.values());
}
function matchesCondition(term, condition) {
    const normalizedTerm = term.toLowerCase().trim();
    const normalizedPattern = condition.pattern.toLowerCase().trim();
    switch(condition.anchoring){
        case 'is':
            return normalizedTerm === normalizedPattern;
        case 'starts_with':
            return normalizedTerm.startsWith(normalizedPattern);
        case 'contains':
            return normalizedTerm.includes(normalizedPattern);
        default:
            return false;
    }
}
function matchesRule(term, rule) {
    if (!term) {
        return false;
    }
    // All conditions must match (AND logic)
    return rule.conditions.every((condition)=>matchesCondition(term, condition));
}
function getMatchingRules(store, term) {
    if (!term) {
        return [];
    }
    const matchingRules = [];
    for (const rule of store.rules.values()){
        if (matchesRule(term, rule)) {
            matchingRules.push(rule);
        }
    }
    return matchingRules;
}
function load(sharedInternalDocumentStore, raw) {
    const rawStore = raw;
    return {
        sharedInternalDocumentStore,
        rules: new Map(rawStore?.rules ?? [])
    };
}
function save(store) {
    return {
        rules: Array.from(store.rules.entries())
    };
}
function createPinning() {
    return {
        create,
        addRule,
        updateRule,
        removeRule,
        getRule,
        getAllRules,
        getMatchingRules,
        load,
        save
    };
} //# sourceMappingURL=pinning.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/create.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "create",
    ()=>create
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$documents$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/documents-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$plugins$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/plugins.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$sorter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/sorter.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
function validateComponents(components) {
    const defaultComponents = {
        formatElapsedTime: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["formatElapsedTime"],
        getDocumentIndexId: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDocumentIndexId"],
        getDocumentProperties: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentProperties"],
        validateSchema: __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["validateSchema"]
    };
    for (const rawKey of __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FUNCTION_COMPONENTS"]){
        const key = rawKey;
        if (components[key]) {
            if (typeof components[key] !== 'function') {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('COMPONENT_MUST_BE_FUNCTION', key);
            }
        } else {
            components[key] = defaultComponents[key];
        }
    }
    for (const rawKey of Object.keys(components)){
        if (!__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["OBJECT_COMPONENTS"].includes(rawKey) && !__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FUNCTION_COMPONENTS"].includes(rawKey)) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNSUPPORTED_COMPONENT', rawKey);
        }
    }
}
function create({ schema, sort, language, components, id, plugins }) {
    if (!components) {
        components = {};
    }
    for (const plugin of plugins ?? []){
        if (!('getComponents' in plugin)) {
            continue;
        }
        if (typeof plugin.getComponents !== 'function') {
            continue;
        }
        const pluginComponents = plugin.getComponents(schema);
        const keys = Object.keys(pluginComponents);
        for (const key of keys){
            if (components[key]) {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('PLUGIN_COMPONENT_CONFLICT', key, plugin.name);
            }
        }
        components = {
            ...components,
            ...pluginComponents
        };
    }
    if (!id) {
        id = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["uniqueId"])();
    }
    let tokenizer = components.tokenizer;
    let index = components.index;
    let documentsStore = components.documentsStore;
    let sorter = components.sorter;
    let pinning = components.pinning;
    if (!tokenizer) {
        // Use the default tokenizer
        tokenizer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createTokenizer"])({
            language: language ?? 'english'
        });
    } else if (!tokenizer.tokenize) {
        // If there is no tokenizer function, we assume this is a TokenizerConfig
        tokenizer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createTokenizer"])(tokenizer);
    } else {
        const customTokenizer = tokenizer;
        tokenizer = customTokenizer;
    }
    if (components.tokenizer && language) {
        // Accept language only if a tokenizer is not provided
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('NO_LANGUAGE_WITH_CUSTOM_TOKENIZER');
    }
    const internalDocumentStore = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createInternalDocumentIDStore"])();
    index ||= (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createIndex"])();
    sorter ||= (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$sorter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createSorter"])();
    documentsStore ||= (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$documents$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createDocumentsStore"])();
    pinning ||= (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createPinning"])();
    // Validate all other components
    validateComponents(components);
    // Assign only recognized components and hooks
    const { getDocumentProperties, getDocumentIndexId, validateSchema, formatElapsedTime } = components;
    const orama = {
        data: {},
        caches: {},
        schema,
        tokenizer,
        index,
        sorter,
        documentsStore,
        pinning,
        internalDocumentIDStore: internalDocumentStore,
        getDocumentProperties,
        getDocumentIndexId,
        validateSchema,
        beforeInsert: [],
        afterInsert: [],
        beforeRemove: [],
        afterRemove: [],
        beforeUpdate: [],
        afterUpdate: [],
        beforeUpsert: [],
        afterUpsert: [],
        beforeSearch: [],
        afterSearch: [],
        beforeInsertMultiple: [],
        afterInsertMultiple: [],
        beforeRemoveMultiple: [],
        afterRemoveMultiple: [],
        beforeUpdateMultiple: [],
        afterUpdateMultiple: [],
        beforeUpsertMultiple: [],
        afterUpsertMultiple: [],
        afterCreate: [],
        formatElapsedTime,
        id,
        plugins,
        version: getVersion()
    };
    orama.data = {
        index: orama.index.create(orama, internalDocumentStore, schema),
        docs: orama.documentsStore.create(orama, internalDocumentStore),
        sorting: orama.sorter.create(orama, internalDocumentStore, schema, sort),
        pinning: orama.pinning.create(internalDocumentStore)
    };
    for (const hook of __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$plugins$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AVAILABLE_PLUGIN_HOOKS"]){
        orama[hook] = (orama[hook] ?? []).concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$plugins$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAllPluginsByHook"])(orama, hook));
    }
    const afterCreate = orama['afterCreate'];
    if (afterCreate) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runAfterCreate"])(afterCreate, orama);
    }
    return orama;
}
function getVersion() {
    return '{{VERSION}}';
} //# sourceMappingURL=create.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/docs.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "count",
    ()=>count,
    "getByID",
    ()=>getByID
]);
function getByID(db, id) {
    return db.documentsStore.get(db.data.docs, id);
}
function count(db) {
    return db.documentsStore.count(db.data.docs);
} //# sourceMappingURL=docs.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$documents$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/documents-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$sorter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/sorter.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)"); //# sourceMappingURL=components.js.map
;
;
;
;
;
;
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatElapsedTime",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["formatElapsedTime"],
    "getDocumentIndexId",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDocumentIndexId"],
    "getDocumentProperties",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentProperties"],
    "getInnerType",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getInnerType"],
    "getVectorSize",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getVectorSize"],
    "isArrayType",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isArrayType"],
    "isGeoPointType",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isGeoPointType"],
    "isVectorType",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["isVectorType"],
    "validateSchema",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["validateSchema"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/insert.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "innerInsertMultiple",
    ()=>innerInsertMultiple,
    "insert",
    ()=>insert,
    "insertMultiple",
    ()=>insertMultiple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/defaults.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
;
;
;
;
;
function insert(orama, doc, language, skipHooks, options) {
    const errorProperty = orama.validateSchema(doc, orama.schema);
    if (errorProperty) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SCHEMA_VALIDATION_FAILURE', errorProperty);
    }
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.insert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertAsync(orama, doc, language, skipHooks, options);
    }
    return innerInsertSync(orama, doc, language, skipHooks, options);
}
const ENUM_TYPE = new Set([
    'enum',
    'enum[]'
]);
const STRING_NUMBER_TYPE = new Set([
    'string',
    'number'
]);
async function innerInsertAsync(orama, doc, language, skipHooks, options) {
    const { index, docs } = orama.data;
    const id = orama.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id);
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeInsert, orama, id, doc);
    }
    if (!orama.documentsStore.store(docs, id, internalId, doc)) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ALREADY_EXISTS', id);
    }
    const docsCount = orama.documentsStore.count(docs);
    const indexableProperties = orama.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = orama.index.getSearchablePropertiesWithTypes(index);
    const indexableValues = orama.getDocumentProperties(doc, indexableProperties);
    for (const [key, value] of Object.entries(indexableValues)){
        if (typeof value === 'undefined') continue;
        const actualType = typeof value;
        const expectedType = indexablePropertiesWithTypes[key];
        validateDocumentProperty(actualType, expectedType, key, value);
    }
    await indexAndSortDocument(orama, id, indexableProperties, indexableValues, docsCount, language, doc, options);
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterInsert, orama, id, doc);
    }
    return id;
}
function innerInsertSync(orama, doc, language, skipHooks, options) {
    const { index, docs } = orama.data;
    const id = orama.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id);
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeInsert, orama, id, doc);
    }
    if (!orama.documentsStore.store(docs, id, internalId, doc)) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ALREADY_EXISTS', id);
    }
    const docsCount = orama.documentsStore.count(docs);
    const indexableProperties = orama.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = orama.index.getSearchablePropertiesWithTypes(index);
    const indexableValues = orama.getDocumentProperties(doc, indexableProperties);
    for (const [key, value] of Object.entries(indexableValues)){
        if (typeof value === 'undefined') continue;
        const actualType = typeof value;
        const expectedType = indexablePropertiesWithTypes[key];
        validateDocumentProperty(actualType, expectedType, key, value);
    }
    indexAndSortDocumentSync(orama, id, indexableProperties, indexableValues, docsCount, language, doc, options);
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterInsert, orama, id, doc);
    }
    return id;
}
function validateDocumentProperty(actualType, expectedType, key, value) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isGeoPointType"])(expectedType) && typeof value === 'object' && typeof value.lon === 'number' && typeof value.lat === 'number') {
        return;
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isVectorType"])(expectedType) && Array.isArray(value)) return;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$defaults$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isArrayType"])(expectedType) && Array.isArray(value)) return;
    if (ENUM_TYPE.has(expectedType) && STRING_NUMBER_TYPE.has(actualType)) return;
    if (actualType !== expectedType) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_DOCUMENT_PROPERTY', key, expectedType, actualType);
    }
}
async function indexAndSortDocument(orama, id, indexableProperties, indexableValues, docsCount, language, doc, options) {
    for (const prop of indexableProperties){
        const value = indexableValues[prop];
        if (typeof value === 'undefined') continue;
        const expectedType = orama.index.getSearchablePropertiesWithTypes(orama.data.index)[prop];
        await orama.index.beforeInsert?.(orama.data.index, prop, id, value, expectedType, language, orama.tokenizer, docsCount);
        const internalId = orama.internalDocumentIDStore.idToInternalId.get(id);
        await orama.index.insert(orama.index, orama.data.index, prop, id, internalId, value, expectedType, language, orama.tokenizer, docsCount, options);
        await orama.index.afterInsert?.(orama.data.index, prop, id, value, expectedType, language, orama.tokenizer, docsCount);
    }
    const sortableProperties = orama.sorter.getSortableProperties(orama.data.sorting);
    const sortableValues = orama.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties){
        const value = sortableValues[prop];
        if (typeof value === 'undefined') continue;
        const expectedType = orama.sorter.getSortablePropertiesWithTypes(orama.data.sorting)[prop];
        orama.sorter.insert(orama.data.sorting, prop, id, value, expectedType, language);
    }
}
function indexAndSortDocumentSync(orama, id, indexableProperties, indexableValues, docsCount, language, doc, options) {
    for (const prop of indexableProperties){
        const value = indexableValues[prop];
        if (typeof value === 'undefined') continue;
        const expectedType = orama.index.getSearchablePropertiesWithTypes(orama.data.index)[prop];
        const internalDocumentId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id);
        orama.index.beforeInsert?.(orama.data.index, prop, id, value, expectedType, language, orama.tokenizer, docsCount);
        orama.index.insert(orama.index, orama.data.index, prop, id, internalDocumentId, value, expectedType, language, orama.tokenizer, docsCount, options);
        orama.index.afterInsert?.(orama.data.index, prop, id, value, expectedType, language, orama.tokenizer, docsCount);
    }
    const sortableProperties = orama.sorter.getSortableProperties(orama.data.sorting);
    const sortableValues = orama.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties){
        const value = sortableValues[prop];
        if (typeof value === 'undefined') continue;
        const expectedType = orama.sorter.getSortablePropertiesWithTypes(orama.data.sorting)[prop];
        orama.sorter.insert(orama.data.sorting, prop, id, value, expectedType, language);
    }
}
function insertMultiple(orama, docs, batchSize, language, skipHooks, timeout) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.insert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertMultipleAsync(orama, docs, batchSize, language, skipHooks, timeout);
    }
    return innerInsertMultipleSync(orama, docs, batchSize, language, skipHooks, timeout);
}
async function innerInsertMultipleAsync(orama, docs, batchSize = 1000, language, skipHooks, timeout = 0) {
    const ids = [];
    const processNextBatch = async (startIndex)=>{
        const endIndex = Math.min(startIndex + batchSize, docs.length);
        const batch = docs.slice(startIndex, endIndex);
        for (const doc of batch){
            const options = {
                avlRebalanceThreshold: batch.length
            };
            const id = await insert(orama, doc, language, skipHooks, options);
            ids.push(id);
        }
        return endIndex;
    };
    const processAllBatches = async ()=>{
        let currentIndex = 0;
        while(currentIndex < docs.length){
            const startTime = Date.now();
            currentIndex = await processNextBatch(currentIndex);
            if (timeout > 0) {
                const elapsedTime = Date.now() - startTime;
                const waitTime = timeout - elapsedTime;
                if (waitTime > 0) {
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sleep"])(waitTime);
                }
            }
        }
    };
    await processAllBatches();
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterInsertMultiple, orama, docs);
    }
    return ids;
}
function innerInsertMultipleSync(orama, docs, batchSize = 1000, language, skipHooks, timeout = 0) {
    const ids = [];
    let i = 0;
    function processNextBatch() {
        const batch = docs.slice(i * batchSize, (i + 1) * batchSize);
        if (batch.length === 0) return false;
        for (const doc of batch){
            const options = {
                avlRebalanceThreshold: batch.length
            };
            const id = insert(orama, doc, language, skipHooks, options);
            ids.push(id);
        }
        i++;
        return true;
    }
    function processAllBatches() {
        const startTime = Date.now();
        // eslint-disable-next-line no-constant-condition
        while(true){
            const hasMoreBatches = processNextBatch();
            if (!hasMoreBatches) break;
            if (timeout > 0) {
                const elapsedTime = Date.now() - startTime;
                if (elapsedTime >= timeout) {
                    const remainingTime = timeout - elapsedTime % timeout;
                    if (remainingTime > 0) {
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sleep"])(remainingTime);
                    }
                }
            }
        }
    }
    processAllBatches();
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterInsertMultiple, orama, docs);
    }
    return ids;
}
function innerInsertMultiple(orama, docs, batchSize, language, skipHooks, timeout) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.insert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertMultipleAsync(orama, docs, batchSize, language, skipHooks, timeout);
    }
    return innerInsertMultipleSync(orama, docs, batchSize, language, skipHooks, timeout);
} //# sourceMappingURL=insert.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/pinning.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Insert a new pinning rule into the database.
 * Pinning rules allow you to promote specific documents to specific positions in search results
 * based on conditional matching of the search term.
 *
 * @example
 * ```typescript
 * import { create, insert, insertPin } from '@orama/orama'
 *
 * const db = await create({
 *   schema: {
 *     title: 'string',
 *     description: 'string'
 *   }
 * })
 *
 * await insert(db, { id: '1', title: 'Product A' })
 * await insert(db, { id: '2', title: 'Product B' })
 *
 * // When searching for "featured", pin Product B to position 0
 * insertPin(db, {
 *   id: 'featured-products',
 *   conditions: [
 *     { anchoring: 'contains', pattern: 'featured' }
 *   ],
 *   consequence: {
 *     promote: [
 *       { doc_id: '2', position: 0 }
 *     ]
 *   }
 * })
 * ```
 */ __turbopack_context__.s([
    "deletePin",
    ()=>deletePin,
    "getAllPins",
    ()=>getAllPins,
    "getPin",
    ()=>getPin,
    "insertPin",
    ()=>insertPin,
    "updatePin",
    ()=>updatePin
]);
function insertPin(orama, rule) {
    ;
    orama.pinning.addRule(orama.data.pinning, rule);
}
function updatePin(orama, rule) {
    ;
    orama.pinning.updateRule(orama.data.pinning, rule);
}
function deletePin(orama, ruleId) {
    return orama.pinning.removeRule(orama.data.pinning, ruleId);
}
function getPin(orama, ruleId) {
    return orama.pinning.getRule(orama.data.pinning, ruleId);
}
function getAllPins(orama) {
    return orama.pinning.getAllRules(orama.data.pinning);
} //# sourceMappingURL=pinning.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/remove.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "remove",
    ()=>remove,
    "removeMultiple",
    ()=>removeMultiple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
;
function remove(orama, id, language, skipHooks) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.remove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterRemove);
    if (asyncNeeded) {
        return removeAsync(orama, id, language, skipHooks);
    }
    return removeSync(orama, id, language, skipHooks);
}
async function removeAsync(orama, id, language, skipHooks) {
    let result = true;
    const { index, docs } = orama.data;
    const doc = orama.documentsStore.get(docs, id);
    if (!doc) {
        return false;
    }
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id);
    const docId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, internalId);
    const docsCount = orama.documentsStore.count(docs);
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeRemove, orama, docId);
    }
    const indexableProperties = orama.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = orama.index.getSearchablePropertiesWithTypes(index);
    const values = orama.getDocumentProperties(doc, indexableProperties);
    for (const prop of indexableProperties){
        const value = values[prop];
        if (typeof value === 'undefined') {
            continue;
        }
        const schemaType = indexablePropertiesWithTypes[prop];
        await orama.index.beforeRemove?.(orama.data.index, prop, docId, value, schemaType, language, orama.tokenizer, docsCount);
        if (!await orama.index.remove(orama.index, orama.data.index, prop, id, internalId, value, schemaType, language, orama.tokenizer, docsCount)) {
            result = false;
        }
        await orama.index.afterRemove?.(orama.data.index, prop, docId, value, schemaType, language, orama.tokenizer, docsCount);
    }
    const sortableProperties = await orama.sorter.getSortableProperties(orama.data.sorting);
    const sortableValues = await orama.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties){
        if (typeof sortableValues[prop] === 'undefined') {
            continue;
        }
        orama.sorter.remove(orama.data.sorting, prop, id);
    }
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterRemove, orama, docId);
    }
    orama.documentsStore.remove(orama.data.docs, id, internalId);
    return result;
}
function removeSync(orama, id, language, skipHooks) {
    let result = true;
    const { index, docs } = orama.data;
    const doc = orama.documentsStore.get(docs, id);
    if (!doc) {
        return false;
    }
    const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id);
    const docId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, internalId);
    const docsCount = orama.documentsStore.count(docs);
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeRemove, orama, docId);
    }
    const indexableProperties = orama.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = orama.index.getSearchablePropertiesWithTypes(index);
    const values = orama.getDocumentProperties(doc, indexableProperties);
    for (const prop of indexableProperties){
        const value = values[prop];
        if (typeof value === 'undefined') {
            continue;
        }
        const schemaType = indexablePropertiesWithTypes[prop];
        orama.index.beforeRemove?.(orama.data.index, prop, docId, value, schemaType, language, orama.tokenizer, docsCount);
        if (!orama.index.remove(orama.index, orama.data.index, prop, id, internalId, value, schemaType, language, orama.tokenizer, docsCount)) {
            result = false;
        }
        orama.index.afterRemove?.(orama.data.index, prop, docId, value, schemaType, language, orama.tokenizer, docsCount);
    }
    const sortableProperties = orama.sorter.getSortableProperties(orama.data.sorting);
    const sortableValues = orama.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties){
        if (typeof sortableValues[prop] === 'undefined') {
            continue;
        }
        orama.sorter.remove(orama.data.sorting, prop, id);
    }
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterRemove, orama, docId);
    }
    orama.documentsStore.remove(orama.data.docs, id, internalId);
    return result;
}
function removeMultiple(orama, ids, batchSize, language, skipHooks) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.remove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemoveMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemoveMultiple);
    if (asyncNeeded) {
        return removeMultipleAsync(orama, ids, batchSize, language, skipHooks);
    }
    return removeMultipleSync(orama, ids, batchSize, language, skipHooks);
}
async function removeMultipleAsync(orama, ids, batchSize, language, skipHooks) {
    let result = 0;
    if (!batchSize) {
        batchSize = 1000;
    }
    const docIdsForHooks = skipHooks ? [] : ids.map((id)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id)));
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeRemoveMultiple, orama, docIdsForHooks);
    }
    await new Promise((resolve, reject)=>{
        let i = 0;
        async function _removeMultiple() {
            const batch = ids.slice(i * batchSize, ++i * batchSize);
            if (!batch.length) {
                return resolve();
            }
            for (const doc of batch){
                try {
                    if (await remove(orama, doc, language, skipHooks)) {
                        result++;
                    }
                } catch (err) {
                    reject(err);
                }
            }
            setTimeout(_removeMultiple, 0);
        }
        setTimeout(_removeMultiple, 0);
    });
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterRemoveMultiple, orama, docIdsForHooks);
    }
    return result;
}
function removeMultipleSync(orama, ids, batchSize, language, skipHooks) {
    let result = 0;
    if (!batchSize) {
        batchSize = 1000;
    }
    const docIdsForHooks = skipHooks ? [] : ids.map((id)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id)));
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeRemoveMultiple, orama, docIdsForHooks);
    }
    let i = 0;
    function _removeMultipleSync() {
        const batch = ids.slice(i * batchSize, ++i * batchSize);
        if (!batch.length) return;
        for (const doc of batch){
            if (remove(orama, doc, language, skipHooks)) {
                result++;
            }
        }
        setTimeout(_removeMultipleSync, 0);
    }
    _removeMultipleSync();
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterRemoveMultiple, orama, docIdsForHooks);
    }
    return result;
} //# sourceMappingURL=remove.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/constants.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MODE_FULLTEXT_SEARCH",
    ()=>MODE_FULLTEXT_SEARCH,
    "MODE_HYBRID_SEARCH",
    ()=>MODE_HYBRID_SEARCH,
    "MODE_VECTOR_SEARCH",
    ()=>MODE_VECTOR_SEARCH
]);
const MODE_FULLTEXT_SEARCH = 'fulltext';
const MODE_HYBRID_SEARCH = 'hybrid';
const MODE_VECTOR_SEARCH = 'vector'; //# sourceMappingURL=constants.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/facets.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getFacets",
    ()=>getFacets
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
function sortAsc(a, b) {
    return a[1] - b[1];
}
function sortDesc(a, b) {
    return b[1] - a[1];
}
function sortingPredicateBuilder(order = 'desc') {
    return order.toLowerCase() === 'asc' ? sortAsc : sortDesc;
}
function getFacets(orama, results, facetsConfig) {
    const facets = {};
    const allIDs = results.map(([id])=>id);
    const allDocs = orama.documentsStore.getMultiple(orama.data.docs, allIDs);
    const facetKeys = Object.keys(facetsConfig);
    const properties = orama.index.getSearchablePropertiesWithTypes(orama.data.index);
    for (const facet of facetKeys){
        let values;
        // Hack to guarantee the same order of ranges as specified by the user
        // TODO: Revisit this once components land
        if (properties[facet] === 'number') {
            const { ranges } = facetsConfig[facet];
            const rangesLength = ranges.length;
            const tmp = Array.from({
                length: rangesLength
            });
            for(let i = 0; i < rangesLength; i++){
                const range = ranges[i];
                tmp[i] = [
                    `${range.from}-${range.to}`,
                    0
                ];
            }
            values = Object.fromEntries(tmp);
        }
        facets[facet] = {
            count: 0,
            values: values ?? {}
        };
    }
    const allDocsLength = allDocs.length;
    for(let i = 0; i < allDocsLength; i++){
        const doc = allDocs[i];
        for (const facet of facetKeys){
            const facetValue = facet.includes('.') ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNested"])(doc, facet) : doc[facet];
            const propertyType = properties[facet];
            const facetValues = facets[facet].values;
            switch(propertyType){
                case 'number':
                    {
                        const ranges = facetsConfig[facet].ranges;
                        calculateNumberFacetBuilder(ranges, facetValues)(facetValue);
                        break;
                    }
                case 'number[]':
                    {
                        const alreadyInsertedValues = new Set();
                        const ranges = facetsConfig[facet].ranges;
                        const calculateNumberFacet = calculateNumberFacetBuilder(ranges, facetValues, alreadyInsertedValues);
                        for (const v of facetValue){
                            calculateNumberFacet(v);
                        }
                        break;
                    }
                case 'boolean':
                case 'enum':
                case 'string':
                    {
                        calculateBooleanStringOrEnumFacetBuilder(facetValues, propertyType)(facetValue);
                        break;
                    }
                case 'boolean[]':
                case 'enum[]':
                case 'string[]':
                    {
                        const alreadyInsertedValues = new Set();
                        const innerType = propertyType === 'boolean[]' ? 'boolean' : 'string';
                        const calculateBooleanStringOrEnumFacet = calculateBooleanStringOrEnumFacetBuilder(facetValues, innerType, alreadyInsertedValues);
                        for (const v of facetValue){
                            calculateBooleanStringOrEnumFacet(v);
                        }
                        break;
                    }
                default:
                    throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('FACET_NOT_SUPPORTED', propertyType);
            }
        }
    }
    // TODO: We are looping again with the same previous keys, should we creat a single loop instead?
    for (const facet of facetKeys){
        const currentFacet = facets[facet];
        // Count the number of values for each facet
        currentFacet.count = Object.keys(currentFacet.values).length;
        // Sort only string-based facets
        if (properties[facet] === 'string') {
            const stringFacetDefinition = facetsConfig[facet];
            const sortingPredicate = sortingPredicateBuilder(stringFacetDefinition.sort);
            currentFacet.values = Object.fromEntries(Object.entries(currentFacet.values).sort(sortingPredicate).slice(stringFacetDefinition.offset ?? 0, stringFacetDefinition.limit ?? 10));
        }
    }
    return facets;
}
function calculateNumberFacetBuilder(ranges, values, alreadyInsertedValues) {
    return (facetValue)=>{
        for (const range of ranges){
            const value = `${range.from}-${range.to}`;
            if (alreadyInsertedValues?.has(value)) {
                continue;
            }
            if (facetValue >= range.from && facetValue <= range.to) {
                if (values[value] === undefined) {
                    values[value] = 1;
                } else {
                    values[value]++;
                    alreadyInsertedValues?.add(value);
                }
            }
        }
    };
}
function calculateBooleanStringOrEnumFacetBuilder(values, propertyType, alreadyInsertedValues) {
    const defaultValue = propertyType === 'boolean' ? 'false' : '';
    return (facetValue)=>{
        // String or boolean based facets
        const value = facetValue?.toString() ?? defaultValue;
        if (alreadyInsertedValues?.has(value)) {
            return;
        }
        values[value] = (values[value] ?? 0) + 1;
        alreadyInsertedValues?.add(value);
    };
} //# sourceMappingURL=facets.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/groups.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getGroups",
    ()=>getGroups
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
;
;
;
const DEFAULT_REDUCE = {
    reducer: (_, acc, res, index)=>{
        acc[index] = res;
        return acc;
    },
    getInitialValue: (length)=>Array.from({
            length
        })
};
const ALLOWED_TYPES = [
    'string',
    'number',
    'boolean'
];
function getGroups(orama, results, groupBy) {
    const properties = groupBy.properties;
    const propertiesLength = properties.length;
    const schemaProperties = orama.index.getSearchablePropertiesWithTypes(orama.data.index);
    for(let i = 0; i < propertiesLength; i++){
        const property = properties[i];
        if (typeof schemaProperties[property] === 'undefined') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNKNOWN_GROUP_BY_PROPERTY', property);
        }
        if (!ALLOWED_TYPES.includes(schemaProperties[property])) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_GROUP_BY_PROPERTY', property, ALLOWED_TYPES.join(', '), schemaProperties[property]);
        }
    }
    const allIDs = results.map(([id])=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, id));
    // allDocs is already sorted by the sortBy algorithm
    // We leverage on that to limit the number of documents returned
    const allDocs = orama.documentsStore.getMultiple(orama.data.docs, allIDs);
    const allDocsLength = allDocs.length;
    const returnedCount = groupBy.maxResult || Number.MAX_SAFE_INTEGER;
    const listOfValues = [];
    // We want to understand which documents have which values
    // and group them by the property and values
    const g = {};
    for(let i = 0; i < propertiesLength; i++){
        const groupByKey = properties[i];
        const group = {
            property: groupByKey,
            perValue: {}
        };
        const values = new Set();
        for(let j = 0; j < allDocsLength; j++){
            const doc = allDocs[j];
            const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNested"])(doc, groupByKey);
            // we don't want to consider undefined values
            if (typeof value === 'undefined') {
                continue;
            }
            const keyValue = typeof value !== 'boolean' ? value : '' + value;
            const perValue = group.perValue[keyValue] ?? {
                indexes: [],
                count: 0
            };
            if (perValue.count >= returnedCount) {
                continue;
            }
            // We use the index to keep track of the original order
            perValue.indexes.push(j);
            perValue.count++;
            group.perValue[keyValue] = perValue;
            values.add(value);
        }
        listOfValues.push(Array.from(values));
        g[groupByKey] = group;
    }
    const combinations = calculateCombination(listOfValues);
    const combinationsLength = combinations.length;
    const groups = [];
    for(let i = 0; i < combinationsLength; i++){
        const combination = combinations[i];
        const combinationLength = combination.length;
        const group = {
            values: [],
            indexes: []
        };
        const indexes = [];
        for(let j = 0; j < combinationLength; j++){
            const value = combination[j];
            const property = properties[j];
            indexes.push(g[property].perValue[typeof value !== 'boolean' ? value : '' + value].indexes);
            group.values.push(value);
        }
        // We leverage on the index to sort the results by the original order
        group.indexes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["intersect"])(indexes).sort((a, b)=>a - b);
        // don't generate empty groups
        if (group.indexes.length === 0) {
            continue;
        }
        groups.push(group);
    }
    const groupsLength = groups.length;
    const res = Array.from({
        length: groupsLength
    });
    for(let i = 0; i < groupsLength; i++){
        const group = groups[i];
        const reduce = groupBy.reduce || DEFAULT_REDUCE;
        const docs = group.indexes.map((index)=>{
            return {
                id: allIDs[index],
                score: results[index][1],
                document: allDocs[index]
            };
        });
        const func = reduce.reducer.bind(null, group.values);
        const initialValue = reduce.getInitialValue(group.indexes.length);
        const aggregationValue = docs.reduce(func, initialValue);
        res[i] = {
            values: group.values,
            result: aggregationValue
        };
    }
    return res;
}
function calculateCombination(arrs, index = 0) {
    if (index + 1 === arrs.length) return arrs[index].map((item)=>[
            item
        ]);
    const head = arrs[index];
    const c = calculateCombination(arrs, index + 1);
    const combinations = [];
    for (const value of head){
        for (const combination of c){
            const result = [
                value
            ];
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["safeArrayPush"])(result, combination);
            combinations.push(result);
        }
    }
    return combinations;
} //# sourceMappingURL=groups.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning-manager.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applyPinningRules",
    ()=>applyPinningRules
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning.js [app-client] (ecmascript)");
;
;
function applyPinningRules(orama, pinningStore, uniqueDocsArray, searchTerm) {
    // Get all matching rules for the current search term
    const matchingRules = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getMatchingRules"])(pinningStore, searchTerm);
    if (matchingRules.length === 0) {
        return uniqueDocsArray;
    }
    // Collect all promotions from matching rules
    const allPromotions = matchingRules.flatMap((rule)=>rule.consequence.promote);
    // Sort promotions by position (lower position = higher priority)
    allPromotions.sort((a, b)=>a.position - b.position);
    // Create a Set of pinned internal document IDs for fast lookup
    const pinnedInternalIds = new Set();
    const promotionsMap = new Map(); // Map internal ID to desired position
    const positionsTaken = new Set(); // Track which positions are already claimed
    for (const promotion of allPromotions){
        const internalId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, promotion.doc_id);
        // Skip if document doesn't exist in the database or if this position is already taken
        if (internalId === undefined) {
            continue;
        }
        // If this document is already pinned to a different position, keep the first one (lower position)
        if (promotionsMap.has(internalId)) {
            const existingPosition = promotionsMap.get(internalId);
            if (promotion.position < existingPosition) {
                promotionsMap.set(internalId, promotion.position);
            }
            continue;
        }
        // If this position is already taken, skip this promotion (first wins)
        if (positionsTaken.has(promotion.position)) {
            continue;
        }
        pinnedInternalIds.add(internalId);
        promotionsMap.set(internalId, promotion.position);
        positionsTaken.add(promotion.position);
    }
    // If no valid promotions were found, return original results
    if (promotionsMap.size === 0) {
        return uniqueDocsArray;
    }
    // Remove pinned documents from the original results
    const unpinnedResults = uniqueDocsArray.filter(([id])=>!pinnedInternalIds.has(id));
    // Create pinned results with their scores
    // We assign a very high base score and subtract the position to maintain order
    const BASE_PIN_SCORE = 1000000;
    const pinnedResults = [];
    for (const [internalId, position] of promotionsMap.entries()){
        // Check if the document exists in the original results
        const existingResult = uniqueDocsArray.find(([id])=>id === internalId);
        if (existingResult) {
            // Document was in original results, use its score but mark it as pinned
            pinnedResults.push([
                internalId,
                BASE_PIN_SCORE - position
            ]);
        } else {
            // Document was NOT in original results (promoted from outside the result set)
            // Verify the document actually exists in the database before promoting it
            const doc = orama.documentsStore.get(orama.data.docs, internalId);
            if (doc) {
                // Assign a score of 0 (as per PR #251 behavior)
                pinnedResults.push([
                    internalId,
                    0
                ]);
            }
        }
    }
    // Sort pinned results by their assigned scores (which correspond to positions)
    pinnedResults.sort((a, b)=>{
        const posA = promotionsMap.get(a[0]) ?? Infinity;
        const posB = promotionsMap.get(b[0]) ?? Infinity;
        return posA - posB;
    });
    // Insert pinned results at their specified positions
    const finalResults = [];
    const pinnedByPosition = new Map();
    for (const pinnedResult of pinnedResults){
        const position = promotionsMap.get(pinnedResult[0]);
        pinnedByPosition.set(position, pinnedResult);
    }
    let unpinnedIndex = 0;
    let currentPosition = 0;
    // Build the final results array by interleaving pinned and unpinned results
    while(currentPosition < unpinnedResults.length + pinnedResults.length){
        if (pinnedByPosition.has(currentPosition)) {
            // Insert pinned document at this position
            finalResults.push(pinnedByPosition.get(currentPosition));
            currentPosition++;
        } else if (unpinnedIndex < unpinnedResults.length) {
            // Insert next unpinned document
            finalResults.push(unpinnedResults[unpinnedIndex]);
            unpinnedIndex++;
            currentPosition++;
        } else {
            break;
        }
    }
    // Add any remaining pinned results that have positions beyond the unpinned results length
    for (const [position, pinnedResult] of pinnedByPosition.entries()){
        if (position >= finalResults.length) {
            finalResults.push(pinnedResult);
        }
    }
    return finalResults;
} //# sourceMappingURL=pinning-manager.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-fulltext.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "defaultBM25Params",
    ()=>defaultBM25Params,
    "fullTextSearch",
    ()=>fullTextSearch,
    "innerFullTextSearch",
    ()=>innerFullTextSearch
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/facets.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/groups.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning-manager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$docs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/docs.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
function innerFullTextSearch(orama, params, language) {
    const { term, properties } = params;
    const index = orama.data.index;
    // Get searchable string properties
    let propertiesToSearch = orama.caches['propertiesToSearch'];
    if (!propertiesToSearch) {
        const propertiesToSearchWithTypes = orama.index.getSearchablePropertiesWithTypes(index);
        propertiesToSearch = orama.index.getSearchableProperties(index);
        propertiesToSearch = propertiesToSearch.filter((prop)=>propertiesToSearchWithTypes[prop].startsWith('string'));
        orama.caches['propertiesToSearch'] = propertiesToSearch;
    }
    if (properties && properties !== '*') {
        for (const prop of properties){
            if (!propertiesToSearch.includes(prop)) {
                throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNKNOWN_INDEX', prop, propertiesToSearch.join(', '));
            }
        }
        propertiesToSearch = propertiesToSearch.filter((prop)=>properties.includes(prop));
    }
    // If filters are enabled, we need to get the IDs of the documents that match the filters.
    const hasFilters = Object.keys(params.where ?? {}).length > 0;
    let whereFiltersIDs;
    if (hasFilters) {
        whereFiltersIDs = orama.index.searchByWhereClause(index, orama.tokenizer, params.where, language);
    }
    let uniqueDocsIDs;
    // We need to perform the search if:
    // - we have a search term
    // - or we have properties to search
    //   in this case, we need to return all the documents that contains at least one of the given properties
    const threshold = params.threshold !== undefined && params.threshold !== null ? params.threshold : 1;
    if (term || properties) {
        const docsCount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$docs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["count"])(orama);
        uniqueDocsIDs = orama.index.search(index, term || '', orama.tokenizer, language, propertiesToSearch, params.exact || false, params.tolerance || 0, params.boost || {}, applyDefault(params.relevance), docsCount, whereFiltersIDs, threshold);
        // When exact is true and we have a term, filter results to only include documents
        // where the original text contains the exact search term (case-sensitive).
        // This is a highly requested feature and although Orama is not case-sensitive by design,
        // this is a reasonable compromise.
        if (params.exact && term) {
            const searchTerms = term.trim().split(/\s+/);
            uniqueDocsIDs = uniqueDocsIDs.filter(([docId])=>{
                const doc = orama.documentsStore.get(orama.data.docs, docId);
                if (!doc) return false;
                // Check if any of the specified properties contain the exact search term
                for (const prop of propertiesToSearch){
                    const propValue = getPropValue(doc, prop);
                    if (typeof propValue === 'string') {
                        // Check if all search terms appear as complete words in the property value
                        const hasAllTerms = searchTerms.every((searchTerm)=>{
                            // Create a regex that matches the term as a complete word (case-sensitive)
                            const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`);
                            return regex.test(propValue);
                        });
                        if (hasAllTerms) {
                            return true;
                        }
                    }
                }
                return false;
            });
        }
    } else {
        // Check if this is a geosearch-only query first
        if (hasFilters) {
            const geoResults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["searchByGeoWhereClause"])(index, params.where);
            if (geoResults) {
                // This is a geosearch-only query with distance scoring
                uniqueDocsIDs = geoResults;
            } else {
                // Regular filter query without search term
                const docIds = whereFiltersIDs ? Array.from(whereFiltersIDs) : [];
                uniqueDocsIDs = docIds.map((k)=>[
                        +k,
                        0
                    ]);
            }
        } else {
            // No search term and no filters - return all documents
            const docIds = Object.keys(orama.documentsStore.getAll(orama.data.docs));
            uniqueDocsIDs = docIds.map((k)=>[
                    +k,
                    0
                ]);
        }
    }
    return uniqueDocsIDs;
}
// Helper function to escape regex special characters
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Helper function to get nested property value
function getPropValue(obj, path) {
    const keys = path.split('.');
    let value = obj;
    for (const key of keys){
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return undefined;
        }
    }
    return value;
}
function fullTextSearch(orama, params, language) {
    const timeStart = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])();
    function performSearchLogic() {
        const vectorProperties = Object.keys(orama.data.index.vectorIndexes);
        const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0;
        const { limit = 10, offset = 0, distinctOn, includeVectors = false } = params;
        const isPreflight = params.preflight === true;
        let uniqueDocsArray = innerFullTextSearch(orama, params, language);
        if (params.sortBy) {
            if (typeof params.sortBy === 'function') {
                const ids = uniqueDocsArray.map(([id])=>id);
                const docs = orama.documentsStore.getMultiple(orama.data.docs, ids);
                const docsWithIdAndScore = docs.map((d, i)=>[
                        uniqueDocsArray[i][0],
                        uniqueDocsArray[i][1],
                        d
                    ]);
                docsWithIdAndScore.sort(params.sortBy);
                uniqueDocsArray = docsWithIdAndScore.map(([id, score])=>[
                        id,
                        score
                    ]);
            } else {
                uniqueDocsArray = orama.sorter.sortBy(orama.data.sorting, uniqueDocsArray, params.sortBy).map(([id, score])=>[
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getInternalDocumentId"])(orama.internalDocumentIDStore, id),
                        score
                    ]);
            }
        } else {
            uniqueDocsArray = uniqueDocsArray.sort(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sortTokenScorePredicate"]);
        }
        // Apply pinning rules after sorting but before pagination
        uniqueDocsArray = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["applyPinningRules"])(orama, orama.data.pinning, uniqueDocsArray, params.term);
        let results;
        if (!isPreflight) {
            results = distinctOn ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchDocumentsWithDistinct"])(orama, uniqueDocsArray, offset, limit, distinctOn) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchDocuments"])(orama, uniqueDocsArray, offset, limit);
        }
        const searchResult = {
            elapsed: {
                formatted: '',
                raw: 0
            },
            hits: [],
            count: uniqueDocsArray.length
        };
        if (typeof results !== 'undefined') {
            searchResult.hits = results.filter(Boolean);
            if (!includeVectors) {
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["removeVectorsFromHits"])(searchResult, vectorProperties);
            }
        }
        if (shouldCalculateFacets) {
            const facets = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getFacets"])(orama, uniqueDocsArray, params.facets);
            searchResult.facets = facets;
        }
        if (params.groupBy) {
            searchResult.groups = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getGroups"])(orama, uniqueDocsArray, params.groupBy);
        }
        searchResult.elapsed = orama.formatElapsedTime((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])() - timeStart);
        return searchResult;
    }
    async function executeSearchAsync() {
        if (orama.beforeSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runBeforeSearch"])(orama.beforeSearch, orama, params, language);
        }
        const searchResult = performSearchLogic();
        if (orama.afterSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runAfterSearch"])(orama.afterSearch, orama, params, language, searchResult);
        }
        return searchResult;
    }
    const asyncNeeded = orama.beforeSearch?.length || orama.afterSearch?.length;
    if (asyncNeeded) {
        return executeSearchAsync();
    }
    return performSearchLogic();
}
const defaultBM25Params = {
    k: 1.2,
    b: 0.75,
    d: 0.5
};
function applyDefault(bm25Relevance) {
    const r = bm25Relevance ?? {};
    r.k = r.k ?? defaultBM25Params.k;
    r.b = r.b ?? defaultBM25Params.b;
    r.d = r.d ?? defaultBM25Params.d;
    return r;
} //# sourceMappingURL=search-fulltext.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-vector.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "innerVectorSearch",
    ()=>innerVectorSearch,
    "searchVector",
    ()=>searchVector
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/facets.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/groups.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/trees/vector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning-manager.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
function innerVectorSearch(orama, params, language) {
    const vector = params.vector;
    if (vector && (!('value' in vector) || !('property' in vector))) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_VECTOR_INPUT', Object.keys(vector).join(', '));
    }
    const vectorIndex = orama.data.index.vectorIndexes[vector.property];
    if (!vectorIndex) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('UNKNOWN_VECTOR_PROPERTY', vector.property);
    }
    const vectorSize = vectorIndex.node.size;
    if (vector?.value.length !== vectorSize) {
        if (vector?.property === undefined || vector?.value.length === undefined) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_INPUT_VECTOR', 'undefined', vectorSize, 'undefined');
        }
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_INPUT_VECTOR', vector.property, vectorSize, vector.value.length);
    }
    const index = orama.data.index;
    let whereFiltersIDs;
    const hasFilters = Object.keys(params.where ?? {}).length > 0;
    if (hasFilters) {
        whereFiltersIDs = orama.index.searchByWhereClause(index, orama.tokenizer, params.where, language);
    }
    return vectorIndex.node.find(vector.value, params.similarity ?? __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$trees$2f$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DEFAULT_SIMILARITY"], whereFiltersIDs);
}
function searchVector(orama, params, language = 'english') {
    const timeStart = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])();
    function performSearchLogic() {
        let results = innerVectorSearch(orama, params, language).sort(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sortTokenScorePredicate"]);
        // Apply pinning rules after sorting but before pagination
        results = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["applyPinningRules"])(orama, orama.data.pinning, results, undefined);
        let facetsResults = [];
        const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0;
        if (shouldCalculateFacets) {
            const facets = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getFacets"])(orama, results, params.facets);
            facetsResults = facets;
        }
        const vectorProperty = params.vector.property;
        const includeVectors = params.includeVectors ?? false;
        const limit = params.limit ?? 10;
        const offset = params.offset ?? 0;
        const docs = Array.from({
            length: limit
        });
        for(let i = 0; i < limit; i++){
            const result = results[i + offset];
            if (!result) {
                break;
            }
            const doc = orama.data.docs.docs[result[0]];
            if (doc) {
                if (!includeVectors) {
                    doc[vectorProperty] = null;
                }
                const newDoc = {
                    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, result[0]),
                    score: result[1],
                    document: doc
                };
                docs[i] = newDoc;
            }
        }
        let groups = [];
        if (params.groupBy) {
            groups = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getGroups"])(orama, results, params.groupBy);
        }
        const timeEnd = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])();
        const elapsedTime = timeEnd - timeStart;
        return {
            count: results.length,
            hits: docs.filter(Boolean),
            elapsed: {
                raw: Number(elapsedTime),
                formatted: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNanoseconds"])(elapsedTime)
            },
            ...facetsResults ? {
                facets: facetsResults
            } : {},
            ...groups ? {
                groups
            } : {}
        };
    }
    async function executeSearchAsync() {
        if (orama.beforeSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runBeforeSearch"])(orama.beforeSearch, orama, params, language);
        }
        const results = performSearchLogic();
        if (orama.afterSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runAfterSearch"])(orama.afterSearch, orama, params, language, results);
        }
        return results;
    }
    const asyncNeeded = orama.beforeSearch?.length || orama.afterSearch?.length;
    if (asyncNeeded) {
        return executeSearchAsync();
    }
    // Sync path
    return performSearchLogic();
} //# sourceMappingURL=search-vector.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-hybrid.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "hybridSearch",
    ()=>hybridSearch,
    "innerHybridSearch",
    ()=>innerHybridSearch
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/facets.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/groups.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$fulltext$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-fulltext.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-vector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/pinning-manager.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
function innerHybridSearch(orama, params, language) {
    const fullTextIDs = minMaxScoreNormalization((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$fulltext$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerFullTextSearch"])(orama, params, language));
    const vectorIDs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerVectorSearch"])(orama, params, language);
    const hybridWeights = params.hybridWeights;
    return mergeAndRankResults(fullTextIDs, vectorIDs, params.term ?? '', hybridWeights);
}
function hybridSearch(orama, params, language) {
    const timeStart = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])();
    function performSearchLogic() {
        let uniqueTokenScores = innerHybridSearch(orama, params, language);
        // Apply pinning rules after merging results but before pagination
        uniqueTokenScores = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$pinning$2d$manager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["applyPinningRules"])(orama, orama.data.pinning, uniqueTokenScores, params.term);
        let facetsResults;
        const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0;
        if (shouldCalculateFacets) {
            facetsResults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$facets$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getFacets"])(orama, uniqueTokenScores, params.facets);
        }
        let groups;
        if (params.groupBy) {
            groups = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$groups$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getGroups"])(orama, uniqueTokenScores, params.groupBy);
        }
        const offset = params.offset ?? 0;
        const limit = params.limit ?? 10;
        const results = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchDocuments"])(orama, uniqueTokenScores, offset, limit).filter(Boolean);
        const timeEnd = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNanosecondsTime"])();
        const returningResults = {
            count: uniqueTokenScores.length,
            elapsed: {
                raw: Number(timeEnd - timeStart),
                formatted: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNanoseconds"])(timeEnd - timeStart)
            },
            hits: results,
            ...facetsResults ? {
                facets: facetsResults
            } : {},
            ...groups ? {
                groups
            } : {}
        };
        const includeVectors = params.includeVectors ?? false;
        if (!includeVectors) {
            const vectorProperties = Object.keys(orama.data.index.vectorIndexes);
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["removeVectorsFromHits"])(returningResults, vectorProperties);
        }
        return returningResults;
    }
    async function executeSearchAsync() {
        if (orama.beforeSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runBeforeSearch"])(orama.beforeSearch, orama, params, language);
        }
        const results = performSearchLogic();
        if (orama.afterSearch) {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runAfterSearch"])(orama.afterSearch, orama, params, language, results);
        }
        return results;
    }
    const asyncNeeded = orama.beforeSearch?.length || orama.afterSearch?.length;
    if (asyncNeeded) {
        return executeSearchAsync();
    }
    return performSearchLogic();
}
function extractScore(token) {
    return token[1];
}
function minMaxScoreNormalization(results) {
    // In this case I disabled the `prefer-spread` rule because spread seems to be slower
    // eslint-disable-next-line prefer-spread
    const maxScore = Math.max.apply(Math, results.map(extractScore));
    return results.map(([id, score])=>[
            id,
            score / maxScore
        ]);
}
function normalizeScore(score, maxScore) {
    return score / maxScore;
}
function hybridScoreBuilder(textWeight, vectorWeight) {
    return (textScore, vectorScore)=>textScore * textWeight + vectorScore * vectorWeight;
}
function mergeAndRankResults(textResults, vectorResults, query, hybridWeights) {
    // eslint-disable-next-line prefer-spread
    const maxTextScore = Math.max.apply(Math, textResults.map(extractScore));
    // eslint-disable-next-line prefer-spread
    const maxVectorScore = Math.max.apply(Math, vectorResults.map(extractScore));
    const hasHybridWeights = hybridWeights && hybridWeights.text && hybridWeights.vector;
    const { text: textWeight, vector: vectorWeight } = hasHybridWeights ? hybridWeights : getQueryWeights(query);
    const mergedResults = new Map();
    const textResultsLength = textResults.length;
    const hybridScore = hybridScoreBuilder(textWeight, vectorWeight);
    for(let i = 0; i < textResultsLength; i++){
        const [id, score] = textResults[i];
        const normalizedScore = normalizeScore(score, maxTextScore);
        const hybridScoreValue = hybridScore(normalizedScore, 0);
        mergedResults.set(id, hybridScoreValue);
    }
    const vectorResultsLength = vectorResults.length;
    for(let i = 0; i < vectorResultsLength; i++){
        const [resultId, score] = vectorResults[i];
        const normalizedScore = normalizeScore(score, maxVectorScore);
        const existingRes = mergedResults.get(resultId) ?? 0;
        mergedResults.set(resultId, existingRes + hybridScore(0, normalizedScore));
    }
    return [
        ...mergedResults
    ].sort((a, b)=>b[1] - a[1]);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getQueryWeights(query) {
    // In the next versions of Orama, we will ship a plugin containing a ML model to adjust the weights
    // based on whether the query is keyword-focused, conceptual, etc.
    // For now, we just return a fixed value.
    return {
        text: 0.5,
        vector: 0.5
    };
} //# sourceMappingURL=search-hybrid.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "fetchDocuments",
    ()=>fetchDocuments,
    "fetchDocumentsWithDistinct",
    ()=>fetchDocumentsWithDistinct,
    "search",
    ()=>search
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/internal-document-id-store.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/constants.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$fulltext$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-fulltext.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-vector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$hybrid$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-hybrid.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
function search(orama, params, language) {
    const mode = params.mode ?? __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MODE_FULLTEXT_SEARCH"];
    if (mode === __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MODE_FULLTEXT_SEARCH"]) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$fulltext$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fullTextSearch"])(orama, params, language);
    }
    if (mode === __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MODE_VECTOR_SEARCH"]) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["searchVector"])(orama, params);
    }
    if (mode === __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MODE_HYBRID_SEARCH"]) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$hybrid$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hybridSearch"])(orama, params);
    }
    throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('INVALID_SEARCH_MODE', mode);
}
function fetchDocumentsWithDistinct(orama, uniqueDocsArray, offset, limit, distinctOn) {
    const docs = orama.data.docs;
    // Keep track which values we already seen
    const values = new Map();
    // We cannot know how many results we will have in the end,
    // so we need cannot pre-allocate the array.
    const results = [];
    const resultIDs = new Set();
    const uniqueDocsArrayLength = uniqueDocsArray.length;
    let count = 0;
    for(let i = 0; i < uniqueDocsArrayLength; i++){
        const idAndScore = uniqueDocsArray[i];
        // If there are no more results, just break the loop
        if (typeof idAndScore === 'undefined') {
            continue;
        }
        const [id, score] = idAndScore;
        if (resultIDs.has(id)) {
            continue;
        }
        const doc = orama.documentsStore.get(docs, id);
        const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNested"])(doc, distinctOn);
        if (typeof value === 'undefined' || values.has(value)) {
            continue;
        }
        values.set(value, true);
        count++;
        // We shouldn't consider the document if it's not in the offset range
        if (count <= offset) {
            continue;
        }
        results.push({
            id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, id),
            score,
            document: doc
        });
        resultIDs.add(id);
        // reached the limit, break the loop
        if (count >= offset + limit) {
            break;
        }
    }
    return results;
}
function fetchDocuments(orama, uniqueDocsArray, offset, limit) {
    const docs = orama.data.docs;
    const results = Array.from({
        length: limit
    });
    const resultIDs = new Set();
    // We already have the list of ALL the document IDs containing the search terms.
    // We loop over them starting from a positional value "offset" and ending at "offset + limit"
    // to provide pagination capabilities to the search.
    for(let i = offset; i < limit + offset; i++){
        const idAndScore = uniqueDocsArray[i];
        // If there are no more results, just break the loop
        if (typeof idAndScore === 'undefined') {
            break;
        }
        const [id, score] = idAndScore;
        if (!resultIDs.has(id)) {
            // We retrieve the full document only AFTER making sure that we really want it.
            // We never retrieve the full document preventively.
            const fullDoc = orama.documentsStore.get(docs, id);
            results[i] = {
                id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$internal$2d$document$2d$id$2d$store$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDocumentIdFromInternalId"])(orama.internalDocumentIDStore, id),
                score,
                document: fullDoc
            };
            resultIDs.add(id);
        }
    }
    return results;
} //# sourceMappingURL=search.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/serialization.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "load",
    ()=>load,
    "save",
    ()=>save
]);
function load(orama, raw) {
    orama.internalDocumentIDStore.load(orama, raw.internalDocumentIDStore);
    orama.data.index = orama.index.load(orama.internalDocumentIDStore, raw.index);
    orama.data.docs = orama.documentsStore.load(orama.internalDocumentIDStore, raw.docs);
    orama.data.sorting = orama.sorter.load(orama.internalDocumentIDStore, raw.sorting);
    orama.data.pinning = orama.pinning.load(orama.internalDocumentIDStore, raw.pinning);
    orama.tokenizer.language = raw.language;
}
function save(orama) {
    return {
        internalDocumentIDStore: orama.internalDocumentIDStore.save(orama.internalDocumentIDStore),
        index: orama.index.save(orama.data.index),
        docs: orama.documentsStore.save(orama.data.docs),
        sorting: orama.sorter.save(orama.data.sorting),
        pinning: orama.pinning.save(orama.data.pinning),
        language: orama.tokenizer.language
    };
} //# sourceMappingURL=serialization.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/update.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "update",
    ()=>update,
    "updateMultiple",
    ()=>updateMultiple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/insert.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/remove.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
;
;
;
function update(orama, id, doc, language, skipHooks) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdate);
    if (asyncNeeded) {
        return updateAsync(orama, id, doc, language, skipHooks);
    }
    return updateSync(orama, id, doc, language, skipHooks);
}
async function updateAsync(orama, id, doc, language, skipHooks) {
    if (!skipHooks && orama.beforeUpdate) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeUpdate, orama, id);
    }
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["remove"])(orama, id, language, skipHooks);
    const newId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["insert"])(orama, doc, language, skipHooks);
    if (!skipHooks && orama.afterUpdate) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterUpdate, orama, newId);
    }
    return newId;
}
function updateSync(orama, id, doc, language, skipHooks) {
    if (!skipHooks && orama.beforeUpdate) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeUpdate, orama, id);
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["remove"])(orama, id, language, skipHooks);
    const newId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["insert"])(orama, doc, language, skipHooks);
    if (!skipHooks && orama.afterUpdate) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterUpdate, orama, newId);
    }
    return newId;
}
function updateMultiple(orama, ids, docs, batchSize, language, skipHooks) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdateMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdateMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemoveMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemoveMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsertMultiple);
    if (asyncNeeded) {
        return updateMultipleAsync(orama, ids, docs, batchSize, language, skipHooks);
    }
    return updateMultipleSync(orama, ids, docs, batchSize, language, skipHooks);
}
async function updateMultipleAsync(orama, ids, docs, batchSize, language, skipHooks) {
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeUpdateMultiple, orama, ids);
    }
    const docsLength = docs.length;
    for(let i = 0; i < docsLength; i++){
        const errorProperty = orama.validateSchema(docs[i], orama.schema);
        if (errorProperty) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["removeMultiple"])(orama, ids, batchSize, language, skipHooks);
    const newIds = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerInsertMultiple"])(orama, docs, batchSize, language, skipHooks);
    if (!skipHooks) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterUpdateMultiple, orama, newIds);
    }
    return newIds;
}
function updateMultipleSync(orama, ids, docs, batchSize, language, skipHooks) {
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeUpdateMultiple, orama, ids);
    }
    const docsLength = docs.length;
    for(let i = 0; i < docsLength; i++){
        const errorProperty = orama.validateSchema(docs[i], orama.schema);
        if (errorProperty) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["removeMultiple"])(orama, ids, batchSize, language, skipHooks);
    const newIds = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerInsertMultiple"])(orama, docs, batchSize, language, skipHooks);
    if (!skipHooks) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterUpdateMultiple, orama, newIds);
    }
    return newIds;
} //# sourceMappingURL=update.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/upsert.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "upsert",
    ()=>upsert,
    "upsertMultiple",
    ()=>upsertMultiple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/hooks.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/insert.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/update.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
;
;
;
;
;
function upsert(orama, doc, language, skipHooks, options) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.insert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterInsert);
    if (asyncNeeded) {
        return upsertAsync(orama, doc, language, skipHooks, options);
    }
    return upsertSync(orama, doc, language, skipHooks, options);
}
async function upsertAsync(orama, doc, language, skipHooks, options) {
    const id = orama.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    if (!skipHooks && orama.beforeUpsert) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeUpsert, orama, id, doc);
    }
    // Check if document exists
    const existingDoc = orama.documentsStore.get(orama.data.docs, id);
    let resultId;
    if (existingDoc) {
        // Document exists, update it
        resultId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["update"])(orama, id, doc, language, skipHooks);
    } else {
        // Document doesn't exist, insert it
        resultId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["insert"])(orama, doc, language, skipHooks, options);
    }
    if (!skipHooks && orama.afterUpsert) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterUpsert, orama, resultId, doc);
    }
    return resultId;
}
function upsertSync(orama, doc, language, skipHooks, options) {
    const id = orama.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    if (!skipHooks && orama.beforeUpsert) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.beforeUpsert, orama, id, doc);
    }
    // Check if document exists
    const existingDoc = orama.documentsStore.get(orama.data.docs, id);
    let resultId;
    if (existingDoc) {
        // Document exists, update it
        resultId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["update"])(orama, id, doc, language, skipHooks);
    } else {
        // Document doesn't exist, insert it
        resultId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["insert"])(orama, doc, language, skipHooks, options);
    }
    if (!skipHooks && orama.afterUpsert) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runSingleHook"])(orama.afterUpsert, orama, resultId, doc);
    }
    return resultId;
}
function upsertMultiple(orama, docs, batchSize, language, skipHooks) {
    const asyncNeeded = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemove) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdate) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeInsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterInsertMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeUpdateMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterUpdateMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.beforeRemoveMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.afterRemoveMultiple) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.beforeInsert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.insert) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAsyncFunction"])(orama.index.afterInsert);
    if (asyncNeeded) {
        return upsertMultipleAsync(orama, docs, batchSize, language, skipHooks);
    }
    return upsertMultipleSync(orama, docs, batchSize, language, skipHooks);
}
async function upsertMultipleAsync(orama, docs, batchSize, language, skipHooks) {
    if (!skipHooks && orama.beforeUpsertMultiple) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeUpsertMultiple, orama, docs);
    }
    // Validate all documents first
    const docsLength = docs.length;
    for(let i = 0; i < docsLength; i++){
        const errorProperty = orama.validateSchema(docs[i], orama.schema);
        if (errorProperty) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    // Separate documents into insert and update arrays
    const docsToInsert = [];
    const docsToUpdate = [];
    const idsToUpdate = [];
    for (const doc of docs){
        const id = orama.getDocumentIndexId(doc);
        if (typeof id !== 'string') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
        }
        const existingDoc = orama.documentsStore.get(orama.data.docs, id);
        if (existingDoc) {
            docsToUpdate.push(doc);
            idsToUpdate.push(id);
        } else {
            docsToInsert.push(doc);
        }
    }
    // Perform bulk operations
    const results = [];
    if (docsToUpdate.length > 0) {
        const updateResults = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["updateMultiple"])(orama, idsToUpdate, docsToUpdate, batchSize, language, skipHooks);
        results.push(...updateResults);
    }
    if (docsToInsert.length > 0) {
        const insertResults = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerInsertMultiple"])(orama, docsToInsert, batchSize, language, skipHooks);
        results.push(...insertResults);
    }
    if (!skipHooks && orama.afterUpsertMultiple) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterUpsertMultiple, orama, results);
    }
    return results;
}
function upsertMultipleSync(orama, docs, batchSize, language, skipHooks) {
    if (!skipHooks && orama.beforeUpsertMultiple) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.beforeUpsertMultiple, orama, docs);
    }
    // Validate all documents first
    const docsLength = docs.length;
    for(let i = 0; i < docsLength; i++){
        const errorProperty = orama.validateSchema(docs[i], orama.schema);
        if (errorProperty) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    // Separate documents into insert and update arrays
    const docsToInsert = [];
    const docsToUpdate = [];
    const idsToUpdate = [];
    for (const doc of docs){
        const id = orama.getDocumentIndexId(doc);
        if (typeof id !== 'string') {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('DOCUMENT_ID_MUST_BE_STRING', typeof id);
        }
        const existingDoc = orama.documentsStore.get(orama.data.docs, id);
        if (existingDoc) {
            docsToUpdate.push(doc);
            idsToUpdate.push(id);
        } else {
            docsToInsert.push(doc);
        }
    }
    // Perform bulk operations
    const results = [];
    if (docsToUpdate.length > 0) {
        const updateResults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["updateMultiple"])(orama, idsToUpdate, docsToUpdate, batchSize, language, skipHooks);
        results.push(...updateResults);
    }
    if (docsToInsert.length > 0) {
        const insertResults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["innerInsertMultiple"])(orama, docsToInsert, batchSize, language, skipHooks);
        results.push(...insertResults);
    }
    if (!skipHooks && orama.afterUpsertMultiple) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$hooks$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runMultipleHook"])(orama.afterUpsertMultiple, orama, results);
    }
    return results;
} //# sourceMappingURL=upsert.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/methods/answer-session.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AnswerSession",
    ()=>AnswerSession
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/errors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)");
;
;
const ORAMA_SECURE_PROXY_PLUGIN_NAME = 'orama-secure-proxy';
class AnswerSession {
    db;
    proxy = null;
    config;
    abortController = null;
    lastInteractionParams = null;
    chatModel = null;
    conversationID;
    messages = [];
    events;
    initPromise;
    state = [];
    constructor(db, config){
        this.db = db;
        this.config = config;
        this.init();
        this.messages = config.initialMessages || [];
        this.events = config.events || {};
        this.conversationID = config.conversationID || this.generateRandomID();
    }
    async ask(query) {
        await this.initPromise;
        let output = '';
        for await (const msg of (await this.askStream(query))){
            output += msg;
        }
        return output;
    }
    async askStream(query) {
        await this.initPromise;
        return this.fetchAnswer(query);
    }
    abortAnswer() {
        this.abortController?.abort();
        this.state[this.state.length - 1].aborted = true;
        this.triggerStateChange();
    }
    getMessages() {
        return this.messages;
    }
    clearSession() {
        this.messages = [];
        this.state = [];
    }
    regenerateLast({ stream = true }) {
        if (this.state.length === 0 || this.messages.length === 0) {
            throw new Error('No messages to regenerate');
        }
        const isLastMessageAssistant = this.messages.at(-1)?.role === 'assistant';
        if (!isLastMessageAssistant) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('ANSWER_SESSION_LAST_MESSAGE_IS_NOT_ASSISTANT');
        }
        this.messages.pop();
        this.state.pop();
        if (stream) {
            return this.askStream(this.lastInteractionParams);
        }
        return this.ask(this.lastInteractionParams);
    }
    async *fetchAnswer(params) {
        if (!this.chatModel) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('PLUGIN_SECURE_PROXY_MISSING_CHAT_MODEL');
        }
        this.abortController = new AbortController();
        this.lastInteractionParams = params;
        const interactionId = this.generateRandomID();
        this.messages.push({
            role: 'user',
            content: params.term ?? ''
        });
        this.state.push({
            interactionId,
            aborted: false,
            loading: true,
            query: params.term ?? '',
            response: '',
            sources: null,
            translatedQuery: null,
            error: false,
            errorMessage: null
        });
        const stateIdx = this.state.length - 1;
        this.addEmptyAssistantMessage();
        this.triggerStateChange();
        try {
            const sources = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["search"])(this.db, params);
            this.state[stateIdx].sources = sources;
            this.triggerStateChange();
            for await (const msg of this.proxy.chatStream({
                model: this.chatModel,
                messages: this.messages
            })){
                yield msg;
                this.state[stateIdx].response += msg;
                this.messages.findLast((msg)=>msg.role === 'assistant').content += msg;
                this.triggerStateChange();
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                this.state[stateIdx].aborted = true;
            } else {
                this.state[stateIdx].error = true;
                this.state[stateIdx].errorMessage = err.toString();
            }
            this.triggerStateChange();
        }
        this.state[stateIdx].loading = false;
        this.triggerStateChange();
        return this.state[stateIdx].response;
    }
    generateRandomID(length = 24) {
        return Array.from({
            length
        }, ()=>Math.floor(Math.random() * 36).toString(36)).join('');
    }
    triggerStateChange() {
        if (this.events.onStateChange) {
            this.events.onStateChange(this.state);
        }
    }
    async init() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        async function getPlugin() {
            return await self.db.plugins.find((plugin)=>plugin.name === ORAMA_SECURE_PROXY_PLUGIN_NAME);
        }
        const plugin = await getPlugin();
        if (!plugin) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('PLUGIN_SECURE_PROXY_NOT_FOUND');
        }
        const pluginExtras = plugin.extra;
        this.proxy = pluginExtras.proxy;
        if (this.config.systemPrompt) {
            this.messages.push({
                role: 'system',
                content: this.config.systemPrompt
            });
        }
        if (pluginExtras?.pluginParams?.chat?.model) {
            this.chatModel = pluginExtras.pluginParams.chat.model;
        } else {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$errors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createError"])('PLUGIN_SECURE_PROXY_MISSING_CHAT_MODEL');
        }
    }
    addEmptyAssistantMessage() {
        this.messages.push({
            role: 'assistant',
            content: ''
        });
    }
} //# sourceMappingURL=answer-session.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/types.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "kInsertions",
    ()=>kInsertions,
    "kRemovals",
    ()=>kRemovals
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$constants$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/constants.js [app-client] (ecmascript)");
;
const kInsertions = Symbol('orama.insertions');
const kRemovals = Symbol('orama.removals'); //# sourceMappingURL=types.js.map
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/internals.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$levenshtein$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/levenshtein.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2f$tokenizer$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components/tokenizer/index.js [app-client] (ecmascript)"); //# sourceMappingURL=internals.js.map
;
;
;
}),
"[project]/docs/node_modules/@orama/orama/dist/browser/index.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$create$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/create.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$docs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/docs.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$insert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/insert.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$pinning$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/pinning.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$remove$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/remove.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2d$vector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search-vector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$serialization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/serialization.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$update$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/update.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$upsert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/upsert.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$answer$2d$session$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/answer-session.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$types$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/types.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$components$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/components.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$internals$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/internals.js [app-client] (ecmascript) <locals>"); //# sourceMappingURL=index.js.map
;
;
;
;
;
;
;
;
;
;
;
;
;
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/chunk-XOFXGHS4.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "searchAdvanced",
    ()=>searchAdvanced,
    "searchSimple",
    ()=>searchSimple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$ZMWYLUDP$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-ZMWYLUDP.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$OTD7MV33$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-OTD7MV33.js [app-client] (ecmascript)");
// src/search/orama/search/simple.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/index.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/search.js [app-client] (ecmascript)");
// src/search/orama/search/advanced.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$docs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/docs.js [app-client] (ecmascript)");
;
;
;
async function searchSimple(db, query, params = {}) {
    const highlighter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$OTD7MV33$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContentHighlighter"])(query);
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["search"])(db, {
        term: query,
        tolerance: 1,
        ...params,
        boost: {
            title: 2,
            ..."boost" in params ? params.boost : void 0
        }
    });
    return result.hits.map((hit)=>({
            type: "page",
            content: hit.document.title,
            breadcrumbs: hit.document.breadcrumbs,
            contentWithHighlights: highlighter.highlight(hit.document.title),
            id: hit.document.url,
            url: hit.document.url
        }));
}
;
async function searchAdvanced(db, query, tag = [], { mode = "fulltext", ...override } = {}) {
    if (typeof tag === "string") tag = [
        tag
    ];
    let params = {
        ...override,
        mode,
        where: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$ZMWYLUDP$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["removeUndefined"])({
            tags: tag.length > 0 ? {
                containsAll: tag
            } : void 0,
            ...override.where
        }),
        groupBy: {
            properties: [
                "page_id"
            ],
            maxResult: 8,
            ...override.groupBy
        }
    };
    if (query.length > 0) {
        params = {
            ...params,
            term: query,
            properties: mode === "fulltext" ? [
                "content"
            ] : [
                "content",
                "embeddings"
            ]
        };
    }
    const highlighter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$OTD7MV33$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContentHighlighter"])(query);
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["search"])(db, params);
    const list = [];
    for (const item of result.groups ?? []){
        const pageId = item.values[0];
        const page = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$docs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getByID"])(db, pageId);
        if (!page) continue;
        list.push({
            id: pageId,
            type: "page",
            content: page.content,
            breadcrumbs: page.breadcrumbs,
            contentWithHighlights: highlighter.highlight(page.content),
            url: page.url
        });
        for (const hit of item.result){
            if (hit.document.type === "page") continue;
            list.push({
                id: hit.document.id.toString(),
                content: hit.document.content,
                breadcrumbs: hit.document.breadcrumbs,
                contentWithHighlights: highlighter.highlight(hit.document.content),
                type: hit.document.type,
                url: hit.document.url
            });
        }
    }
    return list;
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/static-A2YJ5TXV.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "search",
    ()=>search
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XOFXGHS4$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-XOFXGHS4.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$ZMWYLUDP$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-ZMWYLUDP.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$OTD7MV33$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-OTD7MV33.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$U67V476Y$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-U67V476Y.js [app-client] (ecmascript)");
// src/search/client/static.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/index.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$create$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/create.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$serialization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/@orama/orama/dist/browser/methods/serialization.js [app-client] (ecmascript)");
;
;
;
;
;
var cache = /* @__PURE__ */ new Map();
async function loadDB({ from = "/api/search", initOrama = (locale)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$create$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["create"])({
        schema: {
            _: "string"
        },
        language: locale
    }) }) {
    const cacheKey = from;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    async function init() {
        const res = await fetch(from);
        if (!res.ok) throw new Error(`failed to fetch exported search indexes from ${from}, make sure the search database is exported and available for client.`);
        const data = await res.json();
        const dbs = /* @__PURE__ */ new Map();
        if (data.type === "i18n") {
            await Promise.all(Object.entries(data.data).map(async ([k, v])=>{
                const db2 = await initOrama(k);
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$serialization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["load"])(db2, v);
                dbs.set(k, {
                    type: v.type,
                    db: db2
                });
            }));
            return dbs;
        }
        const db = await initOrama();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f40$orama$2f$orama$2f$dist$2f$browser$2f$methods$2f$serialization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["load"])(db, data);
        dbs.set("", {
            type: data.type,
            db
        });
        return dbs;
    }
    const result = init();
    cache.set(cacheKey, result);
    return result;
}
async function search(query, options) {
    const { tag, locale } = options;
    const db = (await loadDB(options)).get(locale ?? "");
    if (!db) return [];
    if (db.type === "simple") return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XOFXGHS4$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["searchSimple"])(db, query);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XOFXGHS4$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["searchAdvanced"])(db.db, query, tag);
}
;
}),
]);

//# sourceMappingURL=126f3_5b5b1275._.js.map