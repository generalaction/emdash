module.exports = [
"[externals]/fs/promises [external] (fs/promises, cjs, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/ssr/[externals]_fs_promises_0bfe4114._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[externals]/fs/promises [external] (fs/promises, cjs)");
    });
});
}),
];