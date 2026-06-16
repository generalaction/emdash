import{g as R,d as q}from"./iframe-fRrJXGxS.js";import{r as w}from"./index-CcPffzVj.js";var D=w();const O=R(D);var i={exports:{}},c={};/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var f;function g(){if(f)return c;f=1;var u=q();function d(e,t){return e===t&&(e!==0||1/e===1/t)||e!==e&&t!==t}var p=typeof Object.is=="function"?Object.is:d,m=u.useState,l=u.useEffect,v=u.useLayoutEffect,E=u.useDebugValue;function h(e,t){var n=t(),a=m({inst:{value:n,getSnapshot:t}}),r=a[0].inst,s=a[1];return v(function(){r.value=n,r.getSnapshot=t,o(r)&&s({inst:r})},[e,n,t]),l(function(){return o(r)&&s({inst:r}),e(function(){o(r)&&s({inst:r})})},[e]),E(n),n}function o(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!p(e,n)}catch{return!0}}function x(e,t){return t()}var y=typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"?x:h;return c.useSyncExternalStore=u.useSyncExternalStore!==void 0?u.useSyncExternalStore:y,c}var S;function j(){return S||(S=1,i.exports=g()),i.exports}var U=j();export{O as R,D as r,U as s};
