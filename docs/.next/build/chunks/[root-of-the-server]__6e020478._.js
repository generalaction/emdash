module.exports = [
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[turbopack-node]/transforms/transforms.ts [webpack_loaders] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Shared utilities for our 2 transform implementations.
 */ __turbopack_context__.s([
    "fromPath",
    ()=>fromPath,
    "getReadEnvVariables",
    ()=>getReadEnvVariables,
    "toPath",
    ()=>toPath
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
const contextDir = process.cwd();
const toPath = (file)=>{
    const relPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["relative"])(contextDir, file);
    if ((0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"])(relPath)) {
        throw new Error(`Cannot depend on path (${file}) outside of root directory (${contextDir})`);
    }
    return __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"] !== '/' ? relPath.replaceAll(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"], '/') : relPath;
};
const fromPath = (path)=>{
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(/* turbopackIgnore: true */ contextDir, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"] !== '/' ? path.replaceAll('/', __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"]) : path);
};
// Patch process.env to track which env vars are read
const originalEnv = process.env;
const readEnvVars = new Set();
process.env = new Proxy(originalEnv, {
    get (target, prop) {
        if (typeof prop === 'string') {
            // We register the env var as dependency on the
            // current transform and all future transforms
            // since the env var might be cached in module scope
            // and influence them all
            readEnvVars.add(prop);
        }
        return Reflect.get(target, prop);
    },
    set (target, prop, value) {
        return Reflect.set(target, prop, value);
    }
});
function getReadEnvVariables() {
    return Array.from(readEnvVars);
}
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/loader-runner [external] (next/dist/compiled/loader-runner, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/loader-runner", () => require("next/dist/compiled/loader-runner"));

module.exports = mod;
}),
"[turbopack-node]/transforms/webpack-loaders.ts [webpack_loaders] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>transform
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$compiled$2f$stacktrace$2d$parser$2f$index$2e$js__$5b$webpack_loaders$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[turbopack-node]/compiled/stacktrace-parser/index.js [webpack_loaders] (ecmascript)");
var __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$ipc$2f$index$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[turbopack-node]/ipc/index.ts [webpack_loaders] (ecmascript)");
var __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[turbopack-node]/transforms/transforms.ts [webpack_loaders] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
;
;
;
;
;
;
const { runLoaders } = __turbopack_context__.r("[externals]/next/dist/compiled/loader-runner [external] (next/dist/compiled/loader-runner, cjs)");
const contextDir = process.cwd();
const LogType = Object.freeze({
    error: 'error',
    warn: 'warn',
    info: 'info',
    log: 'log',
    debug: 'debug',
    trace: 'trace',
    group: 'group',
    groupCollapsed: 'groupCollapsed',
    groupEnd: 'groupEnd',
    profile: 'profile',
    profileEnd: 'profileEnd',
    time: 'time',
    clear: 'clear',
    status: 'status'
});
const loaderFlag = 'LOADER_EXECUTION';
const cutOffByFlag = (stack, flag)=>{
    const errorStack = stack.split('\n');
    for(let i = 0; i < errorStack.length; i++){
        if (errorStack[i].includes(flag)) {
            errorStack.length = i;
        }
    }
    return errorStack.join('\n');
};
/**
 * @param stack stack trace
 * @returns stack trace without the loader execution flag included
 */ const cutOffLoaderExecution = (stack)=>cutOffByFlag(stack, loaderFlag);
class DummySpan {
    traceChild() {
        return new DummySpan();
    }
    traceFn(fn) {
        return fn(this);
    }
    async traceAsyncFn(fn) {
        return await fn(this);
    }
    stop() {
        return;
    }
}
const transform = (ipc, content, name, query, loaders, sourceMap)=>{
    return new Promise((resolve, reject)=>{
        const resource = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["resolve"])(contextDir, name);
        const resourceDir = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["dirname"])(resource);
        const loadersWithOptions = loaders.map((loader)=>typeof loader === 'string' ? {
                loader,
                options: {}
            } : loader);
        const logs = [];
        runLoaders({
            resource: resource + query,
            context: {
                _module: {
                    // For debugging purpose, if someone find context is not full compatible to
                    // webpack they can guess this comes from turbopack
                    __reserved: 'TurbopackContext'
                },
                currentTraceSpan: new DummySpan(),
                rootContext: contextDir,
                sourceMap,
                getOptions () {
                    const entry = this.loaders[this.loaderIndex];
                    return entry.options && typeof entry.options === 'object' ? entry.options : {};
                },
                fs: {
                    readFile (p, optionsOrCb, maybeCb) {
                        ipc.sendRequest({
                            type: 'trackFileRead',
                            file: (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["relative"])(contextDir, (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["resolve"])(p))
                        }).then(()=>{
                            __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["default"].readFile(p, optionsOrCb, maybeCb);
                        }, (err)=>{
                            ipc.sendError(err);
                        // sendError is going to stop the process, no need to call callback
                        });
                    }
                },
                getResolve: (options)=>{
                    const rustOptions = {
                        aliasFields: undefined,
                        conditionNames: undefined,
                        noPackageJson: false,
                        extensions: undefined,
                        mainFields: undefined,
                        noExportsField: false,
                        mainFiles: undefined,
                        noModules: false,
                        preferRelative: false
                    };
                    if (options.alias) {
                        if (!Array.isArray(options.alias) || options.alias.length > 0) {
                            throw new Error('alias resolve option is not supported');
                        }
                    }
                    if (options.aliasFields) {
                        if (!Array.isArray(options.aliasFields)) {
                            throw new Error('aliasFields resolve option must be an array');
                        }
                        rustOptions.aliasFields = options.aliasFields;
                    }
                    if (options.conditionNames) {
                        if (!Array.isArray(options.conditionNames)) {
                            throw new Error('conditionNames resolve option must be an array');
                        }
                        rustOptions.conditionNames = options.conditionNames;
                    }
                    if (options.descriptionFiles) {
                        if (!Array.isArray(options.descriptionFiles) || options.descriptionFiles.length > 0) {
                            throw new Error('descriptionFiles resolve option is not supported');
                        }
                        rustOptions.noPackageJson = true;
                    }
                    if (options.extensions) {
                        if (!Array.isArray(options.extensions)) {
                            throw new Error('extensions resolve option must be an array');
                        }
                        rustOptions.extensions = options.extensions;
                    }
                    if (options.mainFields) {
                        if (!Array.isArray(options.mainFields)) {
                            throw new Error('mainFields resolve option must be an array');
                        }
                        rustOptions.mainFields = options.mainFields;
                    }
                    if (options.exportsFields) {
                        if (!Array.isArray(options.exportsFields) || options.exportsFields.length > 0) {
                            throw new Error('exportsFields resolve option is not supported');
                        }
                        rustOptions.noExportsField = true;
                    }
                    if (options.mainFiles) {
                        if (!Array.isArray(options.mainFiles)) {
                            throw new Error('mainFiles resolve option must be an array');
                        }
                        rustOptions.mainFiles = options.mainFiles;
                    }
                    if (options.modules) {
                        if (!Array.isArray(options.modules) || options.modules.length > 0) {
                            throw new Error('modules resolve option is not supported');
                        }
                        rustOptions.noModules = true;
                    }
                    if (options.restrictions) {
                    // TODO This is ignored for now
                    }
                    if (options.dependencyType) {
                    // TODO This is ignored for now
                    }
                    if (options.preferRelative) {
                        if (typeof options.preferRelative !== 'boolean') {
                            throw new Error('preferRelative resolve option must be a boolean');
                        }
                        rustOptions.preferRelative = options.preferRelative;
                    }
                    return (lookupPath, request, callback)=>{
                        if (__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].isAbsolute(request)) {
                            // Relativize absolute requests. Turbopack disallow them in JS code, but here it's
                            // generated programatically and there is a smaller problem of
                            // non-cacheable/non-portable builds.
                            request = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].relative(lookupPath, request);
                            // On Windows, the path might be still absolute if it's on a different drive. Just
                            // let the resolver throw the error in that case.
                            if (!__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].isAbsolute(request) && request.split(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].sep)[0] !== '..') {
                                request = './' + request;
                            }
                        }
                        const promise = ipc.sendRequest({
                            type: 'resolve',
                            options: rustOptions,
                            lookupPath: (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["toPath"])(lookupPath),
                            request
                        }).then((unknownResult)=>{
                            let result = unknownResult;
                            if (result && typeof result.path === 'string') {
                                return (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["fromPath"])(result.path);
                            } else {
                                throw Error('Expected { path: string } from resolve request');
                            }
                        });
                        if (callback) {
                            promise.then((result)=>callback(undefined, result), (err)=>callback(err)).catch((err)=>{
                                ipc.sendError(err);
                            });
                        } else {
                            return promise;
                        }
                    };
                },
                emitWarning: makeErrorEmitter('warning', ipc),
                emitError: makeErrorEmitter('error', ipc),
                getLogger (name) {
                    const logFn = (logType, ...args)=>{
                        let trace;
                        switch(logType){
                            case LogType.warn:
                            case LogType.error:
                            case LogType.trace:
                            case LogType.debug:
                                trace = (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$compiled$2f$stacktrace$2d$parser$2f$index$2e$js__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["parse"])(cutOffLoaderExecution(new Error('Trace').stack).split('\n').slice(3).join('\n'));
                                break;
                            default:
                                break;
                        }
                        // Batch logs messages to be sent at the end
                        logs.push({
                            time: Date.now(),
                            logType,
                            args,
                            trace
                        });
                    };
                    let timers;
                    let timersAggregates;
                    // See https://github.com/webpack/webpack/blob/a48c34b34d2d6c44f9b2b221d7baf278d34ac0be/lib/logging/Logger.js#L8
                    return {
                        error: logFn.bind(this, LogType.error),
                        warn: logFn.bind(this, LogType.warn),
                        info: logFn.bind(this, LogType.info),
                        log: logFn.bind(this, LogType.log),
                        debug: logFn.bind(this, LogType.debug),
                        assert: (assertion, ...args)=>{
                            if (!assertion) {
                                logFn(LogType.error, ...args);
                            }
                        },
                        trace: logFn.bind(this, LogType.trace),
                        clear: logFn.bind(this, LogType.clear),
                        status: logFn.bind(this, LogType.status),
                        group: logFn.bind(this, LogType.group),
                        groupCollapsed: logFn.bind(this, LogType.groupCollapsed),
                        groupEnd: logFn.bind(this, LogType.groupEnd),
                        profile: logFn.bind(this, LogType.profile),
                        profileEnd: logFn.bind(this, LogType.profileEnd),
                        time: (label)=>{
                            timers = timers || new Map();
                            timers.set(label, process.hrtime());
                        },
                        timeLog: (label)=>{
                            const prev = timers && timers.get(label);
                            if (!prev) {
                                throw new Error(`No such label '${label}' for WebpackLogger.timeLog()`);
                            }
                            const time = process.hrtime(prev);
                            logFn(LogType.time, [
                                label,
                                ...time
                            ]);
                        },
                        timeEnd: (label)=>{
                            const prev = timers && timers.get(label);
                            if (!prev) {
                                throw new Error(`No such label '${label}' for WebpackLogger.timeEnd()`);
                            }
                            const time = process.hrtime(prev);
                            /** @type {Map<string | undefined, [number, number]>} */ timers.delete(label);
                            logFn(LogType.time, [
                                label,
                                ...time
                            ]);
                        },
                        timeAggregate: (label)=>{
                            const prev = timers && timers.get(label);
                            if (!prev) {
                                throw new Error(`No such label '${label}' for WebpackLogger.timeAggregate()`);
                            }
                            const time = process.hrtime(prev);
                            /** @type {Map<string | undefined, [number, number]>} */ timers.delete(label);
                            /** @type {Map<string | undefined, [number, number]>} */ timersAggregates = timersAggregates || new Map();
                            const current = timersAggregates.get(label);
                            if (current !== undefined) {
                                if (time[1] + current[1] > 1e9) {
                                    time[0] += current[0] + 1;
                                    time[1] = time[1] - 1e9 + current[1];
                                } else {
                                    time[0] += current[0];
                                    time[1] += current[1];
                                }
                            }
                            timersAggregates.set(label, time);
                        },
                        timeAggregateEnd: (label)=>{
                            if (timersAggregates === undefined) return;
                            const time = timersAggregates.get(label);
                            if (time === undefined) return;
                            timersAggregates.delete(label);
                            logFn(LogType.time, [
                                label,
                                ...time
                            ]);
                        }
                    };
                }
            },
            loaders: loadersWithOptions.map((loader)=>({
                    loader: /*TURBOPACK member replacement*/ __turbopack_context__.x.resolve(loader.loader, {
                        paths: [
                            contextDir,
                            resourceDir
                        ]
                    }),
                    options: loader.options
                })),
            readResource: (_filename, callback)=>{
                // TODO assuming that filename === resource, but loaders might change that
                let data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content.binary, 'base64');
                callback(null, data);
            }
        }, (err, result)=>{
            if (logs.length) {
                ipc.sendInfo({
                    type: 'log',
                    logs: logs
                });
                logs.length = 0;
            }
            ipc.sendInfo({
                type: 'dependencies',
                envVariables: (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["getReadEnvVariables"])(),
                filePaths: result.fileDependencies.map(__TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["toPath"]),
                directories: result.contextDependencies.map((dep)=>[
                        (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$transforms$2f$transforms$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["toPath"])(dep),
                        '**'
                    ])
            });
            if (err) return reject(err);
            if (!result.result) return reject(new Error('No result from loaders'));
            const [source, map] = result.result;
            resolve({
                source: Buffer.isBuffer(source) ? {
                    binary: source.toString('base64')
                } : source,
                map: typeof map === 'string' ? map : typeof map === 'object' ? JSON.stringify(map) : undefined
            });
        });
    });
};
;
function makeErrorEmitter(severity, ipc) {
    return function(error) {
        ipc.sendInfo({
            type: 'emittedError',
            severity: severity,
            error: (0, __TURBOPACK__imported__module__$5b$turbopack$2d$node$5d2f$ipc$2f$index$2e$ts__$5b$webpack_loaders$5d$__$28$ecmascript$29$__["structuredError"])(error)
        });
    };
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__6e020478._.js.map