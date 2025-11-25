module.exports = [
"[project]/docs/node_modules/fumadocs-core/dist/chunk-FAEPKD7U.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/source/plugins/icon.ts
__turbopack_context__.s([
    "iconPlugin",
    ()=>iconPlugin
]);
function iconPlugin(resolveIcon) {
    function replaceIcon(node) {
        if (node.icon === void 0 || typeof node.icon === "string") node.icon = resolveIcon(node.icon);
        return node;
    }
    return {
        name: "fumadocs:icon",
        transformPageTree: {
            file: replaceIcon,
            folder: replaceIcon,
            separator: replaceIcon
        }
    };
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/chunk-U67V476Y.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "__commonJS",
    ()=>__commonJS,
    "__export",
    ()=>__export,
    "__toESM",
    ()=>__toESM
]);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod)=>function __require() {
        return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = {
            exports: {}
        }).exports, mod), mod.exports;
    };
var __export = (target, all)=>{
    for(var name in all)__defProp(target, name, {
        get: all[name],
        enumerable: true
    });
};
var __copyProps = (to, from, except, desc)=>{
    if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
            get: ()=>from[key],
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
    }
    return to;
};
var __toESM = (mod, isNodeMode, target)=>(target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(// If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
        value: mod,
        enumerable: true
    }) : target, mod));
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/chunk-XZSI7AHE.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "basename",
    ()=>basename,
    "dirname",
    ()=>dirname,
    "extname",
    ()=>extname,
    "joinPath",
    ()=>joinPath,
    "path_exports",
    ()=>path_exports,
    "slash",
    ()=>slash,
    "splitPath",
    ()=>splitPath
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$U67V476Y$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-U67V476Y.js [app-rsc] (ecmascript)");
;
// src/source/path.ts
var path_exports = {};
(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$U67V476Y$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["__export"])(path_exports, {
    basename: ()=>basename,
    dirname: ()=>dirname,
    extname: ()=>extname,
    joinPath: ()=>joinPath,
    slash: ()=>slash,
    splitPath: ()=>splitPath
});
function basename(path, ext) {
    const idx = path.lastIndexOf("/");
    return path.substring(idx === -1 ? 0 : idx + 1, ext ? path.length - ext.length : path.length);
}
function extname(path) {
    const dotIdx = path.lastIndexOf(".");
    if (dotIdx !== -1) {
        return path.substring(dotIdx);
    }
    return "";
}
function dirname(path) {
    return path.split("/").slice(0, -1).join("/");
}
function splitPath(path) {
    return path.split("/").filter((p)=>p.length > 0);
}
function joinPath(...paths) {
    const out = [];
    const parsed = paths.flatMap(splitPath);
    for (const seg of parsed){
        switch(seg){
            case "..":
                out.pop();
                break;
            case ".":
                break;
            default:
                out.push(seg);
        }
    }
    return out.join("/");
}
function slash(path) {
    const isExtendedLengthPath = path.startsWith("\\\\?\\");
    if (isExtendedLengthPath) {
        return path;
    }
    return path.replaceAll("\\", "/");
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/chunk-PFNP6PEB.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/utils/normalize-url.tsx
__turbopack_context__.s([
    "normalizeUrl",
    ()=>normalizeUrl
]);
function normalizeUrl(url) {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (!url.startsWith("/")) url = "/" + url;
    if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
    return url;
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/source/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileSystem",
    ()=>FileSystem,
    "createGetUrl",
    ()=>createGetUrl,
    "getSlugs",
    ()=>getSlugs,
    "loader",
    ()=>loader,
    "map",
    ()=>map,
    "multiple",
    ()=>multiple
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$FAEPKD7U$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-FAEPKD7U.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-XZSI7AHE.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$PFNP6PEB$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-PFNP6PEB.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$U67V476Y$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/chunk-U67V476Y.js [app-rsc] (ecmascript)");
;
;
;
;
// src/source/source.ts
function multiple(sources) {
    const out = {
        files: []
    };
    for (const [type, source] of Object.entries(sources)){
        for (const file of source.files){
            out.files.push({
                ...file,
                data: {
                    ...file.data,
                    type
                }
            });
        }
    }
    return out;
}
function map(source) {
    return {
        page (fn) {
            return {
                files: source.files.map((file)=>file.type === "page" ? fn(file) : file)
            };
        },
        meta (fn) {
            return {
                files: source.files.map((file)=>file.type === "meta" ? fn(file) : file)
            };
        }
    };
}
// src/source/storage/file-system.ts
var FileSystem = class {
    constructor(inherit){
        this.files = /* @__PURE__ */ new Map();
        this.folders = /* @__PURE__ */ new Map();
        if (inherit) {
            for (const [k, v1] of inherit.folders){
                this.folders.set(k, v1);
            }
            for (const [k, v1] of inherit.files){
                this.files.set(k, v1);
            }
        } else {
            this.folders.set("", []);
        }
    }
    read(path) {
        return this.files.get(path);
    }
    /**
   * get the direct children of folder (in virtual file path)
   */ readDir(path) {
        return this.folders.get(path);
    }
    write(path, file) {
        if (!this.files.has(path)) {
            const dir = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["dirname"])(path);
            this.makeDir(dir);
            this.readDir(dir)?.push(path);
        }
        this.files.set(path, file);
    }
    /**
   * Delete files at specified path.
   *
   * @param path - the target path.
   * @param [recursive=false] - if set to `true`, it will also delete directories.
   */ delete(path, recursive = false) {
        if (this.files.delete(path)) return true;
        if (recursive) {
            const folder = this.folders.get(path);
            if (!folder) return false;
            this.folders.delete(path);
            for (const child of folder){
                this.delete(child);
            }
            return true;
        }
        return false;
    }
    getFiles() {
        return Array.from(this.files.keys());
    }
    makeDir(path) {
        const segments = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["splitPath"])(path);
        for(let i = 0; i < segments.length; i++){
            const segment = segments.slice(0, i + 1).join("/");
            if (this.folders.has(segment)) continue;
            this.folders.set(segment, []);
            this.folders.get((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["dirname"])(segment)).push(segment);
        }
    }
};
// src/source/storage/content.ts
function isLocaleValid(locale) {
    return locale.length > 0 && !/\d+/.test(locale);
}
var parsers = {
    dir (path) {
        const [locale, ...segs] = path.split("/");
        if (locale && segs.length > 0 && isLocaleValid(locale)) return [
            segs.join("/"),
            locale
        ];
        return [
            path
        ];
    },
    dot (path) {
        const dir = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["dirname"])(path);
        const base = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(path);
        const parts = base.split(".");
        if (parts.length < 3) return [
            path
        ];
        const [locale] = parts.splice(parts.length - 2, 1);
        if (!isLocaleValid(locale)) return [
            path
        ];
        return [
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinPath"])(dir, parts.join(".")),
            locale
        ];
    },
    none (path) {
        return [
            path
        ];
    }
};
function buildContentStorage(loaderConfig, defaultLanguage) {
    const { source, plugins = [], i18n = {
        defaultLanguage,
        parser: "none",
        languages: [
            defaultLanguage
        ]
    } } = loaderConfig;
    const parser = parsers[i18n.parser ?? "dot"];
    const storages = {};
    const normalized = /* @__PURE__ */ new Map();
    for (const inputFile of source.files){
        let file;
        if (inputFile.type === "page") {
            file = {
                format: "page",
                path: normalizePath(inputFile.path),
                // will be generated by the slugs plugin if unspecified
                slugs: inputFile.slugs,
                data: inputFile.data,
                absolutePath: inputFile.absolutePath
            };
        } else {
            file = {
                format: "meta",
                path: normalizePath(inputFile.path),
                absolutePath: inputFile.absolutePath,
                data: inputFile.data
            };
        }
        const [pathWithoutLocale, locale = i18n.defaultLanguage] = parser(file.path);
        const list = normalized.get(locale) ?? [];
        list.push({
            pathWithoutLocale,
            file
        });
        normalized.set(locale, list);
    }
    const fallbackLang = i18n.fallbackLanguage !== null ? i18n.fallbackLanguage ?? i18n.defaultLanguage : null;
    function scan(lang) {
        if (storages[lang]) return;
        let storage;
        if (fallbackLang && fallbackLang !== lang) {
            scan(fallbackLang);
            storage = new FileSystem(storages[fallbackLang]);
        } else {
            storage = new FileSystem();
        }
        for (const { pathWithoutLocale, file } of normalized.get(lang) ?? []){
            storage.write(pathWithoutLocale, file);
        }
        const context = {
            storage
        };
        for (const plugin of plugins){
            plugin.transformStorage?.(context);
        }
        storages[lang] = storage;
    }
    for (const lang of i18n.languages)scan(lang);
    return storages;
}
function normalizePath(path) {
    const segments = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["splitPath"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slash"])(path));
    if (segments[0] === "." || segments[0] === "..") throw new Error("It must not start with './' or '../'");
    return segments.join("/");
}
// src/source/page-tree/transformer-fallback.ts
function transformerFallback() {
    const addedFiles = /* @__PURE__ */ new Set();
    return {
        root (root) {
            const isolatedStorage = new FileSystem();
            for (const file of this.storage.getFiles()){
                if (addedFiles.has(file)) continue;
                const content = this.storage.read(file);
                if (content) isolatedStorage.write(file, content);
            }
            if (isolatedStorage.getFiles().length === 0) return root;
            root.fallback = this.builder.build(isolatedStorage, {
                ...this.options,
                id: `fallback-${root.$id ?? ""}`,
                generateFallback: false
            });
            addedFiles.clear();
            return root;
        },
        file (node, file) {
            if (file) addedFiles.add(file);
            return node;
        },
        folder (node, _dir, metaPath) {
            if (metaPath) addedFiles.add(metaPath);
            return node;
        }
    };
}
// src/source/page-tree/builder.ts
var group = /^\((?<name>.+)\)$/;
var link = /^(?<external>external:)?(?:\[(?<icon>[^\]]+)])?\[(?<name>[^\]]+)]\((?<url>[^)]+)\)$/;
var separator = /^---(?:\[(?<icon>[^\]]+)])?(?<name>.+)---|^---$/;
var rest = "...";
var restReversed = "z...a";
var extractPrefix = "...";
var excludePrefix = "!";
function createPageTreeBuilder(loaderConfig) {
    const { plugins = [], url, pageTree: defaultOptions = {} } = loaderConfig;
    return {
        build (storage, options = defaultOptions) {
            const key = "";
            return this.buildI18n({
                [key]: storage
            }, options)[key];
        },
        buildI18n (storages, options = defaultOptions) {
            let nextId = 0;
            const out = {};
            const transformers = [];
            if (options.transformers) {
                transformers.push(...options.transformers);
            }
            for (const plugin of plugins){
                if (plugin.transformPageTree) transformers.push(plugin.transformPageTree);
            }
            if (options.generateFallback ?? true) {
                transformers.push(transformerFallback());
            }
            for (const [locale, storage] of Object.entries(storages)){
                let rootId = locale.length === 0 ? "root" : locale;
                if (options.id) rootId = `${options.id}-${rootId}`;
                out[locale] = createPageTreeBuilderUtils({
                    rootId,
                    transformers,
                    builder: this,
                    options,
                    getUrl: url,
                    locale,
                    storage,
                    storages,
                    generateNodeId () {
                        return "_" + nextId++;
                    }
                }).root();
            }
            return out;
        }
    };
}
function createFlattenPathResolver(storage) {
    const map2 = /* @__PURE__ */ new Map();
    const files = storage.getFiles();
    for (const file of files){
        const content = storage.read(file);
        const flattenPath = file.substring(0, file.length - (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["extname"])(file).length);
        map2.set(flattenPath + "." + content.format, file);
    }
    return (name, format)=>{
        return map2.get(name + "." + format) ?? name;
    };
}
function createPageTreeBuilderUtils(ctx) {
    const resolveFlattenPath = createFlattenPathResolver(ctx.storage);
    const visitedPaths = /* @__PURE__ */ new Set();
    function nextNodeId(localId = ctx.generateNodeId()) {
        return `${ctx.rootId}:${localId}`;
    }
    return {
        buildPaths (paths, reversed = false) {
            const items = [];
            const folders = [];
            const sortedPaths = paths.sort((a, b)=>a.localeCompare(b) * (reversed ? -1 : 1));
            for (const path of sortedPaths){
                const fileNode = this.file(path);
                if (fileNode) {
                    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(path, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["extname"])(path)) === "index") items.unshift(fileNode);
                    else items.push(fileNode);
                    continue;
                }
                const dirNode = this.folder(path, false);
                if (dirNode) folders.push(dirNode);
            }
            return [
                ...items,
                ...folders
            ];
        },
        resolveFolderItem (folderPath, item) {
            if (item === rest || item === restReversed) return item;
            let match = separator.exec(item);
            if (match?.groups) {
                let node = {
                    $id: nextNodeId(),
                    type: "separator",
                    icon: match.groups.icon,
                    name: match.groups.name
                };
                for (const transformer of ctx.transformers){
                    if (!transformer.separator) continue;
                    node = transformer.separator.call(ctx, node);
                }
                return [
                    node
                ];
            }
            match = link.exec(item);
            if (match?.groups) {
                const { icon, url, name, external } = match.groups;
                let node = {
                    $id: nextNodeId(),
                    type: "page",
                    icon,
                    name,
                    url,
                    external: external ? true : void 0
                };
                for (const transformer of ctx.transformers){
                    if (!transformer.file) continue;
                    node = transformer.file.call(ctx, node);
                }
                return [
                    node
                ];
            }
            const isExcept = item.startsWith(excludePrefix);
            const isExtract = !isExcept && item.startsWith(extractPrefix);
            let filename = item;
            if (isExcept) {
                filename = item.slice(excludePrefix.length);
            } else if (isExtract) {
                filename = item.slice(extractPrefix.length);
            }
            const path = resolveFlattenPath((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinPath"])(folderPath, filename), "page");
            if (isExcept) {
                visitedPaths.add(path);
                return [];
            }
            const dirNode = this.folder(path, false);
            if (dirNode) {
                return isExtract ? dirNode.children : [
                    dirNode
                ];
            }
            const fileNode = this.file(path);
            return fileNode ? [
                fileNode
            ] : [];
        },
        folder (folderPath, isGlobalRoot) {
            const { storage, options, transformers } = ctx;
            const files = storage.readDir(folderPath);
            if (!files) return;
            const metaPath = resolveFlattenPath((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinPath"])(folderPath, "meta"), "meta");
            const indexPath = resolveFlattenPath((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinPath"])(folderPath, "index"), "page");
            let meta = storage.read(metaPath);
            if (meta?.format !== "meta") {
                meta = void 0;
            }
            const isRoot = meta?.data.root ?? isGlobalRoot;
            let index;
            let children;
            if (meta && meta.data.pages) {
                const resolved = meta.data.pages.flatMap((item)=>this.resolveFolderItem(folderPath, item));
                if (!isRoot && !visitedPaths.has(indexPath)) {
                    index = this.file(indexPath);
                }
                for(let i = 0; i < resolved.length; i++){
                    const item = resolved[i];
                    if (item !== rest && item !== restReversed) continue;
                    const items = this.buildPaths(files.filter((file)=>!visitedPaths.has(file)), item === restReversed);
                    resolved.splice(i, 1, ...items);
                    break;
                }
                children = resolved;
            } else {
                if (!isRoot && !visitedPaths.has(indexPath)) {
                    index = this.file(indexPath);
                }
                children = this.buildPaths(files.filter((file)=>!visitedPaths.has(file)));
            }
            let name = meta?.data.title ?? index?.name;
            if (!name) {
                const folderName = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(folderPath);
                name = pathToName(group.exec(folderName)?.[1] ?? folderName);
            }
            let node = {
                type: "folder",
                name,
                icon: meta?.data.icon ?? index?.icon,
                root: meta?.data.root,
                defaultOpen: meta?.data.defaultOpen,
                description: meta?.data.description,
                index,
                children,
                $id: nextNodeId(folderPath),
                $ref: !options.noRef && meta ? {
                    metaFile: metaPath
                } : void 0
            };
            visitedPaths.add(folderPath);
            for (const transformer of transformers){
                if (!transformer.folder) continue;
                node = transformer.folder.call(ctx, node, folderPath, metaPath);
            }
            return node;
        },
        file (path) {
            const { options, getUrl, storage, locale, transformers } = ctx;
            const page = storage.read(path);
            if (page?.format !== "page") return;
            const { title, description, icon } = page.data;
            let item = {
                $id: nextNodeId(path),
                type: "page",
                name: title ?? pathToName((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(path, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["extname"])(path))),
                description,
                icon,
                url: getUrl(page.slugs, locale),
                $ref: !options.noRef ? {
                    file: path
                } : void 0
            };
            visitedPaths.add(path);
            for (const transformer of transformers){
                if (!transformer.file) continue;
                item = transformer.file.call(ctx, item, path);
            }
            return item;
        },
        root () {
            const folder = this.folder("", true);
            let root = {
                $id: ctx.rootId,
                name: folder.name || "Docs",
                children: folder.children
            };
            for (const transformer of ctx.transformers){
                if (!transformer.root) continue;
                root = transformer.root.call(ctx, root);
            }
            return root;
        }
    };
}
function pathToName(name) {
    const result = [];
    for (const c of name){
        if (result.length === 0) result.push(c.toLocaleUpperCase());
        else if (c === "-") result.push(" ");
        else result.push(c);
    }
    return result.join("");
}
// src/source/plugins/index.ts
var priorityMap = {
    pre: 1,
    default: 0,
    post: -1
};
function buildPlugins(plugins, sort = true) {
    const flatten = [];
    for (const plugin of plugins){
        if (Array.isArray(plugin)) flatten.push(...buildPlugins(plugin, false));
        else if (plugin) flatten.push(plugin);
    }
    if (sort) return flatten.sort((a, b)=>priorityMap[b.enforce ?? "default"] - priorityMap[a.enforce ?? "default"]);
    return flatten;
}
// src/source/plugins/slugs.ts
function slugsPlugin(slugsFn) {
    function isIndex(file) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(file, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["extname"])(file)) === "index";
    }
    return {
        name: "fumadocs:slugs",
        transformStorage ({ storage }) {
            const indexFiles = /* @__PURE__ */ new Set();
            const taken = /* @__PURE__ */ new Set();
            const autoIndex = slugsFn === void 0;
            for (const path of storage.getFiles()){
                const file = storage.read(path);
                if (!file || file.format !== "page" || file.slugs) continue;
                if (isIndex(path) && autoIndex) {
                    indexFiles.add(path);
                    continue;
                }
                file.slugs = slugsFn ? slugsFn({
                    path
                }) : getSlugs(path);
                const key = file.slugs.join("/");
                if (taken.has(key)) throw new Error("Duplicated slugs");
                taken.add(key);
            }
            for (const path of indexFiles){
                const file = storage.read(path);
                if (file?.format !== "page") continue;
                file.slugs = getSlugs(path);
                if (taken.has(file.slugs.join("/"))) file.slugs.push("index");
            }
        }
    };
}
var GroupRegex = /^\(.+\)$/;
function getSlugs(file) {
    const dir = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["dirname"])(file);
    const name = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["basename"])(file, (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["extname"])(file));
    const slugs = [];
    for (const seg of dir.split("/")){
        if (seg.length > 0 && !GroupRegex.test(seg)) slugs.push(encodeURI(seg));
    }
    if (GroupRegex.test(name)) throw new Error(`Cannot use folder group in file names: ${file}`);
    if (name !== "index") {
        slugs.push(encodeURI(name));
    }
    return slugs;
}
// src/source/loader.ts
function indexPages(storages, { url }) {
    const result = {
        // (locale.slugs -> page)
        pages: /* @__PURE__ */ new Map(),
        // (locale.path -> page)
        pathToMeta: /* @__PURE__ */ new Map(),
        // (locale.path -> meta)
        pathToPage: /* @__PURE__ */ new Map()
    };
    for (const [lang, storage] of Object.entries(storages)){
        for (const filePath of storage.getFiles()){
            const item = storage.read(filePath);
            const path = `${lang}.${filePath}`;
            if (item.format === "meta") {
                result.pathToMeta.set(path, {
                    path: item.path,
                    absolutePath: item.absolutePath,
                    data: item.data
                });
                continue;
            }
            const page = {
                absolutePath: item.absolutePath,
                path: item.path,
                url: url(item.slugs, lang),
                slugs: item.slugs,
                data: item.data,
                locale: lang
            };
            result.pathToPage.set(path, page);
            result.pages.set(`${lang}.${page.slugs.join("/")}`, page);
        }
    }
    return result;
}
function createGetUrl(baseUrl, i18n) {
    const baseSlugs = baseUrl.split("/");
    return (slugs, locale)=>{
        const hideLocale = i18n?.hideLocale ?? "never";
        let urlLocale;
        if (hideLocale === "never") {
            urlLocale = locale;
        } else if (hideLocale === "default-locale" && locale !== i18n?.defaultLanguage) {
            urlLocale = locale;
        }
        const paths = [
            ...baseSlugs,
            ...slugs
        ];
        if (urlLocale) paths.unshift(urlLocale);
        return `/${paths.filter((v1)=>v1.length > 0).join("/")}`;
    };
}
function loader(...args) {
    const resolved = args.length === 2 ? resolveConfig(args[0], args[1]) : resolveConfig(args[0].source, args[0]);
    return createOutput(resolved);
}
function resolveConfig(source, { slugs, icon, plugins = [], baseUrl, url, ...base }) {
    let config = {
        ...base,
        url: url ? (...args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$PFNP6PEB$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["normalizeUrl"])(url(...args)) : createGetUrl(baseUrl, base.i18n),
        source,
        plugins: buildPlugins([
            slugsPlugin(slugs),
            icon && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$FAEPKD7U$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["iconPlugin"])(icon),
            ...typeof plugins === "function" ? plugins({
                typedPlugin: (plugin)=>plugin
            }) : plugins
        ])
    };
    for (const plugin of config.plugins ?? []){
        const result = plugin.config?.(config);
        if (result) config = result;
    }
    return config;
}
function createOutput(loaderConfig) {
    const { i18n } = loaderConfig;
    const defaultLanguage = i18n?.defaultLanguage ?? "";
    const storages = buildContentStorage(loaderConfig, defaultLanguage);
    const walker = indexPages(storages, loaderConfig);
    const builder = createPageTreeBuilder(loaderConfig);
    let pageTree;
    return {
        _i18n: i18n,
        get pageTree () {
            pageTree ??= builder.buildI18n(storages);
            return i18n ? pageTree : pageTree[defaultLanguage];
        },
        set pageTree (v){
            if (i18n) {
                pageTree = v;
            } else {
                pageTree = {
                    [defaultLanguage]: v
                };
            }
        },
        getPageByHref (href, { dir = "", language = defaultLanguage } = {}) {
            const [value, hash] = href.split("#", 2);
            let target;
            if (value.startsWith(".") && (value.endsWith(".md") || value.endsWith(".mdx"))) {
                const path = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$chunk$2d$XZSI7AHE$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinPath"])(dir, value);
                target = walker.pathToPage.get(`${language}.${path}`);
            } else {
                target = this.getPages(language).find((item)=>item.url === value);
            }
            if (target) return {
                page: target,
                hash
            };
        },
        getPages (language) {
            const pages = [];
            for (const [key, value] of walker.pages.entries()){
                if (language === void 0 || key.startsWith(`${language}.`)) {
                    pages.push(value);
                }
            }
            return pages;
        },
        getLanguages () {
            const list = [];
            if (!i18n) return list;
            for (const language of i18n.languages){
                list.push({
                    language,
                    pages: this.getPages(language)
                });
            }
            return list;
        },
        // the slugs plugin generates encoded slugs by default.
        // we can assume page slugs are always URI encoded.
        getPage (slugs = [], language = defaultLanguage) {
            let page = walker.pages.get(`${language}.${slugs.join("/")}`);
            if (page) return page;
            page = walker.pages.get(`${language}.${slugs.map(decodeURI).join("/")}`);
            if (page) return page;
        },
        getNodeMeta (node, language = defaultLanguage) {
            const ref = node.$ref?.metaFile;
            if (!ref) return;
            return walker.pathToMeta.get(`${language}.${ref}`);
        },
        getNodePage (node, language = defaultLanguage) {
            const ref = node.$ref?.file;
            if (!ref) return;
            return walker.pathToPage.get(`${language}.${ref}`);
        },
        getPageTree (locale) {
            if (i18n) {
                return this.pageTree[locale ?? defaultLanguage];
            }
            return this.pageTree;
        },
        // @ts-expect-error -- ignore this
        generateParams (slug, lang) {
            if (i18n) {
                return this.getLanguages().flatMap((entry)=>entry.pages.map((page)=>({
                            [slug ?? "slug"]: page.slugs,
                            [lang ?? "lang"]: entry.language
                        })));
            }
            return this.getPages().map((page)=>({
                    [slug ?? "slug"]: page.slugs
                }));
        }
    };
}
;
}),
"[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const __TURBOPACK__default__export__ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call the default export of [project]/docs/node_modules/fumadocs-core/dist/link.js <module evaluation> from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-core/dist/link.js <module evaluation>", "default");
}),
"[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const __TURBOPACK__default__export__ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call the default export of [project]/docs/node_modules/fumadocs-core/dist/link.js from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-core/dist/link.js", "default");
}),
"[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-mdx/dist/chunk-5OBUOALK.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/runtime/server.ts
__turbopack_context__.s([
    "server",
    ()=>server,
    "toFumadocsSource",
    ()=>toFumadocsSource
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
function server(options = {}) {
    const { doc: { passthroughs: docPassthroughs = [] } = {} } = options;
    function fileInfo(file, base) {
        if (file.startsWith("./")) {
            file = file.slice(2);
        }
        return {
            path: file,
            fullPath: __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"](base, file)
        };
    }
    function mapDocData(entry) {
        const data = {
            body: entry.default,
            toc: entry.toc,
            structuredData: entry.structuredData,
            _exports: entry
        };
        for (const key of docPassthroughs){
            data[key] = entry[key];
        }
        return data;
    }
    return {
        async doc (_name, base, glob) {
            const out = await Promise.all(Object.entries(glob).map(async ([k, v])=>{
                const data = typeof v === "function" ? await v() : v;
                return {
                    ...mapDocData(data),
                    ...data.frontmatter,
                    ...createDocMethods(fileInfo(k, base), ()=>data)
                };
            }));
            return out;
        },
        async docLazy (_name, base, head, body) {
            const out = await Promise.all(Object.entries(head).map(async ([k, v])=>{
                const data = typeof v === "function" ? await v() : v;
                const content = body[k];
                return {
                    ...data,
                    ...createDocMethods(fileInfo(k, base), content),
                    async load () {
                        return mapDocData(await content());
                    }
                };
            }));
            return out;
        },
        async meta (_name, base, glob) {
            const out = await Promise.all(Object.entries(glob).map(async ([k, v])=>{
                const data = typeof v === "function" ? await v() : v;
                return {
                    info: fileInfo(k, base),
                    ...data
                };
            }));
            return out;
        },
        async docs (name, base, metaGlob, docGlob) {
            const entry = {
                docs: await this.doc(name, base, docGlob),
                meta: await this.meta(name, base, metaGlob),
                toFumadocsSource () {
                    return toFumadocsSource(this.docs, this.meta);
                }
            };
            return entry;
        },
        async docsLazy (name, base, metaGlob, docHeadGlob, docBodyGlob) {
            const entry = {
                docs: await this.docLazy(name, base, docHeadGlob, docBodyGlob),
                meta: await this.meta(name, base, metaGlob),
                toFumadocsSource () {
                    return toFumadocsSource(this.docs, this.meta);
                }
            };
            return entry;
        }
    };
}
function toFumadocsSource(pages, metas) {
    const files = [];
    for (const entry of pages){
        files.push({
            type: "page",
            path: entry.info.path,
            absolutePath: entry.info.fullPath,
            data: entry
        });
    }
    for (const entry of metas){
        files.push({
            type: "meta",
            path: entry.info.path,
            absolutePath: entry.info.fullPath,
            data: entry
        });
    }
    return {
        files
    };
}
function createDocMethods(info, load) {
    return {
        info,
        async getText (type) {
            if (type === "raw") {
                const fs = await __turbopack_context__.A("[externals]/fs/promises [external] (fs/promises, cjs, async loader)");
                return (await fs.readFile(info.fullPath)).toString();
            }
            const data = await load();
            if (typeof data._markdown !== "string") throw new Error("getText('processed') requires `includeProcessedMarkdown` to be enabled in your collection config.");
            return data._markdown;
        },
        async getMDAST () {
            const data = await load();
            if (!data._mdast) throw new Error("getMDAST() requires `includeMDAST` to be enabled in your collection config.");
            return JSON.parse(data._mdast);
        }
    };
}
;
}),
"[project]/docs/node_modules/fumadocs-mdx/dist/runtime/server.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$mdx$2f$dist$2f$chunk$2d$5OBUOALK$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-mdx/dist/chunk-5OBUOALK.js [app-rsc] (ecmascript)");
;
;
}),
"[project]/docs/node_modules/clsx/dist/clsx.mjs [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "clsx",
    ()=>clsx,
    "default",
    ()=>__TURBOPACK__default__export__
]);
function r(e) {
    var t, f, n = "";
    if ("string" == typeof e || "number" == typeof e) n += e;
    else if ("object" == typeof e) if (Array.isArray(e)) {
        var o = e.length;
        for(t = 0; t < o; t++)e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
    } else for(f in e)e[f] && (n && (n += " "), n += f);
    return n;
}
function clsx() {
    for(var e, t, f = 0, n = "", o = arguments.length; f < o; f++)(e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
    return n;
}
const __TURBOPACK__default__export__ = clsx;
}),
"[project]/docs/node_modules/class-variance-authority/dist/index.mjs [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Copyright 2022 Joe Bell. All rights reserved.
 *
 * This file is licensed to you under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR REPRESENTATIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */ __turbopack_context__.s([
    "cva",
    ()=>cva,
    "cx",
    ()=>cx
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/clsx/dist/clsx.mjs [app-rsc] (ecmascript)");
;
const falsyToString = (value)=>typeof value === "boolean" ? `${value}` : value === 0 ? "0" : value;
const cx = __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["clsx"];
const cva = (base, config)=>(props)=>{
        var _config_compoundVariants;
        if ((config === null || config === void 0 ? void 0 : config.variants) == null) return cx(base, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
        const { variants, defaultVariants } = config;
        const getVariantClassNames = Object.keys(variants).map((variant)=>{
            const variantProp = props === null || props === void 0 ? void 0 : props[variant];
            const defaultVariantProp = defaultVariants === null || defaultVariants === void 0 ? void 0 : defaultVariants[variant];
            if (variantProp === null) return null;
            const variantKey = falsyToString(variantProp) || falsyToString(defaultVariantProp);
            return variants[variant][variantKey];
        });
        const propsWithoutUndefined = props && Object.entries(props).reduce((acc, param)=>{
            let [key, value] = param;
            if (value === undefined) {
                return acc;
            }
            acc[key] = value;
            return acc;
        }, {});
        const getCompoundVariantClassNames = config === null || config === void 0 ? void 0 : (_config_compoundVariants = config.compoundVariants) === null || _config_compoundVariants === void 0 ? void 0 : _config_compoundVariants.reduce((acc, param)=>{
            let { class: cvClass, className: cvClassName, ...compoundVariantOptions } = param;
            return Object.entries(compoundVariantOptions).every((param)=>{
                let [key, value] = param;
                return Array.isArray(value) ? value.includes({
                    ...defaultVariants,
                    ...propsWithoutUndefined
                }[key]) : ({
                    ...defaultVariants,
                    ...propsWithoutUndefined
                })[key] === value;
            }) ? [
                ...acc,
                cvClass,
                cvClassName
            ] : acc;
        }, []);
        return cx(base, getVariantClassNames, getCompoundVariantClassNames, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
    };
}),
];

//# sourceMappingURL=126f3_4e1bea3c._.js.map