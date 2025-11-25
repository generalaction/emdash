module.exports=[63489,a=>{"use strict";var b=Object.defineProperty;Object.prototype.hasOwnProperty;var c={},d={basename:()=>f,dirname:()=>h,extname:()=>g,joinPath:()=>j,slash:()=>k,splitPath:()=>i};for(var e in d)b(c,e,{get:d[e],enumerable:!0});function f(a,b){let c=a.lastIndexOf("/");return a.substring(-1===c?0:c+1,b?a.length-b.length:a.length)}function g(a){let b=a.lastIndexOf(".");return -1!==b?a.substring(b):""}function h(a){return a.split("/").slice(0,-1).join("/")}function i(a){return a.split("/").filter(a=>a.length>0)}function j(...a){let b=[];for(let c of a.flatMap(i))switch(c){case"..":b.pop();break;case".":break;default:b.push(c)}return b.join("/")}function k(a){return a.startsWith("\\\\?\\")?a:a.replaceAll("\\","/")}var l=class{constructor(a){if(this.files=new Map,this.folders=new Map,a){for(const[b,c]of a.folders)this.folders.set(b,c);for(const[b,c]of a.files)this.files.set(b,c)}else this.folders.set("",[])}read(a){return this.files.get(a)}readDir(a){return this.folders.get(a)}write(a,b){if(!this.files.has(a)){let b=h(a);this.makeDir(b),this.readDir(b)?.push(a)}this.files.set(a,b)}delete(a,b=!1){if(this.files.delete(a))return!0;if(b){let b=this.folders.get(a);if(!b)return!1;for(let c of(this.folders.delete(a),b))this.delete(c);return!0}return!1}getFiles(){return Array.from(this.files.keys())}makeDir(a){let b=i(a);for(let a=0;a<b.length;a++){let c=b.slice(0,a+1).join("/");this.folders.has(c)||(this.folders.set(c,[]),this.folders.get(h(c)).push(c))}}};function m(a){return a.length>0&&!/\d+/.test(a)}var n={dir(a){let[b,...c]=a.split("/");return b&&c.length>0&&m(b)?[c.join("/"),b]:[a]},dot(a){let b=h(a),c=f(a).split(".");if(c.length<3)return[a];let[d]=c.splice(c.length-2,1);return m(d)?[j(b,c.join(".")),d]:[a]},none:a=>[a]};function o(a){let b=i(k(a));if("."===b[0]||".."===b[0])throw Error("It must not start with './' or '../'");return b.join("/")}var p=/^\((?<name>.+)\)$/,q=/^(?<external>external:)?(?:\[(?<icon>[^\]]+)])?\[(?<name>[^\]]+)]\((?<url>[^)]+)\)$/,r=/^---(?:\[(?<icon>[^\]]+)])?(?<name>.+)---|^---$/,s="z...a";function t(a){let b=[];for(let c of a)0===b.length?b.push(c.toLocaleUpperCase()):"-"===c?b.push(" "):b.push(c);return b.join("")}var u={pre:1,default:0,post:-1},w=/^\(.+\)$/;function x(a){let b=h(a),c=f(a,g(a)),d=[];for(let a of b.split("/"))a.length>0&&!w.test(a)&&d.push(encodeURI(a));if(w.test(c))throw Error(`Cannot use folder group in file names: ${a}`);return"index"!==c&&d.push(encodeURI(c)),d}function y(...a){return function(a){let b,{i18n:c}=a,d=c?.defaultLanguage??"",e=function(a,b){let{source:c,plugins:d=[],i18n:e={defaultLanguage:b,parser:"none",languages:[b]}}=a,f=n[e.parser??"dot"],g={},h=new Map;for(let a of c.files){let b,[c,d=e.defaultLanguage]=f((b="page"===a.type?{format:"page",path:o(a.path),slugs:a.slugs,data:a.data,absolutePath:a.absolutePath}:{format:"meta",path:o(a.path),absolutePath:a.absolutePath,data:a.data}).path),g=h.get(d)??[];g.push({pathWithoutLocale:c,file:b}),h.set(d,g)}let i=null!==e.fallbackLanguage?e.fallbackLanguage??e.defaultLanguage:null;for(let a of e.languages)!function a(b){let c;if(g[b])return;for(let{pathWithoutLocale:d,file:e}of(i&&i!==b?(a(i),c=new l(g[i])):c=new l,h.get(b)??[]))c.write(d,e);let e={storage:c};for(let a of d)a.transformStorage?.(e);g[b]=c}(a);return g}(a,d),h=function(a,{url:b}){let c={pages:new Map,pathToMeta:new Map,pathToPage:new Map};for(let[d,e]of Object.entries(a))for(let a of e.getFiles()){let f=e.read(a),g=`${d}.${a}`;if("meta"===f.format){c.pathToMeta.set(g,{path:f.path,absolutePath:f.absolutePath,data:f.data});continue}let h={absolutePath:f.absolutePath,path:f.path,url:b(f.slugs,d),slugs:f.slugs,data:f.data,locale:d};c.pathToPage.set(g,h),c.pages.set(`${d}.${h.slugs.join("/")}`,h)}return c}(e,a),i=function(a){let{plugins:b=[],url:c,pageTree:d={}}=a;return{build(a,b=d){return this.buildI18n({"":a},b)[""]},buildI18n(a,e=d){let h,i=0,k={},m=[];for(let a of(e.transformers&&m.push(...e.transformers),b))a.transformPageTree&&m.push(a.transformPageTree);for(let[b,d]of((e.generateFallback??!0)&&m.push((h=new Set,{root(a){let b=new l;for(let a of this.storage.getFiles()){if(h.has(a))continue;let c=this.storage.read(a);c&&b.write(a,c)}return 0===b.getFiles().length||(a.fallback=this.builder.build(b,{...this.options,id:`fallback-${a.$id??""}`,generateFallback:!1}),h.clear()),a},file:(a,b)=>(b&&h.add(b),a),folder:(a,b,c)=>(c&&h.add(c),a)})),Object.entries(a))){let h=0===b.length?"root":b;e.id&&(h=`${e.id}-${h}`),k[b]=(function(a){let b=function(a){let b=new Map;for(let c of a.getFiles()){let d=a.read(c),e=c.substring(0,c.length-g(c).length);b.set(e+"."+d.format,c)}return(a,c)=>b.get(a+"."+c)??a}(a.storage),c=new Set;function d(b=a.generateNodeId()){return`${a.rootId}:${b}`}return{buildPaths(a,b=!1){let c=[],d=[];for(let e of a.sort((a,c)=>a.localeCompare(c)*(b?-1:1))){let a=this.file(e);if(a){"index"===f(e,g(e))?c.unshift(a):c.push(a);continue}let b=this.folder(e,!1);b&&d.push(b)}return[...c,...d]},resolveFolderItem(e,f){if("..."===f||f===s)return f;let g=r.exec(f);if(g?.groups){let b={$id:d(),type:"separator",icon:g.groups.icon,name:g.groups.name};for(let c of a.transformers)c.separator&&(b=c.separator.call(a,b));return[b]}if(g=q.exec(f),g?.groups){let{icon:b,url:c,name:e,external:f}=g.groups,h={$id:d(),type:"page",icon:b,name:e,url:c,external:!!f||void 0};for(let b of a.transformers)b.file&&(h=b.file.call(a,h));return[h]}let h=f.startsWith("!"),i=!h&&f.startsWith("..."),k=f;h?k=f.slice(1):i&&(k=f.slice(3));let l=b(j(e,k),"page");if(h)return c.add(l),[];let m=this.folder(l,!1);if(m)return i?m.children:[m];let n=this.file(l);return n?[n]:[]},folder(e,g){let h,i,{storage:k,options:l,transformers:m}=a,n=k.readDir(e);if(!n)return;let o=b(j(e,"meta"),"meta"),q=b(j(e,"index"),"page"),r=k.read(o);r?.format!=="meta"&&(r=void 0);let u=r?.data.root??g;if(r&&r.data.pages){let a=r.data.pages.flatMap(a=>this.resolveFolderItem(e,a));u||c.has(q)||(h=this.file(q));for(let b=0;b<a.length;b++){let d=a[b];if("..."!==d&&d!==s)continue;let e=this.buildPaths(n.filter(a=>!c.has(a)),d===s);a.splice(b,1,...e);break}i=a}else u||c.has(q)||(h=this.file(q)),i=this.buildPaths(n.filter(a=>!c.has(a)));let w=r?.data.title??h?.name;if(!w){let a=f(e);w=t(p.exec(a)?.[1]??a)}let x={type:"folder",name:w,icon:r?.data.icon??h?.icon,root:r?.data.root,defaultOpen:r?.data.defaultOpen,description:r?.data.description,index:h,children:i,$id:d(e),$ref:!l.noRef&&r?{metaFile:o}:void 0};for(let b of(c.add(e),m))b.folder&&(x=b.folder.call(a,x,e,o));return x},file(b){let{options:e,getUrl:h,storage:i,locale:j,transformers:k}=a,l=i.read(b);if(l?.format!=="page")return;let{title:m,description:n,icon:o}=l.data,p={$id:d(b),type:"page",name:m??t(f(b,g(b))),description:n,icon:o,url:h(l.slugs,j),$ref:e.noRef?void 0:{file:b}};for(let d of(c.add(b),k))d.file&&(p=d.file.call(a,p,b));return p},root(){let b=this.folder("",!0),c={$id:a.rootId,name:b.name||"Docs",children:b.children};for(let b of a.transformers)b.root&&(c=b.root.call(a,c));return c}}})({rootId:h,transformers:m,builder:this,options:e,getUrl:c,locale:b,storage:d,storages:a,generateNodeId:()=>"_"+i++}).root()}return k}}}(a);return{_i18n:c,get pageTree(){return b??=i.buildI18n(e),c?b:b[d]},set pageTree(v){b=c?v:{[d]:v}},getPageByHref(a,{dir:b="",language:c=d}={}){let e,[f,g]=a.split("#",2);if(f.startsWith(".")&&(f.endsWith(".md")||f.endsWith(".mdx"))){let a=j(b,f);e=h.pathToPage.get(`${c}.${a}`)}else e=this.getPages(c).find(a=>a.url===f);if(e)return{page:e,hash:g}},getPages(a){let b=[];for(let[c,d]of h.pages.entries())(void 0===a||c.startsWith(`${a}.`))&&b.push(d);return b},getLanguages(){let a=[];if(!c)return a;for(let b of c.languages)a.push({language:b,pages:this.getPages(b)});return a},getPage(a=[],b=d){let c=h.pages.get(`${b}.${a.join("/")}`);if(c||(c=h.pages.get(`${b}.${a.map(decodeURI).join("/")}`)))return c},getNodeMeta(a,b=d){let c=a.$ref?.metaFile;if(c)return h.pathToMeta.get(`${b}.${c}`)},getNodePage(a,b=d){let c=a.$ref?.file;if(c)return h.pathToPage.get(`${b}.${c}`)},getPageTree(a){return c?this.pageTree[a??d]:this.pageTree},generateParams(a,b){return c?this.getLanguages().flatMap(c=>c.pages.map(d=>({[a??"slug"]:d.slugs,[b??"lang"]:c.language}))):this.getPages().map(b=>({[a??"slug"]:b.slugs}))}}}(2===a.length?z(a[0],a[1]):z(a[0].source,a[0]))}function z(a,{slugs:b,icon:c,plugins:d=[],baseUrl:e,url:h,...i}){var j;let k,l={...i,url:h?(...a)=>{var b;return(b=h(...a)).startsWith("http://")||b.startsWith("https://")||(b.startsWith("/")||(b="/"+b),b.length>1&&b.endsWith("/")&&(b=b.slice(0,-1))),b}:(j=i.i18n,k=e.split("/"),(a,b)=>{let c,d=j?.hideLocale??"never";"never"===d?c=b:"default-locale"===d&&b!==j?.defaultLanguage&&(c=b);let e=[...k,...a];return c&&e.unshift(c),`/${e.filter(a=>a.length>0).join("/")}`}),source:a,plugins:function a(b,c=!0){let d=[];for(let c of b)Array.isArray(c)?d.push(...a(c,!1)):c&&d.push(c);return c?d.sort((a,b)=>u[b.enforce??"default"]-u[a.enforce??"default"]):d}([{name:"fumadocs:slugs",transformStorage({storage:a}){let c=new Set,d=new Set,e=void 0===b;for(let h of a.getFiles()){let i=a.read(h);if(!i||"page"!==i.format||i.slugs)continue;if("index"===f(h,g(h))&&e){c.add(h);continue}i.slugs=b?b({path:h}):x(h);let j=i.slugs.join("/");if(d.has(j))throw Error("Duplicated slugs");d.add(j)}for(let b of c){let c=a.read(b);c?.format==="page"&&(c.slugs=x(b),d.has(c.slugs.join("/"))&&c.slugs.push("index"))}}},c&&function(a){function b(b){return(void 0===b.icon||"string"==typeof b.icon)&&(b.icon=a(b.icon)),b}return{name:"fumadocs:icon",transformPageTree:{file:b,folder:b,separator:b}}}(c),..."function"==typeof d?d({typedPlugin:a=>a}):d])};for(let a of l.plugins??[]){let b=a.config?.(l);b&&(l=b)}return l}a.s(["loader",()=>y],63489)},45321,a=>{"use strict";a.s([],64554),a.i(64554);let b=`
<svg
  class="lucide lucide-a-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 12 4 4 4-4" />
  <path d="M18 16V7" />
  <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
  <path d="M3.304 13h6.392" />
</svg>
`,c=`
<svg
  class="lucide lucide-a-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 11 4-4 4 4" />
  <path d="M18 16V7" />
  <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
  <path d="M3.304 13h6.392" />
</svg>
`,d=`
<svg
  class="lucide lucide-a-large-small"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" />
  <path d="M15.697 14h5.606" />
  <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
  <path d="M3.304 13h6.392" />
</svg>`,e=`
<svg
  class="lucide lucide-accessibility"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="16" cy="4" r="1" />
  <path d="m18 19 1-7-6 1" />
  <path d="m5 8 3-3 5.5 3-2.36 3.5" />
  <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
  <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
</svg>
`,f=`
<svg
  class="lucide lucide-activity"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
</svg>
`,g=`
<svg
  class="lucide lucide-air-vent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 17.5a2.5 2.5 0 1 1-4 2.03V12" />
  <path d="M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
  <path d="M6 8h12" />
  <path d="M6.6 15.572A2 2 0 1 0 10 17v-5" />
</svg>
`,h=`
<svg
  class="lucide lucide-airplay"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
  <path d="m12 15 5 6H7Z" />
</svg>
`,i=`
<svg
  class="lucide lucide-alarm-clock-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="13" r="8" />
  <path d="M5 3 2 6" />
  <path d="m22 6-3-3" />
  <path d="M6.38 18.7 4 21" />
  <path d="M17.64 18.67 20 21" />
  <path d="m9 13 2 2 4-4" />
</svg>
`,j=`
<svg
  class="lucide lucide-alarm-clock-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="13" r="8" />
  <path d="M5 3 2 6" />
  <path d="m22 6-3-3" />
  <path d="M6.38 18.7 4 21" />
  <path d="M17.64 18.67 20 21" />
  <path d="M9 13h6" />
</svg>
`,k=`
<svg
  class="lucide lucide-alarm-clock-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6.87 6.87a8 8 0 1 0 11.26 11.26" />
  <path d="M19.9 14.25a8 8 0 0 0-9.15-9.15" />
  <path d="m22 6-3-3" />
  <path d="M6.26 18.67 4 21" />
  <path d="m2 2 20 20" />
  <path d="M4 4 2 6" />
</svg>
`,l=`
<svg
  class="lucide lucide-alarm-clock-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="13" r="8" />
  <path d="M5 3 2 6" />
  <path d="m22 6-3-3" />
  <path d="M6.38 18.7 4 21" />
  <path d="M17.64 18.67 20 21" />
  <path d="M12 10v6" />
  <path d="M9 13h6" />
</svg>
`,m=`
<svg
  class="lucide lucide-alarm-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="13" r="8" />
  <path d="M12 9v4l2 2" />
  <path d="M5 3 2 6" />
  <path d="m22 6-3-3" />
  <path d="M6.38 18.7 4 21" />
  <path d="M17.64 18.67 20 21" />
</svg>
`,n=`
<svg
  class="lucide lucide-alarm-smoke"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 21c0-2.5 2-2.5 2-5" />
  <path d="M16 21c0-2.5 2-2.5 2-5" />
  <path d="m19 8-.8 3a1.25 1.25 0 0 1-1.2 1H7a1.25 1.25 0 0 1-1.2-1L5 8" />
  <path d="M21 3a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z" />
  <path d="M6 21c0-2.5 2-2.5 2-5" />
</svg>
`,o=`
<svg
  class="lucide lucide-album"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <polyline points="11 3 11 11 14 8 17 11 17 3" />
</svg>
`,p=`
<svg
  class="lucide lucide-align-center-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 12h20" />
  <path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
  <path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4" />
  <path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1" />
  <path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1" />
</svg>
`,q=`
<svg
  class="lucide lucide-align-center-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v20" />
  <path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4" />
  <path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" />
  <path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1" />
  <path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" />
</svg>
`,r=`
<svg
  class="lucide lucide-align-end-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="16" x="4" y="2" rx="2" />
  <rect width="6" height="9" x="14" y="9" rx="2" />
  <path d="M22 22H2" />
</svg>
`,s=`
<svg
  class="lucide lucide-align-end-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="6" x="2" y="4" rx="2" />
  <rect width="9" height="6" x="9" y="14" rx="2" />
  <path d="M22 22V2" />
</svg>
`,t=`
<svg
  class="lucide lucide-align-horizontal-distribute-center"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="4" y="5" rx="2" />
  <rect width="6" height="10" x="14" y="7" rx="2" />
  <path d="M17 22v-5" />
  <path d="M17 7V2" />
  <path d="M7 22v-3" />
  <path d="M7 5V2" />
</svg>
`,u=`
<svg
  class="lucide lucide-align-horizontal-distribute-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="4" y="5" rx="2" />
  <rect width="6" height="10" x="14" y="7" rx="2" />
  <path d="M10 2v20" />
  <path d="M20 2v20" />
</svg>
`,w=`
<svg
  class="lucide lucide-align-horizontal-distribute-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="4" y="5" rx="2" />
  <rect width="6" height="10" x="14" y="7" rx="2" />
  <path d="M4 2v20" />
  <path d="M14 2v20" />
</svg>
`,x=`
<svg
  class="lucide lucide-align-horizontal-justify-center"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="2" y="5" rx="2" />
  <rect width="6" height="10" x="16" y="7" rx="2" />
  <path d="M12 2v20" />
</svg>
`,y=`
<svg
  class="lucide lucide-align-horizontal-justify-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="2" y="5" rx="2" />
  <rect width="6" height="10" x="12" y="7" rx="2" />
  <path d="M22 2v20" />
</svg>
`,z=`
<svg
  class="lucide lucide-align-horizontal-justify-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="6" y="5" rx="2" />
  <rect width="6" height="10" x="16" y="7" rx="2" />
  <path d="M2 2v20" />
</svg>
`,A=`
<svg
  class="lucide lucide-align-horizontal-space-around"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="10" x="9" y="7" rx="2" />
  <path d="M4 22V2" />
  <path d="M20 22V2" />
</svg>
`,B=`
<svg
  class="lucide lucide-align-horizontal-space-between"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="14" x="3" y="5" rx="2" />
  <rect width="6" height="10" x="15" y="7" rx="2" />
  <path d="M3 2v20" />
  <path d="M21 2v20" />
</svg>
`,C=`
<svg
  class="lucide lucide-align-start-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="16" x="4" y="6" rx="2" />
  <rect width="6" height="9" x="14" y="6" rx="2" />
  <path d="M22 2H2" />
</svg>
`,D=`
<svg
  class="lucide lucide-align-start-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="9" height="6" x="6" y="14" rx="2" />
  <rect width="16" height="6" x="6" y="4" rx="2" />
  <path d="M2 2v20" />
</svg>
`,E=`
<svg
  class="lucide lucide-align-vertical-distribute-center"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17h-3" />
  <path d="M22 7h-5" />
  <path d="M5 17H2" />
  <path d="M7 7H2" />
  <rect x="5" y="14" width="14" height="6" rx="2" />
  <rect x="7" y="4" width="10" height="6" rx="2" />
</svg>
`,F=`
<svg
  class="lucide lucide-align-vertical-distribute-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="14" rx="2" />
  <rect width="10" height="6" x="7" y="4" rx="2" />
  <path d="M2 20h20" />
  <path d="M2 10h20" />
</svg>
`,G=`
<svg
  class="lucide lucide-align-vertical-distribute-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="14" rx="2" />
  <rect width="10" height="6" x="7" y="4" rx="2" />
  <path d="M2 14h20" />
  <path d="M2 4h20" />
</svg>
`,H=`
<svg
  class="lucide lucide-align-vertical-justify-center"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="16" rx="2" />
  <rect width="10" height="6" x="7" y="2" rx="2" />
  <path d="M2 12h20" />
</svg>
`,I=`
<svg
  class="lucide lucide-align-vertical-justify-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="12" rx="2" />
  <rect width="10" height="6" x="7" y="2" rx="2" />
  <path d="M2 22h20" />
</svg>
`,J=`
<svg
  class="lucide lucide-align-vertical-justify-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="16" rx="2" />
  <rect width="10" height="6" x="7" y="6" rx="2" />
  <path d="M2 2h20" />
</svg>
`,K=`
<svg
  class="lucide lucide-align-vertical-space-around"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="10" height="6" x="7" y="9" rx="2" />
  <path d="M22 20H2" />
  <path d="M22 4H2" />
</svg>
`,L=`
<svg
  class="lucide lucide-ambulance"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10H6" />
  <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
  <path
    d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14" />
  <path d="M8 8v4" />
  <path d="M9 18h6" />
  <circle cx="17" cy="18" r="2" />
  <circle cx="7" cy="18" r="2" />
</svg>`,M=`
<svg
  class="lucide lucide-align-vertical-space-between"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="6" x="5" y="15" rx="2" />
  <rect width="10" height="6" x="7" y="3" rx="2" />
  <path d="M2 21h20" />
  <path d="M2 3h20" />
</svg>
`,N=`
<svg
  class="lucide lucide-ampersand"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.5 12c0 4.4-3.6 8-8 8A4.5 4.5 0 0 1 5 15.5c0-6 8-4 8-8.5a3 3 0 1 0-6 0c0 3 2.5 8.5 12 13" />
  <path d="M16 12h3" />
</svg>
`,O=`
<svg
  class="lucide lucide-ampersands"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 17c-5-3-7-7-7-9a2 2 0 0 1 4 0c0 2.5-5 2.5-5 6 0 1.7 1.3 3 3 3 2.8 0 5-2.2 5-5" />
  <path d="M22 17c-5-3-7-7-7-9a2 2 0 0 1 4 0c0 2.5-5 2.5-5 6 0 1.7 1.3 3 3 3 2.8 0 5-2.2 5-5" />
</svg>
`,P=`
<svg
  class="lucide lucide-amphora"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8" />
  <path d="M10 5H8a2 2 0 0 0 0 4h.68" />
  <path d="M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8" />
  <path d="M14 5h2a2 2 0 0 1 0 4h-.68" />
  <path d="M18 22H6" />
  <path d="M9 2h6" />
</svg>
`,Q=`
<svg
  class="lucide lucide-anchor"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22V8" />
  <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
  <circle cx="12" cy="5" r="3" />
</svg>
`,R=`
<svg
  class="lucide lucide-angry"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
  <path d="M7.5 8 10 9" />
  <path d="m14 9 2.5-1" />
  <path d="M9 10h.01" />
  <path d="M15 10h.01" />
</svg>
`,S=`
<svg
  class="lucide lucide-antenna"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 12 7 2" />
  <path d="m7 12 5-10" />
  <path d="m12 12 5-10" />
  <path d="m17 12 5-10" />
  <path d="M4.5 7h15" />
  <path d="M12 16v6" />
</svg>
`,T=`
<svg
  class="lucide lucide-annoyed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M8 15h8" />
  <path d="M8 9h2" />
  <path d="M14 9h2" />
</svg>
`,U=`
<svg
  class="lucide lucide-anvil"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 10H6a4 4 0 0 1-4-4 1 1 0 0 1 1-1h4" />
  <path d="M7 5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1 7 7 0 0 1-7 7H8a1 1 0 0 1-1-1z" />
  <path d="M9 12v5" />
  <path d="M15 12v5" />
  <path d="M5 20a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3 1 1 0 0 1-1 1H6a1 1 0 0 1-1-1" />
</svg>
`,V=`
<svg
  class="lucide lucide-app-window-mac"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M6 8h.01" />
  <path d="M10 8h.01" />
  <path d="M14 8h.01" />
</svg>
`,W=`
<svg
  class="lucide lucide-aperture"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m14.31 8 5.74 9.94" />
  <path d="M9.69 8h11.48" />
  <path d="m7.38 12 5.74-9.94" />
  <path d="M9.69 16 3.95 6.06" />
  <path d="M14.31 16H2.83" />
  <path d="m16.62 12-5.74 9.94" />
</svg>
`,X=`
<svg
  class="lucide lucide-app-window"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="2" y="4" width="20" height="16" rx="2" />
  <path d="M10 4v4" />
  <path d="M2 8h20" />
  <path d="M6 4v4" />
</svg>
`,Y=`
<svg
  class="lucide lucide-apple"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6.528V3a1 1 0 0 1 1-1h0" />
  <path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21" />
</svg>
`,Z=`
<svg
  class="lucide lucide-archive-restore"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="5" x="2" y="3" rx="1" />
  <path d="M4 8v11a2 2 0 0 0 2 2h2" />
  <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
  <path d="m9 15 3-3 3 3" />
  <path d="M12 12v9" />
</svg>
`,$=`
<svg
  class="lucide lucide-archive-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="5" x="2" y="3" rx="1" />
  <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
  <path d="m9.5 17 5-5" />
  <path d="m9.5 12 5 5" />
</svg>
`,_=`
<svg
  class="lucide lucide-archive"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="5" x="2" y="3" rx="1" />
  <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
  <path d="M10 12h4" />
</svg>
`,aa=`
<svg
  class="lucide lucide-armchair"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
  <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z" />
  <path d="M5 18v2" />
  <path d="M19 18v2" />
</svg>
`,ab=`
<svg
  class="lucide lucide-arrow-big-down-dash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 11a1 1 0 0 0 1 1h2.939a1 1 0 0 1 .75 1.811l-6.835 6.836a1.207 1.207 0 0 1-1.707 0L4.31 13.81a1 1 0 0 1 .75-1.811H8a1 1 0 0 0 1-1V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z" />
  <path d="M9 4h6" />
</svg>
`,ac=`
<svg
  class="lucide lucide-arrow-big-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 11a1 1 0 0 0 1 1h2.939a1 1 0 0 1 .75 1.811l-6.835 6.836a1.207 1.207 0 0 1-1.707 0L4.31 13.81a1 1 0 0 1 .75-1.811H8a1 1 0 0 0 1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z" />
</svg>
`,ad=`
<svg
  class="lucide lucide-arrow-big-left-dash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 9a1 1 0 0 1-1-1V5.061a1 1 0 0 0-1.811-.75l-6.835 6.836a1.207 1.207 0 0 0 0 1.707l6.835 6.835a1 1 0 0 0 1.811-.75V16a1 1 0 0 1 1-1h2a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1z" />
  <path d="M20 9v6" />
</svg>
`,ae=`
<svg
  class="lucide lucide-arrow-big-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 9a1 1 0 0 1-1-1V5.061a1 1 0 0 0-1.811-.75l-6.835 6.836a1.207 1.207 0 0 0 0 1.707l6.835 6.835a1 1 0 0 0 1.811-.75V16a1 1 0 0 1 1-1h6a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1z" />
</svg>
`,af=`
<svg
  class="lucide lucide-arrow-big-right-dash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 9a1 1 0 0 0 1-1V5.061a1 1 0 0 1 1.811-.75l6.836 6.836a1.207 1.207 0 0 1 0 1.707l-6.836 6.835a1 1 0 0 1-1.811-.75V16a1 1 0 0 0-1-1H9a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
  <path d="M4 9v6" />
</svg>
`,ag=`
<svg
  class="lucide lucide-arrow-big-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 9a1 1 0 0 0 1-1V5.061a1 1 0 0 1 1.811-.75l6.836 6.836a1.207 1.207 0 0 1 0 1.707l-6.836 6.835a1 1 0 0 1-1.811-.75V16a1 1 0 0 0-1-1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
</svg>
`,ah=`
<svg
  class="lucide lucide-arrow-big-up-dash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 13a1 1 0 0 0-1-1H5.061a1 1 0 0 1-.75-1.811l6.836-6.835a1.207 1.207 0 0 1 1.707 0l6.835 6.835a1 1 0 0 1-.75 1.811H16a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" />
  <path d="M9 20h6" />
</svg>
`,ai=`
<svg
  class="lucide lucide-arrow-big-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 13a1 1 0 0 0-1-1H5.061a1 1 0 0 1-.75-1.811l6.836-6.835a1.207 1.207 0 0 1 1.707 0l6.835 6.835a1 1 0 0 1-.75 1.811H16a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" />
</svg>
`,aj=`
<svg
  class="lucide lucide-arrow-down-0-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <rect x="15" y="4" width="4" height="6" ry="2" />
  <path d="M17 20v-6h-2" />
  <path d="M15 20h4" />
</svg>
`,ak=`
<svg
  class="lucide lucide-arrow-down-1-0"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <path d="M17 10V4h-2" />
  <path d="M15 10h4" />
  <rect x="15" y="14" width="4" height="6" ry="2" />
</svg>
`,al=`
<svg
  class="lucide lucide-arrow-down-a-z"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <path d="M20 8h-5" />
  <path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
  <path d="M15 14h5l-5 6h5" />
</svg>
`,am=`
<svg
  class="lucide lucide-arrow-down-from-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 3H5" />
  <path d="M12 21V7" />
  <path d="m6 15 6 6 6-6" />
</svg>
`,an=`
<svg
  class="lucide lucide-arrow-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 7 7 17" />
  <path d="M17 17H7V7" />
</svg>
`,ao=`
<svg
  class="lucide lucide-arrow-down-narrow-wide"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <path d="M11 4h4" />
  <path d="M11 8h7" />
  <path d="M11 12h10" />
</svg>
`,ap=`
<svg
  class="lucide lucide-arrow-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 7 10 10" />
  <path d="M17 7v10H7" />
</svg>
`,aq=`
<svg
  class="lucide lucide-arrow-down-to-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v14" />
  <path d="m19 9-7 7-7-7" />
  <circle cx="12" cy="21" r="1" />
</svg>
`,ar=`
<svg
  class="lucide lucide-arrow-down-to-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17V3" />
  <path d="m6 11 6 6 6-6" />
  <path d="M19 21H5" />
</svg>
`,as=`
<svg
  class="lucide lucide-arrow-down-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <path d="m21 8-4-4-4 4" />
  <path d="M17 4v16" />
</svg>
`,at=`
<svg
  class="lucide lucide-arrow-down-wide-narrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 20V4" />
  <path d="M11 4h10" />
  <path d="M11 8h7" />
  <path d="M11 12h4" />
</svg>
`,au=`
<svg
  class="lucide lucide-arrow-down-z-a"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 16 4 4 4-4" />
  <path d="M7 4v16" />
  <path d="M15 4h5l-5 6h5" />
  <path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20" />
  <path d="M20 18h-5" />
</svg>
`,av=`
<svg
  class="lucide lucide-arrow-left-from-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 6-6 6 6 6" />
  <path d="M3 12h14" />
  <path d="M21 19V5" />
</svg>
`,aw=`
<svg
  class="lucide lucide-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5v14" />
  <path d="m19 12-7 7-7-7" />
</svg>
`,ax=`
<svg
  class="lucide lucide-arrow-left-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3 4 7l4 4" />
  <path d="M4 7h16" />
  <path d="m16 21 4-4-4-4" />
  <path d="M20 17H4" />
</svg>
`,ay=`
<svg
  class="lucide lucide-arrow-left-to-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 19V5" />
  <path d="m13 6-6 6 6 6" />
  <path d="M7 12h14" />
</svg>
`,az=`
<svg
  class="lucide lucide-arrow-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 19-7-7 7-7" />
  <path d="M19 12H5" />
</svg>
`,aA=`
<svg
  class="lucide lucide-arrow-right-from-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5v14" />
  <path d="M21 12H7" />
  <path d="m15 18 6-6-6-6" />
</svg>
`,aB=`
<svg
  class="lucide lucide-arrow-right-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 3 4 4-4 4" />
  <path d="M20 7H4" />
  <path d="m8 21-4-4 4-4" />
  <path d="M4 17h16" />
</svg>
`,aC=`
<svg
  class="lucide lucide-arrow-right-to-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 12H3" />
  <path d="m11 18 6-6-6-6" />
  <path d="M21 5v14" />
</svg>
`,aD=`
<svg
  class="lucide lucide-arrow-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 12h14" />
  <path d="m12 5 7 7-7 7" />
</svg>
`,aE=`
<svg
  class="lucide lucide-arrow-up-0-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <rect x="15" y="4" width="4" height="6" ry="2" />
  <path d="M17 20v-6h-2" />
  <path d="M15 20h4" />
</svg>
`,aF=`
<svg
  class="lucide lucide-arrow-up-1-0"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <path d="M17 10V4h-2" />
  <path d="M15 10h4" />
  <rect x="15" y="14" width="4" height="6" ry="2" />
</svg>
`,aG=`
<svg
  class="lucide lucide-arrow-up-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21 16-4 4-4-4" />
  <path d="M17 20V4" />
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
</svg>
`,aH=`
<svg
  class="lucide lucide-arrow-up-a-z"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <path d="M20 8h-5" />
  <path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
  <path d="M15 14h5l-5 6h5" />
</svg>
`,aI=`
<svg
  class="lucide lucide-arrow-up-from-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m5 9 7-7 7 7" />
  <path d="M12 16V2" />
  <circle cx="12" cy="21" r="1" />
</svg>
`,aJ=`
<svg
  class="lucide lucide-arrow-up-from-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 9-6-6-6 6" />
  <path d="M12 3v14" />
  <path d="M5 21h14" />
</svg>
`,aK=`
<svg
  class="lucide lucide-arrow-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 17V7h10" />
  <path d="M17 17 7 7" />
</svg>
`,aL=`
<svg
  class="lucide lucide-arrow-up-narrow-wide"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <path d="M11 12h4" />
  <path d="M11 16h7" />
  <path d="M11 20h10" />
</svg>
`,aM=`
<svg
  class="lucide lucide-arrow-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 7h10v10" />
  <path d="M7 17 17 7" />
</svg>
`,aN=`
<svg
  class="lucide lucide-arrow-up-to-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 3h14" />
  <path d="m18 13-6-6-6 6" />
  <path d="M12 7v14" />
</svg>
`,aO=`
<svg
  class="lucide lucide-arrow-up-wide-narrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <path d="M11 12h10" />
  <path d="M11 16h7" />
  <path d="M11 20h4" />
</svg>
`,aP=`
<svg
  class="lucide lucide-arrow-up-z-a"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 8 4-4 4 4" />
  <path d="M7 4v16" />
  <path d="M15 4h5l-5 6h5" />
  <path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20" />
  <path d="M20 18h-5" />
</svg>
`,aQ=`
<svg
  class="lucide lucide-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m5 12 7-7 7 7" />
  <path d="M12 19V5" />
</svg>
`,aR=`
<svg
  class="lucide lucide-arrows-up-from-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m4 6 3-3 3 3" />
  <path d="M7 17V3" />
  <path d="m14 6 3-3 3 3" />
  <path d="M17 17V3" />
  <path d="M4 21h16" />
</svg>
`,aS=`
<svg
  class="lucide lucide-asterisk"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v12" />
  <path d="M17.196 9 6.804 15" />
  <path d="m6.804 9 10.392 6" />
</svg>
`,aT=`
<svg
  class="lucide lucide-at-sign"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="4" />
  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
</svg>
`,aU=`
<svg
  class="lucide lucide-atom"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="1" />
  <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
  <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
</svg>
`,aV=`
<svg
  class="lucide lucide-audio-lines"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 10v3" />
  <path d="M6 6v11" />
  <path d="M10 3v18" />
  <path d="M14 8v7" />
  <path d="M18 5v13" />
  <path d="M22 10v3" />
</svg>
`,aW=`
<svg
  class="lucide lucide-audio-waveform"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2" />
</svg>
`,aX=`
<svg
  class="lucide lucide-award"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" />
  <circle cx="12" cy="8" r="6" />
</svg>
`,aY=`
<svg
  class="lucide lucide-axe"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 12-8.381 8.38a1 1 0 0 1-3.001-3L11 9" />
  <path d="M15 15.5a.5.5 0 0 0 .5.5A6.5 6.5 0 0 0 22 9.5a.5.5 0 0 0-.5-.5h-1.672a2 2 0 0 1-1.414-.586l-5.062-5.062a1.205 1.205 0 0 0-1.704 0L9.352 5.648a1.205 1.205 0 0 0 0 1.704l5.062 5.062A2 2 0 0 1 15 13.828z" />
</svg>
`,aZ=`
<svg
  class="lucide lucide-baby"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
  <path d="M15 12h.01" />
  <path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
  <path d="M9 12h.01" />
</svg>
`,a$=`
<svg
  class="lucide lucide-axis-3d"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.5 10.5 15 9" />
  <path d="M4 4v15a1 1 0 0 0 1 1h15" />
  <path d="M4.293 19.707 6 18" />
  <path d="m9 15 1.5-1.5" />
</svg>
`,a_=`
<svg
  class="lucide lucide-backpack"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  <path d="M8 10h8" />
  <path d="M8 18h8" />
  <path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6" />
  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
</svg>
`,a0=`
<svg
  class="lucide lucide-badge-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <line x1="12" x2="12" y1="8" y2="12" />
  <line x1="12" x2="12.01" y1="16" y2="16" />
</svg>
`,a1=`
<svg
  class="lucide lucide-badge-cent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M12 7v10" />
  <path d="M15.4 10a4 4 0 1 0 0 4" />
</svg>
`,a2=`
<svg
  class="lucide lucide-badge-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="m9 12 2 2 4-4" />
</svg>
`,a3=`
<svg
  class="lucide lucide-badge-dollar-sign"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
  <path d="M12 18V6" />
</svg>
`,a4=`
<svg
  class="lucide lucide-badge-euro"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M7 12h5" />
  <path d="M15 9.4a4 4 0 1 0 0 5.2" />
</svg>
`,a5=`
<svg
  class="lucide lucide-badge-indian-rupee"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M8 8h8" />
  <path d="M8 12h8" />
  <path d="m13 17-5-1h1a4 4 0 0 0 0-8" />
</svg>
`,a6=`
<svg
  class="lucide lucide-badge-info"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <line x1="12" x2="12" y1="16" y2="12" />
  <line x1="12" x2="12.01" y1="8" y2="8" />
</svg>
`,a7=`
<svg
  class="lucide lucide-badge-japanese-yen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="m9 8 3 3v7" />
  <path d="m12 11 3-3" />
  <path d="M9 12h6" />
  <path d="M9 16h6" />
</svg>
`,a8=`
<svg
  class="lucide lucide-badge-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <line x1="8" x2="16" y1="12" y2="12" />
</svg>
`,a9=`
<svg
  class="lucide lucide-badge-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="m15 9-6 6" />
  <path d="M9 9h.01" />
  <path d="M15 15h.01" />
</svg>
`,ba=`
<svg
  class="lucide lucide-badge-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <line x1="12" x2="12" y1="8" y2="16" />
  <line x1="8" x2="16" y1="12" y2="12" />
</svg>
`,bb=`
<svg
  class="lucide lucide-badge-pound-sterling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M8 12h4" />
  <path d="M10 16V9.5a2.5 2.5 0 0 1 5 0" />
  <path d="M8 16h7" />
</svg>
`,bc=`
<svg
  class="lucide lucide-badge-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <line x1="12" x2="12.01" y1="17" y2="17" />
</svg>
`,bd=`
<svg
  class="lucide lucide-badge-russian-ruble"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M9 16h5" />
  <path d="M9 12h5a2 2 0 1 0 0-4h-3v9" />
</svg>
`,be=`
<svg
  class="lucide lucide-badge-swiss-franc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <path d="M11 17V8h4" />
  <path d="M11 12h3" />
  <path d="M9 16h4" />
</svg>
`,bf=`
<svg
  class="lucide lucide-badge-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
  <line x1="15" x2="9" y1="9" y2="15" />
  <line x1="9" x2="15" y1="9" y2="15" />
</svg>
`,bg=`
<svg
  class="lucide lucide-badge-turkish-lira"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 7v10a5 5 0 0 0 5-5" />
  <path d="m15 8-6 3" />
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76" />
</svg>
`,bh=`
<svg
  class="lucide lucide-badge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
</svg>
`,bi=`
<svg
  class="lucide lucide-baggage-claim"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 18H6a2 2 0 0 1-2-2V7a2 2 0 0 0-2-2" />
  <path d="M17 14V4a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v10" />
  <rect width="13" height="8" x="8" y="6" rx="1" />
  <circle cx="18" cy="20" r="2" />
  <circle cx="9" cy="20" r="2" />
</svg>
`,bj=`
<svg
  class="lucide lucide-banana"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 13c3.5-2 8-2 10 2a5.5 5.5 0 0 1 8 5" />
  <path d="M5.15 17.89c5.52-1.52 8.65-6.89 7-12C11.55 4 11.5 2 13 2c3.22 0 5 5.5 5 8 0 6.5-4.2 12-10.49 12C5.11 22 2 22 2 20c0-1.5 1.14-1.55 3.15-2.11Z" />
</svg>
`,bk=`
<svg
  class="lucide lucide-ban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.929 4.929 19.07 19.071" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,bl=`
<svg
  class="lucide lucide-bandage"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10.01h.01" />
  <path d="M10 14.01h.01" />
  <path d="M14 10.01h.01" />
  <path d="M14 14.01h.01" />
  <path d="M18 6v11.5" />
  <path d="M6 6v12" />
  <rect x="2" y="6" width="20" height="12" rx="2" />
</svg>
`,bm=`
<svg
  class="lucide lucide-banknote-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" />
  <path d="M18 12h.01" />
  <path d="M19 22v-6" />
  <path d="m22 19-3-3-3 3" />
  <path d="M6 12h.01" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,bn=`
<svg
  class="lucide lucide-banknote-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" />
  <path d="m16 19 3 3 3-3" />
  <path d="M18 12h.01" />
  <path d="M19 16v6" />
  <path d="M6 12h.01" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,bo=`
<svg
  class="lucide lucide-banknote-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" />
  <path d="m17 17 5 5" />
  <path d="M18 12h.01" />
  <path d="m22 17-5 5" />
  <path d="M6 12h.01" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,bp=`
<svg
  class="lucide lucide-banknote"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="12" x="2" y="6" rx="2" />
  <circle cx="12" cy="12" r="2" />
  <path d="M6 12h.01M18 12h.01" />
</svg>
`,bq=`
<svg
  class="lucide lucide-barrel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 3a41 41 0 0 0 0 18" />
  <path d="M14 3a41 41 0 0 1 0 18" />
  <path d="M17 3a2 2 0 0 1 1.68.92 15.25 15.25 0 0 1 0 16.16A2 2 0 0 1 17 21H7a2 2 0 0 1-1.68-.92 15.25 15.25 0 0 1 0-16.16A2 2 0 0 1 7 3z" />
  <path d="M3.84 17h16.32" />
  <path d="M3.84 7h16.32" />
</svg>
`,br=`
<svg
  class="lucide lucide-barcode"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5v14" />
  <path d="M8 5v14" />
  <path d="M12 5v14" />
  <path d="M17 5v14" />
  <path d="M21 5v14" />
</svg>
`,bs=`
<svg
  class="lucide lucide-baseline"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 20h16" />
  <path d="m6 16 6-12 6 12" />
  <path d="M8 12h8" />
</svg>
`,bt=`
<svg
  class="lucide lucide-bath"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 4 8 6" />
  <path d="M17 19v2" />
  <path d="M2 12h20" />
  <path d="M7 19v2" />
  <path d="M9 5 7.621 3.621A2.121 2.121 0 0 0 4 5v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
</svg>
`,bu=`
<svg
  class="lucide lucide-battery-charging"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 7-3 5h4l-3 5" />
  <path d="M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935" />
  <path d="M22 14v-4" />
  <path d="M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936" />
</svg>
`,bv=`
<svg
  class="lucide lucide-battery-full"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10v4" />
  <path d="M14 10v4" />
  <path d="M22 14v-4" />
  <path d="M6 10v4" />
  <rect x="2" y="6" width="16" height="12" rx="2" />
</svg>
`,bw=`
<svg
  class="lucide lucide-battery-low"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 14v-4" />
  <path d="M6 14v-4" />
  <rect x="2" y="6" width="16" height="12" rx="2" />
</svg>
`,bx=`
<svg
  class="lucide lucide-battery-medium"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 14v-4" />
  <path d="M22 14v-4" />
  <path d="M6 14v-4" />
  <rect x="2" y="6" width="16" height="12" rx="2" />
</svg>
`,by=`
<svg
  class="lucide lucide-battery-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9v6" />
  <path d="M12.543 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.605" />
  <path d="M22 14v-4" />
  <path d="M7 12h6" />
  <path d="M7.606 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.606" />
</svg>
`,bz=`
<svg
  class="lucide lucide-battery-warning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 17h.01" />
  <path d="M10 7v6" />
  <path d="M14 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
  <path d="M22 14v-4" />
  <path d="M6 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
</svg>
`,bA=`
<svg
  class="lucide lucide-battery"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M 22 14 L 22 10" />
  <rect x="2" y="6" width="16" height="12" rx="2" />
</svg>
`,bB=`
<svg
  class="lucide lucide-beaker"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.5 3h15" />
  <path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3" />
  <path d="M6 14h12" />
</svg>
`,bC=`
<svg
  class="lucide lucide-bean-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 9c-.64.64-1.521.954-2.402 1.165A6 6 0 0 0 8 22a13.96 13.96 0 0 0 9.9-4.1" />
  <path d="M10.75 5.093A6 6 0 0 1 22 8c0 2.411-.61 4.68-1.683 6.66" />
  <path d="M5.341 10.62a4 4 0 0 0 6.487 1.208M10.62 5.341a4.015 4.015 0 0 1 2.039 2.04" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,bD=`
<svg
  class="lucide lucide-bean"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.165 6.598C9.954 7.478 9.64 8.36 9 9c-.64.64-1.521.954-2.402 1.165A6 6 0 0 0 8 22c7.732 0 14-6.268 14-14a6 6 0 0 0-11.835-1.402Z" />
  <path d="M5.341 10.62a4 4 0 1 0 5.279-5.28" />
</svg>
`,bE=`
<svg
  class="lucide lucide-bed-double"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
  <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
  <path d="M12 4v6" />
  <path d="M2 18h20" />
</svg>
`,bF=`
<svg
  class="lucide lucide-bed-single"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
  <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
  <path d="M3 18h18" />
</svg>
`,bG=`
<svg
  class="lucide lucide-beef"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3" />
  <path d="m18.5 6 2.19 4.5a6.48 6.48 0 0 1-2.29 7.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5" />
  <circle cx="12.5" cy="8.5" r="2.5" />
</svg>
`,bH=`
<svg
  class="lucide lucide-bed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 4v16" />
  <path d="M2 8h18a2 2 0 0 1 2 2v10" />
  <path d="M2 17h20" />
  <path d="M6 8v9" />
</svg>
`,bI=`
<svg
  class="lucide lucide-beer-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 13v5" />
  <path d="M17 11.47V8" />
  <path d="M17 11h1a3 3 0 0 1 2.745 4.211" />
  <path d="m2 2 20 20" />
  <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" />
  <path d="M7.536 7.535C6.766 7.649 6.154 8 5.5 8a2.5 2.5 0 0 1-1.768-4.268" />
  <path d="M8.727 3.204C9.306 2.767 9.885 2 11 2c1.56 0 2 1.5 3 1.5s1.72-.5 2.5-.5a1 1 0 1 1 0 5c-.78 0-1.5-.5-2.5-.5a3.149 3.149 0 0 0-.842.12" />
  <path d="M9 14.6V18" />
</svg>
`,bJ=`
<svg
  class="lucide lucide-beer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
  <path d="M9 12v6" />
  <path d="M13 12v6" />
  <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z" />
  <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
</svg>
`,bK=`
<svg
  class="lucide lucide-bell-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M13.916 2.314A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.74 7.327A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673 9 9 0 0 1-.585-.665" />
  <circle cx="18" cy="8" r="3" />
</svg>
`,bL=`
<svg
  class="lucide lucide-bell-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M15 8h6" />
  <path d="M16.243 3.757A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673A9.4 9.4 0 0 1 18.667 12" />
</svg>
`,bM=`
<svg
  class="lucide lucide-bell-electric"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.518 17.347A7 7 0 0 1 14 19" />
  <path d="M18.8 4A11 11 0 0 1 20 9" />
  <path d="M9 9h.01" />
  <circle cx="20" cy="16" r="2" />
  <circle cx="9" cy="9" r="7" />
  <rect x="4" y="16" width="10" height="6" rx="2" />
</svg>
`,bN=`
<svg
  class="lucide lucide-bell-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
  <path d="m2 2 20 20" />
  <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
</svg>
`,bO=`
<svg
  class="lucide lucide-bell-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M15 8h6" />
  <path d="M18 5v6" />
  <path d="M20.002 14.464a9 9 0 0 0 .738.863A1 1 0 0 1 20 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 8.75-5.332" />
</svg>
`,bP=`
<svg
  class="lucide lucide-bell-ring"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M22 8c0-2.3-.8-4.3-2-6" />
  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
  <path d="M4 2C2.8 3.7 2 5.7 2 8" />
</svg>
`,bQ=`
<svg
  class="lucide lucide-between-horizontal-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="13" height="7" x="3" y="3" rx="1" />
  <path d="m22 15-3-3 3-3" />
  <rect width="13" height="7" x="3" y="14" rx="1" />
</svg>
`,bR=`
<svg
  class="lucide lucide-bell"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
</svg>
`,bS=`
<svg
  class="lucide lucide-between-horizontal-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="13" height="7" x="8" y="3" rx="1" />
  <path d="m2 9 3 3-3 3" />
  <rect width="13" height="7" x="8" y="14" rx="1" />
</svg>
`,bT=`
<svg
  class="lucide lucide-between-vertical-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="13" x="3" y="3" rx="1" />
  <path d="m9 22 3-3 3 3" />
  <rect width="7" height="13" x="14" y="3" rx="1" />
</svg>
`,bU=`
<svg
  class="lucide lucide-between-vertical-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="13" x="3" y="8" rx="1" />
  <path d="m15 2-3 3-3-3" />
  <rect width="7" height="13" x="14" y="8" rx="1" />
</svg>
`,bV=`
<svg
  class="lucide lucide-biceps-flexed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1" />
  <path d="M15 14a5 5 0 0 0-7.584 2" />
  <path d="M9.964 6.825C8.019 7.977 9.5 13 8 15" />
</svg>
`,bW=`
<svg
  class="lucide lucide-bike"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18.5" cy="17.5" r="3.5" />
  <circle cx="5.5" cy="17.5" r="3.5" />
  <circle cx="15" cy="5" r="1" />
  <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
</svg>
`,bX=`
<svg
  class="lucide lucide-binary"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="14" y="14" width="4" height="6" rx="2" />
  <rect x="6" y="4" width="4" height="6" rx="2" />
  <path d="M6 20h4" />
  <path d="M14 10h4" />
  <path d="M6 14h2v6" />
  <path d="M14 4h2v6" />
</svg>
`,bY=`
<svg
  class="lucide lucide-binoculars"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10h4" />
  <path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3" />
  <path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z" />
  <path d="M 22 16 L 2 16" />
  <path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z" />
  <path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3" />
</svg>
`,bZ=`
<svg
  class="lucide lucide-biohazard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="11.9" r="2" />
  <path d="M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6" />
  <path d="m8.9 10.1 1.4.8" />
  <path d="M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5" />
  <path d="m15.1 10.1-1.4.8" />
  <path d="M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2" />
  <path d="M12 13.9v1.6" />
  <path d="M13.5 5.4c-1-.2-2-.2-3 0" />
  <path d="M17 16.4c.7-.7 1.2-1.6 1.5-2.5" />
  <path d="M5.5 13.9c.3.9.8 1.8 1.5 2.5" />
</svg>
`,b$=`
<svg
  class="lucide lucide-bird"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 7h.01" />
  <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20" />
  <path d="m20 7 2 .5-2 .5" />
  <path d="M10 18v3" />
  <path d="M14 17.75V21" />
  <path d="M7 18a6 6 0 0 0 3.84-10.61" />
</svg>
`,b_=`
<svg
  class="lucide lucide-birdhouse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18v4" />
  <path d="m17 18 1.956-11.468" />
  <path d="m3 8 7.82-5.615a2 2 0 0 1 2.36 0L21 8" />
  <path d="M4 18h16" />
  <path d="M7 18 5.044 6.532" />
  <circle cx="12" cy="10" r="2" />
</svg>
`,b0=`
<svg
  class="lucide lucide-bitcoin"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727" />
</svg>
`,b1=`
<svg
  class="lucide lucide-blend"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="9" cy="9" r="7" />
  <circle cx="15" cy="15" r="7" />
</svg>
`,b2=`
<svg
  class="lucide lucide-blinds"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3h18" />
  <path d="M20 7H8" />
  <path d="M20 11H8" />
  <path d="M10 19h10" />
  <path d="M8 15h12" />
  <path d="M4 3v14" />
  <circle cx="4" cy="19" r="2" />
</svg>
`,b3=`
<svg
  class="lucide lucide-blocks"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
  <rect x="14" y="2" width="8" height="8" rx="1" />
</svg>
`,b4=`
<svg
  class="lucide lucide-bluetooth-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 17-5 5V12l-5 5" />
  <path d="m2 2 20 20" />
  <path d="M14.5 9.5 17 7l-5-5v4.5" />
</svg>
`,b5=`
<svg
  class="lucide lucide-bluetooth-connected"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 7 10 10-5 5V2l5 5L7 17" />
  <line x1="18" x2="21" y1="12" y2="12" />
  <line x1="3" x2="6" y1="12" y2="12" />
</svg>
`,b6=`
<svg
  class="lucide lucide-bluetooth-searching"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 7 10 10-5 5V2l5 5L7 17" />
  <path d="M20.83 14.83a4 4 0 0 0 0-5.66" />
  <path d="M18 12h.01" />
</svg>
`,b7=`
<svg
  class="lucide lucide-bluetooth"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 7 10 10-5 5V2l5 5L7 17" />
</svg>
`,b8=`
<svg
  class="lucide lucide-bold"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
</svg>
`,b9=`
<svg
  class="lucide lucide-bolt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  <circle cx="12" cy="12" r="4" />
</svg>
`,ca=`
<svg
  class="lucide lucide-bomb"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="13" r="9" />
  <path d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95" />
  <path d="m22 2-1.5 1.5" />
</svg>
`,cb=`
<svg
  class="lucide lucide-bone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z" />
</svg>
`,cc=`
<svg
  class="lucide lucide-book-a"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="m8 13 4-7 4 7" />
  <path d="M9.1 11h5.7" />
</svg>
`,cd=`
<svg
  class="lucide lucide-book-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13h.01" />
  <path d="M12 6v3" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
</svg>
`,ce=`
<svg
  class="lucide lucide-book-audio"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v7" />
  <path d="M16 8v3" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M8 8v3" />
</svg>
`,cf=`
<svg
  class="lucide lucide-book-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="m9 9.5 2 2 4-4" />
</svg>
`,cg=`
<svg
  class="lucide lucide-book-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17h1.5" />
  <path d="M12 22h1.5" />
  <path d="M12 2h1.5" />
  <path d="M17.5 22H19a1 1 0 0 0 1-1" />
  <path d="M17.5 2H19a1 1 0 0 1 1 1v1.5" />
  <path d="M20 14v3h-2.5" />
  <path d="M20 8.5V10" />
  <path d="M4 10V8.5" />
  <path d="M4 19.5V14" />
  <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H8" />
  <path d="M8 22H6.5a1 1 0 0 1 0-5H8" />
</svg>
`,ch=`
<svg
  class="lucide lucide-book-copy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 7a2 2 0 0 0-2 2v11" />
  <path d="M5.803 18H5a2 2 0 0 0 0 4h9.5a.5.5 0 0 0 .5-.5V21" />
  <path d="M9 15V4a2 2 0 0 1 2-2h9.5a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H11a2 2 0 0 1 0-4h10" />
</svg>
`,ci=`
<svg
  class="lucide lucide-book-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13V7" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="m9 10 3 3 3-3" />
</svg>
`,cj=`
<svg
  class="lucide lucide-book-headphones"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M8 12v-2a4 4 0 0 1 8 0v2" />
  <circle cx="15" cy="12" r="1" />
  <circle cx="9" cy="12" r="1" />
</svg>
`,ck=`
<svg
  class="lucide lucide-book-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M8.62 9.8A2.25 2.25 0 1 1 12 6.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0z" />
</svg>
`,cl=`
<svg
  class="lucide lucide-book-image"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m20 13.7-2.1-2.1a2 2 0 0 0-2.8 0L9.7 17" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <circle cx="10" cy="8" r="2" />
</svg>
`,cm=`
<svg
  class="lucide lucide-book-key"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 3 1 1" />
  <path d="m20 2-4.5 4.5" />
  <path d="M20 7.898V21a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2h7.844" />
  <circle cx="14" cy="8" r="2" />
</svg>
`,cn=`
<svg
  class="lucide lucide-book-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 6V4a2 2 0 1 0-4 0v2" />
  <path d="M20 15v6a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H10" />
  <rect x="12" y="6" width="8" height="5" rx="1" />
</svg>
`,co=`
<svg
  class="lucide lucide-book-marked"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v8l3-3 3 3V2" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
</svg>
`,cp=`
<svg
  class="lucide lucide-book-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M9 10h6" />
</svg>
`,cq=`
<svg
  class="lucide lucide-book-open-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 21V7" />
  <path d="m16 12 2 2 4-4" />
  <path d="M22 6V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4 4 4 0 0 0-4-4H3a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6a1 1 0 0 0 1-1v-1.3" />
</svg>
`,cr=`
<svg
  class="lucide lucide-book-open-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v14" />
  <path d="M16 12h2" />
  <path d="M16 8h2" />
  <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  <path d="M6 12h2" />
  <path d="M6 8h2" />
</svg>
`,cs=`
<svg
  class="lucide lucide-book-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v14" />
  <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
</svg>
`,ct=`
<svg
  class="lucide lucide-book-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v6" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M9 10h6" />
</svg>
`,cu=`
<svg
  class="lucide lucide-book-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M8 11h8" />
  <path d="M8 7h6" />
</svg>
`,cv=`
<svg
  class="lucide lucide-book-type"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 13h4" />
  <path d="M12 6v7" />
  <path d="M16 8V6H8v2" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
</svg>
`,cw=`
<svg
  class="lucide lucide-book-up-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13V7" />
  <path d="M18 2h1a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2" />
  <path d="m9 10 3-3 3 3" />
  <path d="m9 5 3-3 3 3" />
</svg>
`,cx=`
<svg
  class="lucide lucide-book-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 13a3 3 0 1 0-6 0" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <circle cx="12" cy="8" r="2" />
</svg>
`,cy=`
<svg
  class="lucide lucide-book-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13V7" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="m9 10 3-3 3 3" />
</svg>
`,cz=`
<svg
  class="lucide lucide-book-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.5 7-5 5" />
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  <path d="m9.5 7 5 5" />
</svg>
`,cA=`
<svg
  class="lucide lucide-book"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
</svg>
`,cB=`
<svg
  class="lucide lucide-bookmark-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
  <line x1="15" x2="9" y1="10" y2="10" />
</svg>
`,cC=`
<svg
  class="lucide lucide-bookmark-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  <path d="m9 10 2 2 4-4" />
</svg>
`,cD=`
<svg
  class="lucide lucide-bookmark-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
  <line x1="12" x2="12" y1="7" y2="13" />
  <line x1="15" x2="9" y1="10" y2="10" />
</svg>
`,cE=`
<svg
  class="lucide lucide-bookmark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
</svg>
`,cF=`
<svg
  class="lucide lucide-bookmark-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  <path d="m14.5 7.5-5 5" />
  <path d="m9.5 7.5 5 5" />
</svg>
`,cG=`
<svg
  class="lucide lucide-bot-message-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6V2H8" />
  <path d="M15 11v2" />
  <path d="M2 12h2" />
  <path d="M20 12h2" />
  <path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  <path d="M9 11v2" />
</svg>
`,cH=`
<svg
  class="lucide lucide-boom-box"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 9V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
  <path d="M8 8v1" />
  <path d="M12 8v1" />
  <path d="M16 8v1" />
  <rect width="20" height="12" x="2" y="9" rx="2" />
  <circle cx="8" cy="15" r="2" />
  <circle cx="16" cy="15" r="2" />
</svg>
`,cI=`
<svg
  class="lucide lucide-bot-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.67 8H18a2 2 0 0 1 2 2v4.33" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M22 22 2 2" />
  <path d="M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 1.414-.586" />
  <path d="M9 13v2" />
  <path d="M9.67 4H12v2.33" />
</svg>`,cJ=`
<svg
  class="lucide lucide-bot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 8V4H8" />
  <rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M15 13v2" />
  <path d="M9 13v2" />
</svg>
`,cK=`
<svg
  class="lucide lucide-bottle-wine"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a6 6 0 0 0 1.2 3.6l.6.8A6 6 0 0 1 17 13v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8a6 6 0 0 1 1.2-3.6l.6-.8A6 6 0 0 0 10 5z" />
  <path d="M17 13h-4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h4" />
</svg>
`,cL=`
<svg
  class="lucide lucide-bow-arrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 3h4v4" />
  <path d="M18.575 11.082a13 13 0 0 1 1.048 9.027 1.17 1.17 0 0 1-1.914.597L14 17" />
  <path d="M7 10 3.29 6.29a1.17 1.17 0 0 1 .6-1.91 13 13 0 0 1 9.03 1.05" />
  <path d="M7 14a1.7 1.7 0 0 0-1.207.5l-2.646 2.646A.5.5 0 0 0 3.5 18H5a1 1 0 0 1 1 1v1.5a.5.5 0 0 0 .854.354L9.5 18.207A1.7 1.7 0 0 0 10 17v-2a1 1 0 0 0-1-1z" />
  <path d="M9.707 14.293 21 3" />
</svg>
`,cM=`
<svg
  class="lucide lucide-box"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
  <path d="m3.3 7 8.7 5 8.7-5" />
  <path d="M12 22V12" />
</svg>
`,cN=`
<svg
  class="lucide lucide-boxes"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
  <path d="m7 16.5-4.74-2.85" />
  <path d="m7 16.5 5-3" />
  <path d="M7 16.5v5.17" />
  <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
  <path d="m17 16.5-5-3" />
  <path d="m17 16.5 4.74-2.85" />
  <path d="M17 16.5v5.17" />
  <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
  <path d="M12 8 7.26 5.15" />
  <path d="m12 8 4.74-2.85" />
  <path d="M12 13.5V8" />
</svg>
`,cO=`
<svg
  class="lucide lucide-braces"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
  <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
</svg>
`,cP=`
<svg
  class="lucide lucide-brackets"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3" />
  <path d="M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" />
</svg>
`,cQ=`
<svg
  class="lucide lucide-brain-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10.852 14.772-.383.923" />
  <path d="m10.852 9.228-.383-.923" />
  <path d="m13.148 14.772.382.924" />
  <path d="m13.531 8.305-.383.923" />
  <path d="m14.772 10.852.923-.383" />
  <path d="m14.772 13.148.923.383" />
  <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 0 0-5.63-1.446 3 3 0 0 0-.368 1.571 4 4 0 0 0-2.525 5.771" />
  <path d="M17.998 5.125a4 4 0 0 1 2.525 5.771" />
  <path d="M19.505 10.294a4 4 0 0 1-1.5 7.706" />
  <path d="M4.032 17.483A4 4 0 0 0 11.464 20c.18-.311.892-.311 1.072 0a4 4 0 0 0 7.432-2.516" />
  <path d="M4.5 10.291A4 4 0 0 0 6 18" />
  <path d="M6.002 5.125a3 3 0 0 0 .4 1.375" />
  <path d="m9.228 10.852-.923-.383" />
  <path d="m9.228 13.148-.923.383" />
  <circle cx="12" cy="12" r="3" />
</svg>
`,cR=`
<svg
  class="lucide lucide-brain-circuit"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
  <path d="M9 13a4.5 4.5 0 0 0 3-4" />
  <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
  <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
  <path d="M6 18a4 4 0 0 1-1.967-.516" />
  <path d="M12 13h4" />
  <path d="M12 18h6a2 2 0 0 1 2 2v1" />
  <path d="M12 8h8" />
  <path d="M16 8V5a2 2 0 0 1 2-2" />
  <circle cx="16" cy="13" r=".5" />
  <circle cx="18" cy="3" r=".5" />
  <circle cx="20" cy="21" r=".5" />
  <circle cx="20" cy="8" r=".5" />
</svg>
`,cS=`
<svg
  class="lucide lucide-brain"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18V5" />
  <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
  <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
  <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
  <path d="M18 18a4 4 0 0 0 2-7.464" />
  <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
  <path d="M6 18a4 4 0 0 1-2-7.464" />
  <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
</svg>
`,cT=`
<svg
  class="lucide lucide-brick-wall-shield"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 9v1.258" />
  <path d="M16 3v5.46" />
  <path d="M21 9.118V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5.75" />
  <path d="M22 17.5c0 2.499-1.75 3.749-3.83 4.474a.5.5 0 0 1-.335-.005c-2.085-.72-3.835-1.97-3.835-4.47V14a.5.5 0 0 1 .5-.499c1 0 2.25-.6 3.12-1.36a.6.6 0 0 1 .76-.001c.875.765 2.12 1.36 3.12 1.36a.5.5 0 0 1 .5.5z" />
  <path d="M3 15h7" />
  <path d="M3 9h12.142" />
  <path d="M8 15v6" />
  <path d="M8 3v6" />
</svg>
`,cU=`
<svg
  class="lucide lucide-brick-wall-fire"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3v2.107" />
  <path d="M17 9c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 22 17a5 5 0 0 1-10 0c0-.3 0-.6.1-.9a2 2 0 1 0 3.3-2C13 11.5 16 9 17 9" />
  <path d="M21 8.274V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.938" />
  <path d="M3 15h5.253" />
  <path d="M3 9h8.228" />
  <path d="M8 15v6" />
  <path d="M8 3v6" />
</svg>
`,cV=`
<svg
  class="lucide lucide-brick-wall"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M12 9v6" />
  <path d="M16 15v6" />
  <path d="M16 3v6" />
  <path d="M3 15h18" />
  <path d="M3 9h18" />
  <path d="M8 15v6" />
  <path d="M8 3v6" />
</svg>
`,cW=`
<svg
  class="lucide lucide-briefcase-business"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12h.01" />
  <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  <path d="M22 13a18.15 18.15 0 0 1-20 0" />
  <rect width="20" height="14" x="2" y="6" rx="2" />
</svg>
`,cX=`
<svg
  class="lucide lucide-briefcase-conveyor-belt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 20v2" />
  <path d="M14 20v2" />
  <path d="M18 20v2" />
  <path d="M21 20H3" />
  <path d="M6 20v2" />
  <path d="M8 16V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v12" />
  <rect x="4" y="6" width="16" height="10" rx="2" />
</svg>
`,cY=`
<svg
  class="lucide lucide-briefcase-medical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 11v4" />
  <path d="M14 13h-4" />
  <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  <path d="M18 6v14" />
  <path d="M6 6v14" />
  <rect width="20" height="14" x="2" y="6" rx="2" />
</svg>
`,cZ=`
<svg
  class="lucide lucide-briefcase"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  <rect width="20" height="14" x="2" y="6" rx="2" />
</svg>
`,c$=`
<svg
  class="lucide lucide-bring-to-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="8" y="8" width="8" height="8" rx="2" />
  <path d="M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2" />
  <path d="M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2" />
</svg>
`,c_=`
<svg
  class="lucide lucide-brush-cleaning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 22-1-4" />
  <path d="M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1" />
  <path d="M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z" />
  <path d="m8 22 1-4" />
</svg>
`,c0=`
<svg
  class="lucide lucide-brush"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 10 3 3" />
  <path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" />
  <path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" />
</svg>
`,c1=`
<svg
  class="lucide lucide-bubbles"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7.2 14.8a2 2 0 0 1 2 2" />
  <circle cx="18.5" cy="8.5" r="3.5" />
  <circle cx="7.5" cy="16.5" r="5.5" />
  <circle cx="7.5" cy="4.5" r="2.5" />
</svg>
`,c2=`
<svg
  class="lucide lucide-bug-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20v-8" />
  <path d="M14.12 3.88 16 2" />
  <path d="M15 7.13V6a3 3 0 0 0-5.14-2.1L8 2" />
  <path d="M18 12.34V11a4 4 0 0 0-4-4h-1.3" />
  <path d="m2 2 20 20" />
  <path d="M21 5a4 4 0 0 1-3.55 3.97" />
  <path d="M22 13h-3.34" />
  <path d="M3 21a4 4 0 0 1 3.81-4" />
  <path d="M6 13H2" />
  <path d="M7.7 7.7A4 4 0 0 0 6 11v3a6 6 0 0 0 11.13 3.13" />
</svg>
`,c3=`
<svg
  class="lucide lucide-bug-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 19.655A6 6 0 0 1 6 14v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 3.97" />
  <path d="M14 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z" />
  <path d="M14.12 3.88 16 2" />
  <path d="M21 5a4 4 0 0 1-3.55 3.97" />
  <path d="M3 21a4 4 0 0 1 3.81-4" />
  <path d="M3 5a4 4 0 0 0 3.55 3.97" />
  <path d="M6 13H2" />
  <path d="m8 2 1.88 1.88" />
  <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
</svg>
`,c4=`
<svg
  class="lucide lucide-bug"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20v-9" />
  <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
  <path d="M14.12 3.88 16 2" />
  <path d="M21 21a4 4 0 0 0-3.81-4" />
  <path d="M21 5a4 4 0 0 1-3.55 3.97" />
  <path d="M22 13h-4" />
  <path d="M3 21a4 4 0 0 1 3.81-4" />
  <path d="M3 5a4 4 0 0 0 3.55 3.97" />
  <path d="M6 13H2" />
  <path d="m8 2 1.88 1.88" />
  <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
</svg>
`,c5=`
<svg
  class="lucide lucide-building-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 12h4" />
  <path d="M10 8h4" />
  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
  <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
  <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
</svg>
`,c6=`
<svg
  class="lucide lucide-building"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10h.01" />
  <path d="M12 14h.01" />
  <path d="M12 6h.01" />
  <path d="M16 10h.01" />
  <path d="M16 14h.01" />
  <path d="M16 6h.01" />
  <path d="M8 10h.01" />
  <path d="M8 14h.01" />
  <path d="M8 6h.01" />
  <path d="M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  <rect x="4" y="2" width="16" height="20" rx="2" />
</svg>
`,c7=`
<svg
  class="lucide lucide-bus-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 6 2 7" />
  <path d="M10 6h4" />
  <path d="m22 7-2-1" />
  <rect width="16" height="16" x="4" y="3" rx="2" />
  <path d="M4 11h16" />
  <path d="M8 15h.01" />
  <path d="M16 15h.01" />
  <path d="M6 19v2" />
  <path d="M18 21v-2" />
</svg>
`,c8=`
<svg
  class="lucide lucide-bus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 6v6" />
  <path d="M15 6v6" />
  <path d="M2 12h19.6" />
  <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" />
  <circle cx="7" cy="18" r="2" />
  <path d="M9 18h5" />
  <circle cx="16" cy="18" r="2" />
</svg>
`,c9=`
<svg
  class="lucide lucide-cable-car"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 3h.01" />
  <path d="M14 2h.01" />
  <path d="m2 9 20-5" />
  <path d="M12 12V6.5" />
  <rect width="16" height="10" x="4" y="12" rx="3" />
  <path d="M9 12v5" />
  <path d="M15 12v5" />
  <path d="M4 17h16" />
</svg>
`,da=`
<svg
  class="lucide lucide-cable"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z" />
  <path d="M17 21v-2" />
  <path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10" />
  <path d="M21 21v-2" />
  <path d="M3 5V3" />
  <path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z" />
  <path d="M7 5V3" />
</svg>
`,db=`
<svg
  class="lucide lucide-cake-slice"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 13H3" />
  <path d="M16 17H3" />
  <path d="m7.2 7.9-3.388 2.5A2 2 0 0 0 3 12.01V20a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-8.654c0-2-2.44-6.026-6.44-8.026a1 1 0 0 0-1.082.057L10.4 5.6" />
  <circle cx="9" cy="7" r="2" />
</svg>
`,dc=`
<svg
  class="lucide lucide-cake"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
  <path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1" />
  <path d="M2 21h20" />
  <path d="M7 8v3" />
  <path d="M12 8v3" />
  <path d="M17 8v3" />
  <path d="M7 4h.01" />
  <path d="M12 4h.01" />
  <path d="M17 4h.01" />
</svg>
`,dd=`
<svg
  class="lucide lucide-calculator"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="20" x="4" y="2" rx="2" />
  <line x1="8" x2="16" y1="6" y2="6" />
  <line x1="16" x2="16" y1="14" y2="18" />
  <path d="M16 10h.01" />
  <path d="M12 10h.01" />
  <path d="M8 10h.01" />
  <path d="M12 14h.01" />
  <path d="M8 14h.01" />
  <path d="M12 18h.01" />
  <path d="M8 18h.01" />
</svg>
`,de=`
<svg
  class="lucide lucide-calendar-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 14h1v4" />
  <path d="M16 2v4" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
  <rect x="3" y="4" width="18" height="18" rx="2" />
</svg>
`,df=`
<svg
  class="lucide lucide-calendar-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 18 4 4 4-4" />
  <path d="M16 2v4" />
  <path d="M18 14v8" />
  <path d="M21 11.354V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.343" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
</svg>
`,dg=`
<svg
  class="lucide lucide-calendar-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 18 4-4 4 4" />
  <path d="M16 2v4" />
  <path d="M18 22v-8" />
  <path d="M21 11.343V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
</svg>
`,dh=`
<svg
  class="lucide lucide-calendar-check-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <path d="M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
  <path d="M3 10h18" />
  <path d="m16 20 2 2 4-4" />
</svg>
`,di=`
<svg
  class="lucide lucide-calendar-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
  <path d="m9 16 2 2 4-4" />
</svg>
`,dj=`
<svg
  class="lucide lucide-calendar-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 14v2.2l1.6 1" />
  <path d="M16 2v4" />
  <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
  <path d="M3 10h5" />
  <path d="M8 2v4" />
  <circle cx="16" cy="16" r="6" />
</svg>
`,dk=`
<svg
  class="lucide lucide-calendar-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15.228 16.852-.923-.383" />
  <path d="m15.228 19.148-.923.383" />
  <path d="M16 2v4" />
  <path d="m16.47 14.305.382.923" />
  <path d="m16.852 20.772-.383.924" />
  <path d="m19.148 15.228.383-.923" />
  <path d="m19.53 21.696-.382-.924" />
  <path d="m20.772 16.852.924-.383" />
  <path d="m20.772 19.148.924.383" />
  <path d="M21 10.592V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,dl=`
<svg
  class="lucide lucide-calendar-days"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
  <path d="M8 14h.01" />
  <path d="M12 14h.01" />
  <path d="M16 14h.01" />
  <path d="M8 18h.01" />
  <path d="M12 18h.01" />
  <path d="M16 18h.01" />
</svg>
`,dm=`
<svg
  class="lucide lucide-calendar-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.127 22H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.125" />
  <path d="M14.62 18.8A2.25 2.25 0 1 1 18 15.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0z" />
  <path d="M16 2v4" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
</svg>
`,dn=`
<svg
  class="lucide lucide-calendar-fold"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 20a2 2 0 0 0 2 2h10a2.4 2.4 0 0 0 1.706-.706l3.588-3.588A2.4 2.4 0 0 0 21 16V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
  <path d="M15 22v-5a1 1 0 0 1 1-1h5" />
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <path d="M3 10h18" />
</svg>
`,dp=`
<svg
  class="lucide lucide-calendar-minus-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
  <path d="M10 16h4" />
</svg>
`,dq=`
<svg
  class="lucide lucide-calendar-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 19h6" />
  <path d="M16 2v4" />
  <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
</svg>
`,dr=`
<svg
  class="lucide lucide-calendar-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.82-1.18" />
  <path d="M21 15.5V6a2 2 0 0 0-2-2H9.5" />
  <path d="M16 2v4" />
  <path d="M3 10h7" />
  <path d="M21 10h-5.5" />
  <path d="m2 2 20 20" />
</svg>
`,ds=`
<svg
  class="lucide lucide-calendar-plus-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
  <path d="M10 16h4" />
  <path d="M12 14v4" />
</svg>
`,dt=`
<svg
  class="lucide lucide-calendar-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 19h6" />
  <path d="M16 2v4" />
  <path d="M19 16v6" />
  <path d="M21 12.598V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
</svg>
`,du=`
<svg
  class="lucide lucide-calendar-range"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M16 2v4" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
  <path d="M17 14h-6" />
  <path d="M13 18H7" />
  <path d="M7 14h.01" />
  <path d="M17 18h.01" />
</svg>
`,dv=`
<svg
  class="lucide lucide-calendar-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 2v4" />
  <path d="M21 11.75V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.25" />
  <path d="m22 22-1.875-1.875" />
  <path d="M3 10h18" />
  <path d="M8 2v4" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,dw=`
<svg
  class="lucide lucide-calendar-sync"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 10v4h4" />
  <path d="m11 14 1.535-1.605a5 5 0 0 1 8 1.5" />
  <path d="M16 2v4" />
  <path d="m21 18-1.535 1.605a5 5 0 0 1-8-1.5" />
  <path d="M21 22v-4h-4" />
  <path d="M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.3" />
  <path d="M3 10h4" />
  <path d="M8 2v4" />
</svg>
`,dx=`
<svg
  class="lucide lucide-calendar-x-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
  <path d="M3 10h18" />
  <path d="m17 22 5-5" />
  <path d="m17 17 5 5" />
</svg>
`,dy=`
<svg
  class="lucide lucide-calendar-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
  <path d="m14 14-4 4" />
  <path d="m10 14 4 4" />
</svg>
`,dz=`
<svg
  class="lucide lucide-calendar"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" x="3" y="4" rx="2" />
  <path d="M3 10h18" />
</svg>
`,dA=`
<svg
  class="lucide lucide-camera-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.564 14.558a3 3 0 1 1-4.122-4.121" />
  <path d="m2 2 20 20" />
  <path d="M20 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 .819-.175" />
  <path d="M9.695 4.024A2 2 0 0 1 10.004 4h3.993a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v7.344" />
</svg>
`,dB=`
<svg
  class="lucide lucide-camera"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
  <circle cx="12" cy="13" r="3" />
</svg>
`,dC=`
<svg
  class="lucide lucide-candy-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10v7.9" />
  <path d="M11.802 6.145a5 5 0 0 1 6.053 6.053" />
  <path d="M14 6.1v2.243" />
  <path d="m15.5 15.571-.964.964a5 5 0 0 1-7.071 0 5 5 0 0 1 0-7.07l.964-.965" />
  <path d="M16 7V3a1 1 0 0 1 1.707-.707 2.5 2.5 0 0 0 2.152.717 1 1 0 0 1 1.131 1.131 2.5 2.5 0 0 0 .717 2.152A1 1 0 0 1 21 8h-4" />
  <path d="m2 2 20 20" />
  <path d="M8 17v4a1 1 0 0 1-1.707.707 2.5 2.5 0 0 0-2.152-.717 1 1 0 0 1-1.131-1.131 2.5 2.5 0 0 0-.717-2.152A1 1 0 0 1 3 16h4" />
</svg>
`,dD=`
<svg
  class="lucide lucide-candy-cane"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5.7 21a2 2 0 0 1-3.5-2l8.6-14a6 6 0 0 1 10.4 6 2 2 0 1 1-3.464-2 2 2 0 1 0-3.464-2Z" />
  <path d="M17.75 7 15 2.1" />
  <path d="M10.9 4.8 13 9" />
  <path d="m7.9 9.7 2 4.4" />
  <path d="M4.9 14.7 7 18.9" />
</svg>
`,dE=`
<svg
  class="lucide lucide-candy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 7v10.9" />
  <path d="M14 6.1V17" />
  <path d="M16 7V3a1 1 0 0 1 1.707-.707 2.5 2.5 0 0 0 2.152.717 1 1 0 0 1 1.131 1.131 2.5 2.5 0 0 0 .717 2.152A1 1 0 0 1 21 8h-4" />
  <path d="M16.536 7.465a5 5 0 0 0-7.072 0l-2 2a5 5 0 0 0 0 7.07 5 5 0 0 0 7.072 0l2-2a5 5 0 0 0 0-7.07" />
  <path d="M8 17v4a1 1 0 0 1-1.707.707 2.5 2.5 0 0 0-2.152-.717 1 1 0 0 1-1.131-1.131 2.5 2.5 0 0 0-.717-2.152A1 1 0 0 1 3 16h4" />
</svg>
`,dF=`
<svg
  class="lucide lucide-cannabis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-4" />
  <path d="M7 12c-1.5 0-4.5 1.5-5 3 3.5 1.5 6 1 6 1-1.5 1.5-2 3.5-2 5 2.5 0 4.5-1.5 6-3 1.5 1.5 3.5 3 6 3 0-1.5-.5-3.5-2-5 0 0 2.5.5 6-1-.5-1.5-3.5-3-5-3 1.5-1 4-4 4-6-2.5 0-5.5 1.5-7 3 0-2.5-.5-5-2-7-1.5 2-2 4.5-2 7-1.5-1.5-4.5-3-7-3 0 2 2.5 5 4 6" />
</svg>
`,dG=`
<svg
  class="lucide lucide-captions-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 5H19a2 2 0 0 1 2 2v8.5" />
  <path d="M17 11h-.5" />
  <path d="M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2" />
  <path d="m2 2 20 20" />
  <path d="M7 11h4" />
  <path d="M7 15h2.5" />
</svg>
`,dH=`
<svg
  class="lucide lucide-captions"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
  <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
</svg>`,dI=`
<svg
  class="lucide lucide-car-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
  <path d="M7 14h.01" />
  <path d="M17 14h.01" />
  <rect width="18" height="8" x="3" y="10" rx="2" />
  <path d="M5 18v2" />
  <path d="M19 18v2" />
</svg>
`,dJ=`
<svg
  class="lucide lucide-car-taxi-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2h4" />
  <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
  <path d="M7 14h.01" />
  <path d="M17 14h.01" />
  <rect width="18" height="8" x="3" y="10" rx="2" />
  <path d="M5 18v2" />
  <path d="M19 18v2" />
</svg>
`,dK=`
<svg
  class="lucide lucide-car"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
  <circle cx="7" cy="17" r="2" />
  <path d="M9 17h6" />
  <circle cx="17" cy="17" r="2" />
</svg>
`,dL=`
<svg
  class="lucide lucide-caravan"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 19V9a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v8a2 2 0 0 0 2 2h2" />
  <path d="M2 9h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2" />
  <path d="M22 17v1a1 1 0 0 1-1 1H10v-9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9" />
  <circle cx="8" cy="19" r="2" />
</svg>
`,dM=`
<svg
  class="lucide lucide-card-sim"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 14v4" />
  <path d="M14.172 2a2 2 0 0 1 1.414.586l3.828 3.828A2 2 0 0 1 20 7.828V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
  <path d="M8 14h8" />
  <rect x="8" y="10" width="8" height="8" rx="1" />
</svg>
`,dN=`
<svg
  class="lucide lucide-carrot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46" />
  <path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z" />
  <path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z" />
</svg>
`,dO=`
<svg
  class="lucide lucide-case-lower"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9v7" />
  <path d="M14 6v10" />
  <circle cx="17.5" cy="12.5" r="3.5" />
  <circle cx="6.5" cy="12.5" r="3.5" />
</svg>
`,dP=`
<svg
  class="lucide lucide-case-sensitive"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
  <path d="M22 9v7" />
  <path d="M3.304 13h6.392" />
  <circle cx="18.5" cy="12.5" r="3.5" />
</svg>
`,dQ=`
<svg
  class="lucide lucide-case-upper"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 11h4.5a1 1 0 0 1 0 5h-4a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h3a1 1 0 0 1 0 5" />
  <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
  <path d="M3.304 13h6.392" />
</svg>
`,dR=`
<svg
  class="lucide lucide-cassette-tape"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <circle cx="8" cy="10" r="2" />
  <path d="M8 12h8" />
  <circle cx="16" cy="10" r="2" />
  <path d="m6 20 .7-2.9A1.4 1.4 0 0 1 8.1 16h7.8a1.4 1.4 0 0 1 1.4 1l.7 3" />
</svg>
`,dS=`
<svg
  class="lucide lucide-cast"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
  <path d="M2 12a9 9 0 0 1 8 8" />
  <path d="M2 16a5 5 0 0 1 4 4" />
  <line x1="2" x2="2.01" y1="20" y2="20" />
</svg>
`,dT=`
<svg
  class="lucide lucide-castle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 5V3" />
  <path d="M14 5V3" />
  <path d="M15 21v-3a3 3 0 0 0-6 0v3" />
  <path d="M18 3v8" />
  <path d="M18 5H6" />
  <path d="M22 11H2" />
  <path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9" />
  <path d="M6 3v8" />
</svg>
`,dU=`
<svg
  class="lucide lucide-cat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" />
  <path d="M8 14v.5" />
  <path d="M16 14v.5" />
  <path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />
</svg>
`,dV=`
<svg
  class="lucide lucide-cctv"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97" />
  <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z" />
  <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
  <path d="M2 21v-4" />
  <path d="M7 9h.01" />
</svg>
`,dW=`
<svg
  class="lucide lucide-chart-area"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 11.207a.5.5 0 0 1 .146-.353l2-2a.5.5 0 0 1 .708 0l3.292 3.292a.5.5 0 0 0 .708 0l4.292-4.292a.5.5 0 0 1 .854.353V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
</svg>
`,dX=`
<svg
  class="lucide lucide-chart-bar-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <rect x="7" y="13" width="9" height="4" rx="1" />
  <rect x="7" y="5" width="12" height="4" rx="1" />
</svg>
`,dY=`
<svg
  class="lucide lucide-chart-bar-decreasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 11h8" />
  <path d="M7 16h3" />
  <path d="M7 6h12" />
</svg>
`,dZ=`
<svg
  class="lucide lucide-chart-bar-increasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 11h8" />
  <path d="M7 16h12" />
  <path d="M7 6h3" />
</svg>
`,d$=`
<svg
  class="lucide lucide-chart-bar-stacked"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 13v4" />
  <path d="M15 5v4" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <rect x="7" y="13" width="9" height="4" rx="1" />
  <rect x="7" y="5" width="12" height="4" rx="1" />
</svg>
`,d_=`
<svg
  class="lucide lucide-chart-bar"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 16h8" />
  <path d="M7 11h12" />
  <path d="M7 6h3" />
</svg>
`,d0=`
<svg
  class="lucide lucide-chart-candlestick"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 5v4" />
  <rect width="4" height="6" x="7" y="9" rx="1" />
  <path d="M9 15v2" />
  <path d="M17 3v2" />
  <rect width="4" height="8" x="15" y="5" rx="1" />
  <path d="M17 13v3" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
</svg>
`,d1=`
<svg
  class="lucide lucide-chart-column-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <rect x="15" y="5" width="4" height="12" rx="1" />
  <rect x="7" y="8" width="4" height="9" rx="1" />
</svg>
`,d2=`
<svg
  class="lucide lucide-chart-column-decreasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 17V9" />
  <path d="M18 17v-3" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M8 17V5" />
</svg>
`,d3=`
<svg
  class="lucide lucide-chart-column-increasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 17V9" />
  <path d="M18 17V5" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M8 17v-3" />
</svg>
`,d4=`
<svg
  class="lucide lucide-chart-column-stacked"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 13H7" />
  <path d="M19 9h-4" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <rect x="15" y="5" width="4" height="12" rx="1" />
  <rect x="7" y="8" width="4" height="9" rx="1" />
</svg>
`,d5=`
<svg
  class="lucide lucide-chart-column"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M18 17V9" />
  <path d="M13 17V5" />
  <path d="M8 17v-3" />
</svg>
`,d6=`
<svg
  class="lucide lucide-chart-gantt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 6h8" />
  <path d="M12 16h6" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M8 11h7" />
</svg>
`,d7=`
<svg
  class="lucide lucide-chart-no-axes-column-decreasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 21V3" />
  <path d="M12 21V9" />
  <path d="M19 21v-6" />
</svg>
`,d8=`
<svg
  class="lucide lucide-chart-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="m19 9-5 5-4-4-3 3" />
</svg>
`,d9=`
<svg
  class="lucide lucide-chart-network"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13.11 7.664 1.78 2.672" />
  <path d="m14.162 12.788-3.324 1.424" />
  <path d="m20 4-6.06 1.515" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <circle cx="12" cy="6" r="2" />
  <circle cx="16" cy="12" r="2" />
  <circle cx="9" cy="15" r="2" />
</svg>
`,ea=`
<svg
  class="lucide lucide-chart-no-axes-column-increasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 21v-6" />
  <path d="M12 21V9" />
  <path d="M19 21V3" />
</svg>
`,eb=`
<svg
  class="lucide lucide-chart-no-axes-column"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 21v-6" />
  <path d="M12 21V3" />
  <path d="M19 21V9" />
</svg>
`,ec=`
<svg
  class="lucide lucide-chart-no-axes-combined"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 16v5" />
  <path d="M16 14v7" />
  <path d="M20 10v11" />
  <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" />
  <path d="M4 18v3" />
  <path d="M8 14v7" />
</svg>
`,ed=`
<svg
  class="lucide lucide-chart-no-axes-gantt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 5h12" />
  <path d="M4 12h10" />
  <path d="M12 19h8" />
</svg>
`,ee=`
<svg
  class="lucide lucide-chart-pie"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" />
  <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
</svg>
`,ef=`
<svg
  class="lucide lucide-chart-scatter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  <circle cx="18.5" cy="5.5" r=".5" fill="currentColor" />
  <circle cx="11.5" cy="11.5" r=".5" fill="currentColor" />
  <circle cx="7.5" cy="16.5" r=".5" fill="currentColor" />
  <circle cx="17.5" cy="14.5" r=".5" fill="currentColor" />
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
</svg>
`,eg=`
<svg
  class="lucide lucide-chart-spline"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7" />
</svg>
`,eh=`
<svg
  class="lucide lucide-check-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 6 7 17l-5-5" />
  <path d="m22 10-7.5 7.5L13 16" />
</svg>
`,ei=`
<svg
  class="lucide lucide-check-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 4L9 15" />
  <path d="M21 19L3 19" />
  <path d="M9 15L4 10" />
</svg>
`,ej=`
<svg
  class="lucide lucide-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 6 9 17l-5-5" />
</svg>
`,ek=`
<svg
  class="lucide lucide-chef-hat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
  <path d="M6 17h12" />
</svg>
`,el=`
<svg
  class="lucide lucide-cherry"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z" />
  <path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z" />
  <path d="M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12" />
  <path d="M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z" />
</svg>
`,em=`
<svg
  class="lucide lucide-chevron-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 9 6 6 6-6" />
</svg>
`,en=`
<svg
  class="lucide lucide-chevron-first"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 18-6-6 6-6" />
  <path d="M7 6v12" />
</svg>
`,eo=`
<svg
  class="lucide lucide-chevron-last"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 18 6-6-6-6" />
  <path d="M17 6v12" />
</svg>
`,ep=`
<svg
  class="lucide lucide-chevron-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 18-6-6 6-6" />
</svg>
`,eq=`
<svg
  class="lucide lucide-chevron-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 18 6-6-6-6" />
</svg>
`,er=`
<svg
  class="lucide lucide-chevron-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 15-6-6-6 6" />
</svg>
`,es=`
<svg
  class="lucide lucide-chevrons-down-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 20 5-5 5 5" />
  <path d="m7 4 5 5 5-5" />
</svg>
`,et=`
<svg
  class="lucide lucide-chevrons-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 6 5 5 5-5" />
  <path d="m7 13 5 5 5-5" />
</svg>
`,eu=`
<svg
  class="lucide lucide-chevrons-left-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 7-5 5 5 5" />
  <path d="m15 7 5 5-5 5" />
</svg>
`,ev=`
<svg
  class="lucide lucide-chevrons-left-right-ellipsis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12h.01" />
  <path d="M16 12h.01" />
  <path d="m17 7 5 5-5 5" />
  <path d="m7 7-5 5 5 5" />
  <path d="M8 12h.01" />
</svg>
`,ew=`
<svg
  class="lucide lucide-chevrons-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 17 5-5-5-5" />
  <path d="m13 17 5-5-5-5" />
</svg>
`,ex=`
<svg
  class="lucide lucide-chevrons-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 17-5-5 5-5" />
  <path d="m18 17-5-5 5-5" />
</svg>
`,ey=`
<svg
  class="lucide lucide-chevrons-right-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m20 17-5-5 5-5" />
  <path d="m4 17 5-5-5-5" />
</svg>
`,ez=`
<svg
  class="lucide lucide-chevrons-up-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 15 5 5 5-5" />
  <path d="m7 9 5-5 5 5" />
</svg>
`,eA=`
<svg
  class="lucide lucide-chromium"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.88 21.94 15.46 14" />
  <path d="M21.17 8H12" />
  <path d="M3.95 6.06 8.54 14" />
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="4" />
</svg>
`,eB=`
<svg
  class="lucide lucide-chevrons-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 11-5-5-5 5" />
  <path d="m17 18-5-5-5 5" />
</svg>
`,eC=`
<svg
  class="lucide lucide-church"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9h4" />
  <path d="M12 7v5" />
  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
  <path d="m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9" />
  <path d="M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14" />
</svg>
`,eD=`
<svg
  class="lucide lucide-cigarette-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h13" />
  <path d="M18 8c0-2.5-2-2.5-2-5" />
  <path d="m2 2 20 20" />
  <path d="M21 12a1 1 0 0 1 1 1v2a1 1 0 0 1-.5.866" />
  <path d="M22 8c0-2.5-2-2.5-2-5" />
  <path d="M7 12v4" />
</svg>
`,eE=`
<svg
  class="lucide lucide-cigarette"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14" />
  <path d="M18 8c0-2.5-2-2.5-2-5" />
  <path d="M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
  <path d="M22 8c0-2.5-2-2.5-2-5" />
  <path d="M7 12v4" />
</svg>
`,eF=`
<svg
  class="lucide lucide-circle-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="12" x2="12" y1="8" y2="12" />
  <line x1="12" x2="12.01" y1="16" y2="16" />
</svg>
`,eG=`
<svg
  class="lucide lucide-circle-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 8v8" />
  <path d="m8 12 4 4 4-4" />
</svg>
`,eH=`
<svg
  class="lucide lucide-circle-arrow-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m12 8-4 4 4 4" />
  <path d="M16 12H8" />
</svg>
`,eI=`
<svg
  class="lucide lucide-circle-arrow-out-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22a10 10 0 1 1 10-10" />
  <path d="M22 22 12 12" />
  <path d="M22 16v6h-6" />
</svg>
`,eJ=`
<svg
  class="lucide lucide-circle-arrow-out-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 12a10 10 0 1 1 10 10" />
  <path d="m2 22 10-10" />
  <path d="M8 22H2v-6" />
</svg>
`,eK=`
<svg
  class="lucide lucide-circle-arrow-out-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 8V2h6" />
  <path d="m2 2 10 10" />
  <path d="M12 2A10 10 0 1 1 2 12" />
</svg>
`,eL=`
<svg
  class="lucide lucide-circle-arrow-out-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 12A10 10 0 1 1 12 2" />
  <path d="M22 2 12 12" />
  <path d="M16 2h6v6" />
</svg>
`,eM=`
<svg
  class="lucide lucide-circle-arrow-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m12 16 4-4-4-4" />
  <path d="M8 12h8" />
</svg>
`,eN=`
<svg
  class="lucide lucide-circle-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m16 12-4-4-4 4" />
  <path d="M12 16V8" />
</svg>
`,eO=`
<svg
  class="lucide lucide-circle-check-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.801 10A10 10 0 1 1 17 3.335" />
  <path d="m9 11 3 3L22 4" />
</svg>
`,eP=`
<svg
  class="lucide lucide-circle-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m9 12 2 2 4-4" />
</svg>
`,eQ=`
<svg
  class="lucide lucide-circle-chevron-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m16 10-4 4-4-4" />
</svg>
`,eR=`
<svg
  class="lucide lucide-circle-chevron-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m14 16-4-4 4-4" />
</svg>
`,eS=`
<svg
  class="lucide lucide-circle-chevron-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m10 8 4 4-4 4" />
</svg>
`,eT=`
<svg
  class="lucide lucide-circle-chevron-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m8 14 4-4 4 4" />
</svg>
`,eU=`
<svg
  class="lucide lucide-circle-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
  <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
  <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
  <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
  <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
  <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
  <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
  <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
</svg>
`,eV=`
<svg
  class="lucide lucide-circle-divide"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="8" x2="16" y1="12" y2="12" />
  <line x1="12" x2="12" y1="16" y2="16" />
  <line x1="12" x2="12" y1="8" y2="8" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,eW=`
<svg
  class="lucide lucide-circle-dot-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0" />
  <path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7" />
  <path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8" />
  <path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69" />
  <path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0" />
  <path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7" />
  <path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8" />
  <path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69" />
  <circle cx="12" cy="12" r="1" />
</svg>
`,eX=`
<svg
  class="lucide lucide-circle-dollar-sign"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
  <path d="M12 18V6" />
</svg>
`,eY=`
<svg
  class="lucide lucide-circle-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="1" />
</svg>
`,eZ=`
<svg
  class="lucide lucide-circle-ellipsis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M17 12h.01" />
  <path d="M12 12h.01" />
  <path d="M7 12h.01" />
</svg>
`,e$=`
<svg
  class="lucide lucide-circle-equal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 10h10" />
  <path d="M7 14h10" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,e_=`
<svg
  class="lucide lucide-circle-fading-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2a10 10 0 0 1 7.38 16.75" />
  <path d="m16 12-4-4-4 4" />
  <path d="M12 16V8" />
  <path d="M2.5 8.875a10 10 0 0 0-.5 3" />
  <path d="M2.83 16a10 10 0 0 0 2.43 3.4" />
  <path d="M4.636 5.235a10 10 0 0 1 .891-.857" />
  <path d="M8.644 21.42a10 10 0 0 0 7.631-.38" />
</svg>
`,e0=`
<svg
  class="lucide lucide-circle-fading-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2a10 10 0 0 1 7.38 16.75" />
  <path d="M12 8v8" />
  <path d="M16 12H8" />
  <path d="M2.5 8.875a10 10 0 0 0-.5 3" />
  <path d="M2.83 16a10 10 0 0 0 2.43 3.4" />
  <path d="M4.636 5.235a10 10 0 0 1 .891-.857" />
  <path d="M8.644 21.42a10 10 0 0 0 7.631-.38" />
</svg>`,e1=`
<svg
  class="lucide lucide-circle-gauge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.6 2.7a10 10 0 1 0 5.7 5.7" />
  <circle cx="12" cy="12" r="2" />
  <path d="M13.4 10.6 19 5" />
</svg>
`,e2=`
<svg
  class="lucide lucide-circle-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M8 12h8" />
</svg>
`,e3=`
<svg
  class="lucide lucide-circle-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 20 20" />
  <path d="M8.35 2.69A10 10 0 0 1 21.3 15.65" />
  <path d="M19.08 19.08A10 10 0 1 1 4.92 4.92" />
</svg>
`,e4=`
<svg
  class="lucide lucide-circle-parking-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.656 7H13a3 3 0 0 1 2.984 3.307" />
  <path d="M13 13H9" />
  <path d="M19.071 19.071A1 1 0 0 1 4.93 4.93" />
  <path d="m2 2 20 20" />
  <path d="M8.357 2.687a10 10 0 0 1 12.956 12.956" />
  <path d="M9 17V9" />
</svg>
`,e5=`
<svg
  class="lucide lucide-circle-parking"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
</svg>
`,e6=`
<svg
  class="lucide lucide-circle-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m15 9-6 6" />
  <path d="M9 9h.01" />
  <path d="M15 15h.01" />
</svg>
`,e7=`
<svg
  class="lucide lucide-circle-pause"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="10" x2="10" y1="15" y2="9" />
  <line x1="14" x2="14" y1="15" y2="9" />
</svg>
`,e8=`
<svg
  class="lucide lucide-circle-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,e9=`
<svg
  class="lucide lucide-circle-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M8 12h8" />
  <path d="M12 8v8" />
</svg>
`,fa=`
<svg
  class="lucide lucide-circle-pound-sterling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 16V9.5a1 1 0 0 1 5 0" />
  <path d="M8 12h4" />
  <path d="M8 16h7" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fb=`
<svg
  class="lucide lucide-circle-power"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v4" />
  <path d="M7.998 9.003a5 5 0 1 0 8-.005" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fc=`
<svg
  class="lucide lucide-circle-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <path d="M12 17h.01" />
</svg>
`,fd=`
<svg
  class="lucide lucide-circle-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="9" x2="15" y1="15" y2="9" />
</svg>
`,fe=`
<svg
  class="lucide lucide-circle-slash-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 2 2 22" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,ff=`
<svg
  class="lucide lucide-circle-small"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="6" />
</svg>
`,fg=`
<svg
  class="lucide lucide-circle-stop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <rect x="9" y="9" width="6" height="6" rx="1" />
</svg>
`,fh=`
<svg
  class="lucide lucide-circle-star"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.051 7.616a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.867l-1.156-1.152a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fi=`
<svg
  class="lucide lucide-circle-user-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 20a6 6 0 0 0-12 0" />
  <circle cx="12" cy="10" r="4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fj=`
<svg
  class="lucide lucide-circle-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m15 9-6 6" />
  <path d="m9 9 6 6" />
</svg>
`,fk=`
<svg
  class="lucide lucide-circle-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="10" r="3" />
  <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
</svg>
`,fl=`
<svg
  class="lucide lucide-circle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
</svg>
`,fm=`
<svg
  class="lucide lucide-circuit-board"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M11 9h4a2 2 0 0 0 2-2V3" />
  <circle cx="9" cy="9" r="2" />
  <path d="M7 21v-4a2 2 0 0 1 2-2h4" />
  <circle cx="15" cy="15" r="2" />
</svg>
`,fn=`
<svg
  class="lucide lucide-citrus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.66 17.67a1.08 1.08 0 0 1-.04 1.6A12 12 0 0 1 4.73 2.38a1.1 1.1 0 0 1 1.61-.04z" />
  <path d="M19.65 15.66A8 8 0 0 1 8.35 4.34" />
  <path d="m14 10-5.5 5.5" />
  <path d="M14 17.85V10H6.15" />
</svg>
`,fo=`
<svg
  class="lucide lucide-clapperboard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
  <path d="m6.2 5.3 3.1 3.9" />
  <path d="m12.4 3.4 3.1 4" />
  <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
</svg>
`,fp=`
<svg
  class="lucide lucide-clipboard-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="m9 14 2 2 4-4" />
</svg>
`,fq=`
<svg
  class="lucide lucide-clipboard-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 14v2.2l1.6 1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v.832" />
  <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2" />
  <circle cx="16" cy="16" r="6" />
  <rect x="8" y="2" width="8" height="4" rx="1" />
</svg>
`,fr=`
<svg
  class="lucide lucide-clipboard-copy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  <path d="M16 4h2a2 2 0 0 1 2 2v4" />
  <path d="M21 14H11" />
  <path d="m15 10-4 4 4 4" />
</svg>
`,fs=`
<svg
  class="lucide lucide-clipboard-list"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="M12 11h4" />
  <path d="M12 16h4" />
  <path d="M8 11h.01" />
  <path d="M8 16h.01" />
</svg>
`,ft=`
<svg
  class="lucide lucide-clipboard-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="M9 14h6" />
</svg>
`,fu=`
<svg
  class="lucide lucide-clipboard-paste"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 14h10" />
  <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
  <path d="m17 18 4-4-4-4" />
  <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
  <rect x="8" y="2" width="8" height="4" rx="1" />
</svg>
`,fv=`
<svg
  class="lucide lucide-clipboard-pen-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" />
  <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5" />
  <path d="M16 4h2a2 2 0 0 1 1.73 1" />
  <path d="M8 18h1" />
  <path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
</svg>
`,fw=`
<svg
  class="lucide lucide-clipboard-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5.5" />
  <path d="M4 13.5V6a2 2 0 0 1 2-2h2" />
  <path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
</svg>
`,fx=`
<svg
  class="lucide lucide-clipboard-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="M9 14h6" />
  <path d="M12 17v-6" />
</svg>
`,fy=`
<svg
  class="lucide lucide-clipboard-type"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="M9 12v-1h6v1" />
  <path d="M11 17h2" />
  <path d="M12 11v6" />
</svg>
`,fz=`
<svg
  class="lucide lucide-clipboard-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="m15 11-6 6" />
  <path d="m9 11 6 6" />
</svg>
`,fA=`
<svg
  class="lucide lucide-clipboard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
</svg>
`,fB=`
<svg
  class="lucide lucide-clock-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l2-4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fC=`
<svg
  class="lucide lucide-clock-10"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l-4-2" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fD=`
<svg
  class="lucide lucide-clock-11"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l-2-4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fE=`
<svg
  class="lucide lucide-clock-12"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fF=`
<svg
  class="lucide lucide-clock-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l4-2" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fG=`
<svg
  class="lucide lucide-clock-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6h4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fH=`
<svg
  class="lucide lucide-clock-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l4 2" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fI=`
<svg
  class="lucide lucide-clock-5"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l2 4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fJ=`
<svg
  class="lucide lucide-clock-6"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v10" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fK=`
<svg
  class="lucide lucide-clock-7"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l-2 4" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fL=`
<svg
  class="lucide lucide-clock-8"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l-4 2" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fM=`
<svg
  class="lucide lucide-clock-9"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6H8" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fN=`
<svg
  class="lucide lucide-clock-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l4 2" />
  <path d="M20 12v5" />
  <path d="M20 21h.01" />
  <path d="M21.25 8.2A10 10 0 1 0 16 21.16" />
</svg>
`,fO=`
<svg
  class="lucide lucide-clock-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l2 1" />
  <path d="M12.337 21.994a10 10 0 1 1 9.588-8.767" />
  <path d="m14 18 4 4 4-4" />
  <path d="M18 14v8" />
</svg>
`,fP=`
<svg
  class="lucide lucide-clock-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l1.56.78" />
  <path d="M13.227 21.925a10 10 0 1 1 8.767-9.588" />
  <path d="m14 18 4-4 4 4" />
  <path d="M18 22v-8" />
</svg>
`,fQ=`
<svg
  class="lucide lucide-clock-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l4 2" />
  <path d="M22 12a10 10 0 1 0-11 9.95" />
  <path d="m22 16-5.5 5.5L14 19" />
</svg>
`,fR=`
<svg
  class="lucide lucide-clock-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l3.644 1.822" />
  <path d="M16 19h6" />
  <path d="M19 16v6" />
  <path d="M21.92 13.267a10 10 0 1 0-8.653 8.653" />
</svg>
`,fS=`
<svg
  class="lucide lucide-clock-fading"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2a10 10 0 0 1 7.38 16.75" />
  <path d="M12 6v6l4 2" />
  <path d="M2.5 8.875a10 10 0 0 0-.5 3" />
  <path d="M2.83 16a10 10 0 0 0 2.43 3.4" />
  <path d="M4.636 5.235a10 10 0 0 1 .891-.857" />
  <path d="M8.644 21.42a10 10 0 0 0 7.631-.38" />
</svg>
`,fT=`
<svg
  class="lucide lucide-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v6l4 2" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,fU=`
<svg
  class="lucide lucide-closed-caption"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9.17a3 3 0 1 0 0 5.66" />
  <path d="M17 9.17a3 3 0 1 0 0 5.66" />
  <rect x="2" y="5" width="20" height="14" rx="2" />
</svg>
`,fV=`
<svg
  class="lucide lucide-cloud-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12v4" />
  <path d="M12 20h.01" />
  <path d="M17 18h.5a1 1 0 0 0 0-9h-1.79A7 7 0 1 0 7 17.708" />
</svg>
`,fW=`
<svg
  class="lucide lucide-cloud-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 15-5.5 5.5L9 18" />
  <path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742" />
</svg>
`,fX=`
<svg
  class="lucide lucide-cloud-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10.852 19.772-.383.924" />
  <path d="m13.148 14.228.383-.923" />
  <path d="M13.148 19.772a3 3 0 1 0-2.296-5.544l-.383-.923" />
  <path d="m13.53 20.696-.382-.924a3 3 0 1 1-2.296-5.544" />
  <path d="m14.772 15.852.923-.383" />
  <path d="m14.772 18.148.923.383" />
  <path d="M4.2 15.1a7 7 0 1 1 9.93-9.858A7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.2" />
  <path d="m9.228 15.852-.923-.383" />
  <path d="m9.228 18.148-.923.383" />
</svg>
`,fY=`
<svg
  class="lucide lucide-cloud-download"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v8l-4-4" />
  <path d="m12 21 4-4" />
  <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />
</svg>
`,fZ=`
<svg
  class="lucide lucide-cloud-drizzle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="M8 19v1" />
  <path d="M8 14v1" />
  <path d="M16 19v1" />
  <path d="M16 14v1" />
  <path d="M12 21v1" />
  <path d="M12 16v1" />
</svg>
`,f$=`
<svg
  class="lucide lucide-cloud-fog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="M16 17H7" />
  <path d="M17 21H9" />
</svg>
`,f_=`
<svg
  class="lucide lucide-cloud-hail"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="M16 14v2" />
  <path d="M8 14v2" />
  <path d="M16 20h.01" />
  <path d="M8 20h.01" />
  <path d="M12 16v2" />
  <path d="M12 22h.01" />
</svg>
`,f0=`
<svg
  class="lucide lucide-cloud-lightning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
  <path d="m13 12-3 5h4l-3 5" />
</svg>
`,f1=`
<svg
  class="lucide lucide-cloud-moon-rain"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 20v2" />
  <path d="M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36" />
  <path d="M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24" />
  <path d="M7 19v2" />
</svg>
`,f2=`
<svg
  class="lucide lucide-cloud-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 20 20" />
  <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
  <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" />
</svg>
`,f3=`
<svg
  class="lucide lucide-cloud-moon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z" />
  <path d="M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36" />
</svg>
`,f4=`
<svg
  class="lucide lucide-cloud-rain-wind"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="m9.2 22 3-7" />
  <path d="m9 13-3 7" />
  <path d="m17 13-3 7" />
</svg>
`,f5=`
<svg
  class="lucide lucide-cloud-rain"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="M16 14v6" />
  <path d="M8 14v6" />
  <path d="M12 16v6" />
</svg>
`,f6=`
<svg
  class="lucide lucide-cloud-snow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="M8 15h.01" />
  <path d="M8 19h.01" />
  <path d="M12 17h.01" />
  <path d="M12 21h.01" />
  <path d="M16 15h.01" />
  <path d="M16 19h.01" />
</svg>
`,f7=`
<svg
  class="lucide lucide-cloud-sun-rain"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="M20 12h2" />
  <path d="m19.07 4.93-1.41 1.41" />
  <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
  <path d="M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24" />
  <path d="M11 20v2" />
  <path d="M7 19v2" />
</svg>
`,f8=`
<svg
  class="lucide lucide-cloud-sun"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="M20 12h2" />
  <path d="m19.07 4.93-1.41 1.41" />
  <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
  <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
</svg>
`,f9=`
<svg
  class="lucide lucide-cloud-upload"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v8" />
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
  <path d="m8 17 4-4 4 4" />
</svg>
`,ga=`
<svg
  class="lucide lucide-cloud"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
</svg>
`,gb=`
<svg
  class="lucide lucide-cloudy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.5 21H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  <path d="M22 10a3 3 0 0 0-3-3h-2.207a5.502 5.502 0 0 0-10.702.5" />
</svg>
`,gc=`
<svg
  class="lucide lucide-clover"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.17 7.83 2 22" />
  <path d="M4.02 12a2.827 2.827 0 1 1 3.81-4.17A2.827 2.827 0 1 1 12 4.02a2.827 2.827 0 1 1 4.17 3.81A2.827 2.827 0 1 1 19.98 12a2.827 2.827 0 1 1-3.81 4.17A2.827 2.827 0 1 1 12 19.98a2.827 2.827 0 1 1-4.17-3.81A1 1 0 1 1 4 12" />
  <path d="m7.83 7.83 8.34 8.34" />
</svg>
`,gd=`
<svg
  class="lucide lucide-club"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.28 9.05a5.5 5.5 0 1 0-10.56 0A5.5 5.5 0 1 0 12 17.66a5.5 5.5 0 1 0 5.28-8.6Z" />
  <path d="M12 17.66L12 22" />
</svg>
`,ge=`
<svg
  class="lucide lucide-code-xml"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 16 4-4-4-4" />
  <path d="m6 8-4 4 4 4" />
  <path d="m14.5 4-5 16" />
</svg>
`,gf=`
<svg
  class="lucide lucide-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 18 6-6-6-6" />
  <path d="m8 6-6 6 6 6" />
</svg>
`,gg=`
<svg
  class="lucide lucide-codepen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
  <line x1="12" x2="12" y1="22" y2="15.5" />
  <polyline points="22 8.5 12 15.5 2 8.5" />
  <polyline points="2 15.5 12 8.5 22 15.5" />
  <line x1="12" x2="12" y1="2" y2="8.5" />
</svg>
`,gh=`
<svg
  class="lucide lucide-codesandbox"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
  <polyline points="7.5 19.79 7.5 14.6 3 12" />
  <polyline points="21 12 16.5 14.6 16.5 19.79" />
  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
  <line x1="12" x2="12" y1="22.08" y2="12" />
</svg>
`,gi=`
<svg
  class="lucide lucide-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 10.27 7 3.34" />
  <path d="m11 13.73-4 6.93" />
  <path d="M12 22v-2" />
  <path d="M12 2v2" />
  <path d="M14 12h8" />
  <path d="m17 20.66-1-1.73" />
  <path d="m17 3.34-1 1.73" />
  <path d="M2 12h2" />
  <path d="m20.66 17-1.73-1" />
  <path d="m20.66 7-1.73 1" />
  <path d="m3.34 17 1.73-1" />
  <path d="m3.34 7 1.73 1" />
  <circle cx="12" cy="12" r="2" />
  <circle cx="12" cy="12" r="8" />
</svg>
`,gj=`
<svg
  class="lucide lucide-coffee"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v2" />
  <path d="M14 2v2" />
  <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
  <path d="M6 2v2" />
</svg>
`,gk=`
<svg
  class="lucide lucide-coins"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="8" cy="8" r="6" />
  <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
  <path d="M7 6h1v4" />
  <path d="m16.71 13.88.7.71-2.82 2.82" />
</svg>
`,gl=`
<svg
  class="lucide lucide-columns-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M12 3v18" />
</svg>
`,gm=`
<svg
  class="lucide lucide-columns-3-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.5" />
  <path d="m14.3 19.6 1-.4" />
  <path d="M15 3v7.5" />
  <path d="m15.2 16.9-.9-.3" />
  <path d="m16.6 21.7.3-.9" />
  <path d="m16.8 15.3-.4-1" />
  <path d="m19.1 15.2.3-.9" />
  <path d="m19.6 21.7-.4-1" />
  <path d="m20.7 16.8 1-.4" />
  <path d="m21.7 19.4-.9-.3" />
  <path d="M9 3v18" />
  <circle cx="18" cy="18" r="3" />
</svg>`,gn=`
<svg
  class="lucide lucide-columns-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="M15 3v18" />
</svg>
`,go=`
<svg
  class="lucide lucide-columns-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7.5 3v18" />
  <path d="M12 3v18" />
  <path d="M16.5 3v18" />
</svg>
`,gp=`
<svg
  class="lucide lucide-combine"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
  <path d="M19 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
  <path d="m7 15 3 3" />
  <path d="m7 21 3-3H5a2 2 0 0 1-2-2v-2" />
  <rect x="14" y="14" width="7" height="7" rx="1" />
  <rect x="3" y="3" width="7" height="7" rx="1" />
</svg>
`,gq=`
<svg
  class="lucide lucide-command"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
</svg>
`,gr=`
<svg
  class="lucide lucide-compass"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,gs=`
<svg
  class="lucide lucide-computer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="8" x="5" y="2" rx="2" />
  <rect width="20" height="8" x="2" y="14" rx="2" />
  <path d="M6 18h2" />
  <path d="M12 18h6" />
</svg>
`,gt=`
<svg
  class="lucide lucide-component"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z" />
  <path d="M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z" />
  <path d="M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z" />
  <path d="M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z" />
</svg>
`,gu=`
<svg
  class="lucide lucide-concierge-bell"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z" />
  <path d="M20 16a8 8 0 1 0-16 0" />
  <path d="M12 4v4" />
  <path d="M10 4h4" />
</svg>
`,gv=`
<svg
  class="lucide lucide-cone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m20.9 18.55-8-15.98a1 1 0 0 0-1.8 0l-8 15.98" />
  <ellipse cx="12" cy="19" rx="9" ry="3" />
</svg>
`,gw=`
<svg
  class="lucide lucide-construction"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="2" y="6" width="20" height="8" rx="1" />
  <path d="M17 14v7" />
  <path d="M7 14v7" />
  <path d="M17 3v3" />
  <path d="M7 3v3" />
  <path d="M10 14 2.3 6.3" />
  <path d="m14 6 7.7 7.7" />
  <path d="m8 6 8 8" />
</svg>
`,gx=`
<svg
  class="lucide lucide-contact-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 2v2" />
  <path d="M17.915 22a6 6 0 0 0-12 0" />
  <path d="M8 2v2" />
  <circle cx="12" cy="12" r="4" />
  <rect x="3" y="4" width="18" height="18" rx="2" />
</svg>
`,gy=`
<svg
  class="lucide lucide-contact"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 2v2" />
  <path d="M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
  <path d="M8 2v2" />
  <circle cx="12" cy="11" r="3" />
  <rect x="3" y="4" width="18" height="18" rx="2" />
</svg>
`,gz=`
<svg
  class="lucide lucide-container"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z" />
  <path d="M10 21.9V14L2.1 9.1" />
  <path d="m10 14 11.9-6.9" />
  <path d="M14 19.8v-8.1" />
  <path d="M18 17.5V9.4" />
</svg>
`,gA=`
<svg
  class="lucide lucide-contrast"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 18a6 6 0 0 0 0-12v12z" />
</svg>
`,gB=`
<svg
  class="lucide lucide-cookie"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
  <path d="M8.5 8.5v.01" />
  <path d="M16 15.5v.01" />
  <path d="M12 12v.01" />
  <path d="M11 17v.01" />
  <path d="M7 14v.01" />
</svg>
`,gC=`
<svg
  class="lucide lucide-cooking-pot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 12h20" />
  <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
  <path d="m4 8 16-4" />
  <path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8" />
</svg>
`,gD=`
<svg
  class="lucide lucide-copy-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="12" x2="18" y1="15" y2="15" />
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gE=`
<svg
  class="lucide lucide-copy-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 15 2 2 4-4" />
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gF=`
<svg
  class="lucide lucide-copy-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="15" x2="15" y1="12" y2="18" />
  <line x1="12" x2="18" y1="15" y2="15" />
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gG=`
<svg
  class="lucide lucide-copy-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="12" x2="18" y1="18" y2="12" />
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gH=`
<svg
  class="lucide lucide-copy-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="12" x2="18" y1="12" y2="18" />
  <line x1="12" x2="18" y1="18" y2="12" />
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gI=`
<svg
  class="lucide lucide-copy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
`,gJ=`
<svg
  class="lucide lucide-copyleft"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M9.17 14.83a4 4 0 1 0 0-5.66" />
</svg>
`,gK=`
<svg
  class="lucide lucide-copyright"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M14.83 14.83a4 4 0 1 1 0-5.66" />
</svg>
`,gL=`
<svg
  class="lucide lucide-corner-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  <path d="m9 10-5 5 5 5" />
</svg>
`,gM=`
<svg
  class="lucide lucide-corner-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 10 5 5-5 5" />
  <path d="M4 4v7a4 4 0 0 0 4 4h12" />
</svg>
`,gN=`
<svg
  class="lucide lucide-corner-left-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 15-5 5-5-5" />
  <path d="M20 4h-7a4 4 0 0 0-4 4v12" />
</svg>
`,gO=`
<svg
  class="lucide lucide-corner-left-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 9 9 4 4 9" />
  <path d="M20 20h-7a4 4 0 0 1-4-4V4" />
</svg>
`,gP=`
<svg
  class="lucide lucide-corner-right-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 9 5-5 5 5" />
  <path d="M4 20h7a4 4 0 0 0 4-4V4" />
</svg>
`,gQ=`
<svg
  class="lucide lucide-corner-right-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 15 5 5 5-5" />
  <path d="M4 4h7a4 4 0 0 1 4 4v12" />
</svg>
`,gR=`
<svg
  class="lucide lucide-corner-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  <path d="M9 14 4 9l5-5" />
</svg>
`,gS=`
<svg
  class="lucide lucide-corner-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 14 5-5-5-5" />
  <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
</svg>
`,gT=`
<svg
  class="lucide lucide-cpu"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20v2" />
  <path d="M12 2v2" />
  <path d="M17 20v2" />
  <path d="M17 2v2" />
  <path d="M2 12h2" />
  <path d="M2 17h2" />
  <path d="M2 7h2" />
  <path d="M20 12h2" />
  <path d="M20 17h2" />
  <path d="M20 7h2" />
  <path d="M7 20v2" />
  <path d="M7 2v2" />
  <rect x="4" y="4" width="16" height="16" rx="2" />
  <rect x="8" y="8" width="8" height="8" rx="1" />
</svg>
`,gU=`
<svg
  class="lucide lucide-creative-commons"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M10 9.3a2.8 2.8 0 0 0-3.5 1 3.1 3.1 0 0 0 0 3.4 2.7 2.7 0 0 0 3.5 1" />
  <path d="M17 9.3a2.8 2.8 0 0 0-3.5 1 3.1 3.1 0 0 0 0 3.4 2.7 2.7 0 0 0 3.5 1" />
</svg>
`,gV=`
<svg
  class="lucide lucide-croissant"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.2 18H4.774a1.5 1.5 0 0 1-1.352-.97 11 11 0 0 1 .132-6.487" />
  <path d="M18 10.2V4.774a1.5 1.5 0 0 0-.97-1.352 11 11 0 0 0-6.486.132" />
  <path d="M18 5a4 3 0 0 1 4 3 2 2 0 0 1-2 2 10 10 0 0 0-5.139 1.42" />
  <path d="M5 18a3 4 0 0 0 3 4 2 2 0 0 0 2-2 10 10 0 0 1 1.42-5.14" />
  <path d="M8.709 2.554a10 10 0 0 0-6.155 6.155 1.5 1.5 0 0 0 .676 1.626l9.807 5.42a2 2 0 0 0 2.718-2.718l-5.42-9.807a1.5 1.5 0 0 0-1.626-.676" />
</svg>
`,gW=`
<svg
  class="lucide lucide-credit-card"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="14" x="2" y="5" rx="2" />
  <line x1="2" x2="22" y1="10" y2="10" />
</svg>
`,gX=`
<svg
  class="lucide lucide-crop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 2v14a2 2 0 0 0 2 2h14" />
  <path d="M18 22V8a2 2 0 0 0-2-2H2" />
</svg>
`,gY=`
<svg
  class="lucide lucide-cross"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z" />
</svg>
`,gZ=`
<svg
  class="lucide lucide-crosshair"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="22" x2="18" y1="12" y2="12" />
  <line x1="6" x2="2" y1="12" y2="12" />
  <line x1="12" x2="12" y1="6" y2="2" />
  <line x1="12" x2="12" y1="22" y2="18" />
</svg>
`,g$=`
<svg
  class="lucide lucide-crown"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
  <path d="M5 21h14" />
</svg>
`,g_=`
<svg
  class="lucide lucide-cuboid"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21.12 6.4-6.05-4.06a2 2 0 0 0-2.17-.05L2.95 8.41a2 2 0 0 0-.95 1.7v5.82a2 2 0 0 0 .88 1.66l6.05 4.07a2 2 0 0 0 2.17.05l9.95-6.12a2 2 0 0 0 .95-1.7V8.06a2 2 0 0 0-.88-1.66Z" />
  <path d="M10 22v-8L2.25 9.15" />
  <path d="m10 14 11.77-6.87" />
</svg>
`,g0=`
<svg
  class="lucide lucide-cup-soda"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8" />
  <path d="M5 8h14" />
  <path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0" />
  <path d="m12 8 1-6h2" />
</svg>
`,g1=`
<svg
  class="lucide lucide-currency"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="8" />
  <line x1="3" x2="6" y1="3" y2="6" />
  <line x1="21" x2="18" y1="3" y2="6" />
  <line x1="3" x2="6" y1="21" y2="18" />
  <line x1="21" x2="18" y1="21" y2="18" />
</svg>
`,g2=`
<svg
  class="lucide lucide-cylinder"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
</svg>
`,g3=`
<svg
  class="lucide lucide-dam"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 11.31c1.17.56 1.54 1.69 3.5 1.69 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  <path d="M11.75 18c.35.5 1.45 1 2.75 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <path d="M2 6h4" />
  <path d="M7 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1L10 4a1 1 0 0 0-1-1z" />
</svg>
`,g4=`
<svg
  class="lucide lucide-database-zap"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 5V19A9 3 0 0 0 15 21.84" />
  <path d="M21 5V8" />
  <path d="M21 12L18 17H22L19 22" />
  <path d="M3 12A9 3 0 0 0 14.59 14.87" />
</svg>
`,g5=`
<svg
  class="lucide lucide-database-backup"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 12a9 3 0 0 0 5 2.69" />
  <path d="M21 9.3V5" />
  <path d="M3 5v14a9 3 0 0 0 6.47 2.88" />
  <path d="M12 12v4h4" />
  <path d="M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16" />
</svg>
`,g6=`
<svg
  class="lucide lucide-database"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 5V19A9 3 0 0 0 21 19V5" />
  <path d="M3 12A9 3 0 0 0 21 12" />
</svg>
`,g7=`
<svg
  class="lucide lucide-decimals-arrow-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13 21-3-3 3-3" />
  <path d="M20 18H10" />
  <path d="M3 11h.01" />
  <rect x="6" y="3" width="5" height="8" rx="2.5" />
</svg>
`,g8=`
<svg
  class="lucide lucide-decimals-arrow-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 18h10" />
  <path d="m17 21 3-3-3-3" />
  <path d="M3 11h.01" />
  <rect x="15" y="3" width="5" height="8" rx="2.5" />
  <rect x="6" y="3" width="5" height="8" rx="2.5" />
</svg>
`,g9=`
<svg
  class="lucide lucide-dessert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.162 3.167A10 10 0 0 0 2 13a2 2 0 0 0 4 0v-1a2 2 0 0 1 4 0v4a2 2 0 0 0 4 0v-4a2 2 0 0 1 4 0v1a2 2 0 0 0 4-.006 10 10 0 0 0-8.161-9.826" />
  <path d="M20.804 14.869a9 9 0 0 1-17.608 0" />
  <circle cx="12" cy="4" r="2" />
</svg>
`,ha=`
<svg
  class="lucide lucide-delete"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
  <path d="m12 9 6 6" />
  <path d="m18 9-6 6" />
</svg>
`,hb=`
<svg
  class="lucide lucide-diameter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="19" cy="19" r="2" />
  <circle cx="5" cy="5" r="2" />
  <path d="M6.48 3.66a10 10 0 0 1 13.86 13.86" />
  <path d="m6.41 6.41 11.18 11.18" />
  <path d="M3.66 6.48a10 10 0 0 0 13.86 13.86" />
</svg>
`,hc=`
<svg
  class="lucide lucide-diamond-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z" />
  <path d="M8 12h8" />
</svg>`,hd=`
<svg
  class="lucide lucide-diamond-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0Z" />
  <path d="M9.2 9.2h.01" />
  <path d="m14.5 9.5-5 5" />
  <path d="M14.7 14.8h.01" />
</svg>
`,he=`
<svg
  class="lucide lucide-diamond-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 8v8" />
  <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z" />
  <path d="M8 12h8" />
</svg>`,hf=`
<svg
  class="lucide lucide-diamond"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
</svg>
`,hg=`
<svg
  class="lucide lucide-dice-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M15 9h.01" />
  <path d="M9 15h.01" />
</svg>
`,hh=`
<svg
  class="lucide lucide-dice-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M12 12h.01" />
</svg>
`,hi=`
<svg
  class="lucide lucide-dice-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M16 8h.01" />
  <path d="M12 12h.01" />
  <path d="M8 16h.01" />
</svg>
`,hj=`
<svg
  class="lucide lucide-dice-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M16 8h.01" />
  <path d="M8 8h.01" />
  <path d="M8 16h.01" />
  <path d="M16 16h.01" />
</svg>
`,hk=`
<svg
  class="lucide lucide-dice-5"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M16 8h.01" />
  <path d="M8 8h.01" />
  <path d="M8 16h.01" />
  <path d="M16 16h.01" />
  <path d="M12 12h.01" />
</svg>
`,hl=`
<svg
  class="lucide lucide-dice-6"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M16 8h.01" />
  <path d="M16 12h.01" />
  <path d="M16 16h.01" />
  <path d="M8 8h.01" />
  <path d="M8 12h.01" />
  <path d="M8 16h.01" />
</svg>
`,hm=`
<svg
  class="lucide lucide-diff"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v14" />
  <path d="M5 10h14" />
  <path d="M5 21h14" />
</svg>
`,hn=`
<svg
  class="lucide lucide-dices"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="12" height="12" x="2" y="10" rx="2" ry="2" />
  <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" />
  <path d="M6 18h.01" />
  <path d="M10 14h.01" />
  <path d="M15 6h.01" />
  <path d="M18 9h.01" />
</svg>
`,ho=`
<svg
  class="lucide lucide-disc-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="4" />
  <path d="M12 12h.01" />
</svg>
`,hp=`
<svg
  class="lucide lucide-disc-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M6 12c0-1.7.7-3.2 1.8-4.2" />
  <circle cx="12" cy="12" r="2" />
  <path d="M18 12c0 1.7-.7 3.2-1.8 4.2" />
</svg>
`,hq=`
<svg
  class="lucide lucide-disc-album"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <circle cx="12" cy="12" r="5" />
  <path d="M12 12h.01" />
</svg>
`,hr=`
<svg
  class="lucide lucide-disc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,hs=`
<svg
  class="lucide lucide-divide"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="6" r="1" />
  <line x1="5" x2="19" y1="12" y2="12" />
  <circle cx="12" cy="18" r="1" />
</svg>
`,ht=`
<svg
  class="lucide lucide-dna-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 2c-1.35 1.5-2.092 3-2.5 4.5L14 8" />
  <path d="m17 6-2.891-2.891" />
  <path d="M2 15c3.333-3 6.667-3 10-3" />
  <path d="m2 2 20 20" />
  <path d="m20 9 .891.891" />
  <path d="M22 9c-1.5 1.35-3 2.092-4.5 2.5l-1-1" />
  <path d="M3.109 14.109 4 15" />
  <path d="m6.5 12.5 1 1" />
  <path d="m7 18 2.891 2.891" />
  <path d="M9 22c1.35-1.5 2.092-3 2.5-4.5L10 16" />
</svg>
`,hu=`
<svg
  class="lucide lucide-dna"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 16 1.5 1.5" />
  <path d="m14 8-1.5-1.5" />
  <path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" />
  <path d="m16.5 10.5 1 1" />
  <path d="m17 6-2.891-2.891" />
  <path d="M2 15c6.667-6 13.333 0 20-6" />
  <path d="m20 9 .891.891" />
  <path d="M3.109 14.109 4 15" />
  <path d="m6.5 12.5 1 1" />
  <path d="m7 18 2.891 2.891" />
  <path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" />
</svg>
`,hv=`
<svg
  class="lucide lucide-dock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 8h20" />
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M6 16h12" />
</svg>
`,hw=`
<svg
  class="lucide lucide-dog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.25 16.25h1.5L12 17z" />
  <path d="M16 14v.5" />
  <path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309" />
  <path d="M8 14v.5" />
  <path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5" />
</svg>
`,hx=`
<svg
  class="lucide lucide-dollar-sign"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="12" x2="12" y1="2" y2="22" />
  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
</svg>
`,hy=`
<svg
  class="lucide lucide-donut"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.5 10a2.5 2.5 0 0 1-2.4-3H18a2.95 2.95 0 0 1-2.6-4.4 10 10 0 1 0 6.3 7.1c-.3.2-.8.3-1.2.3" />
  <circle cx="12" cy="12" r="3" />
</svg>
`,hz=`
<svg
  class="lucide lucide-door-closed-locked"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 12h.01" />
  <path d="M18 9V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
  <path d="M2 20h8" />
  <path d="M20 17v-2a2 2 0 1 0-4 0v2" />
  <rect x="14" y="17" width="8" height="5" rx="1" />
</svg>
`,hA=`
<svg
  class="lucide lucide-door-closed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 12h.01" />
  <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
  <path d="M2 20h20" />
</svg>
`,hB=`
<svg
  class="lucide lucide-door-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 20H2" />
  <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z" />
  <path d="M11 4H8a2 2 0 0 0-2 2v14" />
  <path d="M14 12h.01" />
  <path d="M22 20h-3" />
</svg>
`,hC=`
<svg
  class="lucide lucide-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12.1" cy="12.1" r="1" />
</svg>
`,hD=`
<svg
  class="lucide lucide-download"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 15V3" />
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  <path d="m7 10 5 5 5-5" />
</svg>
`,hE=`
<svg
  class="lucide lucide-drafting-compass"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12.99 6.74 1.93 3.44" />
  <path d="M19.136 12a10 10 0 0 1-14.271 0" />
  <path d="m21 21-2.16-3.84" />
  <path d="m3 21 8.02-14.26" />
  <circle cx="12" cy="5" r="2" />
</svg>
`,hF=`
<svg
  class="lucide lucide-drama"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 11h.01" />
  <path d="M14 6h.01" />
  <path d="M18 6h.01" />
  <path d="M6.5 13.1h.01" />
  <path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3" />
  <path d="M17.4 9.9c-.8.8-2 .8-2.8 0" />
  <path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7" />
  <path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4" />
</svg>
`,hG=`
<svg
  class="lucide lucide-drill"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a3 3 0 0 1-3-3 1 1 0 0 1 1-1z" />
  <path d="M13 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1l-.81 3.242a1 1 0 0 1-.97.758H8" />
  <path d="M14 4h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3" />
  <path d="M18 6h4" />
  <path d="m5 10-2 8" />
  <path d="m7 18 2-8" />
</svg>
`,hH=`
<svg
  class="lucide lucide-dribbble"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M19.13 5.09C15.22 9.14 10 10.44 2.25 10.94" />
  <path d="M21.75 12.84c-6.62-1.41-12.14 1-16.38 6.32" />
  <path d="M8.56 2.75c4.37 6 6 9.42 8 17.72" />
</svg>
`,hI=`
<svg
  class="lucide lucide-drone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10 7 7" />
  <path d="m10 14-3 3" />
  <path d="m14 10 3-3" />
  <path d="m14 14 3 3" />
  <path d="M14.205 4.139a4 4 0 1 1 5.439 5.863" />
  <path d="M19.637 14a4 4 0 1 1-5.432 5.868" />
  <path d="M4.367 10a4 4 0 1 1 5.438-5.862" />
  <path d="M9.795 19.862a4 4 0 1 1-5.429-5.873" />
  <rect x="10" y="8" width="4" height="8" rx="1" />
</svg>
`,hJ=`
<svg
  class="lucide lucide-droplet-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.715 13.186C18.29 11.858 17.384 10.607 16 9.5c-2-1.6-3.5-4-4-6.5a10.7 10.7 0 0 1-.884 2.586" />
  <path d="m2 2 20 20" />
  <path d="M8.795 8.797A11 11 0 0 1 8 9.5C6 11.1 5 13 5 15a7 7 0 0 0 13.222 3.208" />
</svg>
`,hK=`
<svg
  class="lucide lucide-droplet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
</svg>
`,hL=`
<svg
  class="lucide lucide-droplets"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
  <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
</svg>
`,hM=`
<svg
  class="lucide lucide-drum"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 8 8" />
  <path d="m22 2-8 8" />
  <ellipse cx="12" cy="9" rx="10" ry="5" />
  <path d="M7 13.4v7.9" />
  <path d="M12 14v8" />
  <path d="M17 13.4v7.9" />
  <path d="M2 9v8a10 5 0 0 0 20 0V9" />
</svg>
`,hN=`
<svg
  class="lucide lucide-drumstick"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" />
  <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />
</svg>
`,hO=`
<svg
  class="lucide lucide-dumbbell"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" />
  <path d="m2.5 21.5 1.4-1.4" />
  <path d="m20.1 3.9 1.4-1.4" />
  <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" />
  <path d="m9.6 14.4 4.8-4.8" />
</svg>
`,hP=`
<svg
  class="lucide lucide-ear-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 18.5a3.5 3.5 0 1 0 7 0c0-1.57.92-2.52 2.04-3.46" />
  <path d="M6 8.5c0-.75.13-1.47.36-2.14" />
  <path d="M8.8 3.15A6.5 6.5 0 0 1 19 8.5c0 1.63-.44 2.81-1.09 3.76" />
  <path d="M12.5 6A2.5 2.5 0 0 1 15 8.5M10 13a2 2 0 0 0 1.82-1.18" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,hQ=`
<svg
  class="lucide lucide-ear"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0" />
  <path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4" />
</svg>
`,hR=`
<svg
  class="lucide lucide-earth-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 3.34V5a3 3 0 0 0 3 3" />
  <path d="M11 21.95V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
  <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
  <path d="M12 2a10 10 0 1 0 9.54 13" />
  <path d="M20 6V4a2 2 0 1 0-4 0v2" />
  <rect width="8" height="5" x="14" y="6" rx="1" />
</svg>
`,hS=`
<svg
  class="lucide lucide-earth"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
  <path d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
  <path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,hT=`
<svg
  class="lucide lucide-eclipse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 2a7 7 0 1 0 10 10" />
</svg>
`,hU=`
<svg
  class="lucide lucide-egg-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 20 20" />
  <path d="M20 14.347V14c0-6-4-12-8-12-1.078 0-2.157.436-3.157 1.19" />
  <path d="M6.206 6.21C4.871 8.4 4 11.2 4 14a8 8 0 0 0 14.568 4.568" />
</svg>
`,hV=`
<svg
  class="lucide lucide-egg-fried"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11.5" cy="12.5" r="3.5" />
  <path d="M3 8c0-3.5 2.5-6 6.5-6 5 0 4.83 3 7.5 5s5 2 5 6c0 4.5-2.5 6.5-7 6.5-2.5 0-2.5 2.5-6 2.5s-7-2-7-5.5c0-3 1.5-3 1.5-5C3.5 10 3 9 3 8Z" />
</svg>
`,hW=`
<svg
  class="lucide lucide-egg"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12" />
</svg>
`,hX=`
<svg
  class="lucide lucide-ellipsis-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="1" />
  <circle cx="12" cy="5" r="1" />
  <circle cx="12" cy="19" r="1" />
</svg>
`,hY=`
<svg
  class="lucide lucide-ellipsis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="1" />
  <circle cx="19" cy="12" r="1" />
  <circle cx="5" cy="12" r="1" />
</svg>
`,hZ=`
<svg
  class="lucide lucide-equal-approximately"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 15a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0" />
  <path d="M5 9a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0" />
</svg>
`,h$=`
<svg
  class="lucide lucide-equal-not"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="5" x2="19" y1="9" y2="9" />
  <line x1="5" x2="19" y1="15" y2="15" />
  <line x1="19" x2="5" y1="5" y2="19" />
</svg>
`,h_=`
<svg
  class="lucide lucide-equal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="5" x2="19" y1="9" y2="9" />
  <line x1="5" x2="19" y1="15" y2="15" />
</svg>
`,h0=`
<svg
  class="lucide lucide-ethernet-port"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 20 3-3h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2l3 3z" />
  <path d="M6 8v1" />
  <path d="M10 8v1" />
  <path d="M14 8v1" />
  <path d="M18 8v1" />
</svg>
`,h1=`
<svg
  class="lucide lucide-eraser"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
  <path d="m5.082 11.09 8.828 8.828" />
</svg>
`,h2=`
<svg
  class="lucide lucide-euro"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 10h12" />
  <path d="M4 14h9" />
  <path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" />
</svg>
`,h3=`
<svg
  class="lucide lucide-expand"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 15 6 6" />
  <path d="m15 9 6-6" />
  <path d="M21 16v5h-5" />
  <path d="M21 8V3h-5" />
  <path d="M3 16v5h5" />
  <path d="m3 21 6-6" />
  <path d="M3 8V3h5" />
  <path d="M9 9 3 3" />
</svg>
`,h4=`
<svg
  class="lucide lucide-ev-charger"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5" />
  <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" />
  <path d="M2 21h13" />
  <path d="M3 7h11" />
  <path d="m9 11-2 3h3l-2 3" />
</svg>
`,h5=`
<svg
  class="lucide lucide-external-link"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 3h6v6" />
  <path d="M10 14 21 3" />
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
</svg>
`,h6=`
<svg
  class="lucide lucide-eye-closed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 18-.722-3.25" />
  <path d="M2 8a10.645 10.645 0 0 0 20 0" />
  <path d="m20 15-1.726-2.05" />
  <path d="m4 15 1.726-2.05" />
  <path d="m9 18 .722-3.25" />
</svg>
`,h7=`
<svg
  class="lucide lucide-eye-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
  <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
  <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
  <path d="m2 2 20 20" />
</svg>
`,h8=`
<svg
  class="lucide lucide-eye"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
  <circle cx="12" cy="12" r="3" />
</svg>
`,h9=`
<svg
  class="lucide lucide-facebook"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
</svg>
`,ia=`
<svg
  class="lucide lucide-factory"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 16h.01" />
  <path d="M16 16h.01" />
  <path d="M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
  <path d="M8 16h.01" />
</svg>
`,ib=`
<svg
  class="lucide lucide-fan"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z" />
  <path d="M12 12v.01" />
</svg>
`,ic=`
<svg
  class="lucide lucide-fast-forward"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 12 18z" />
  <path d="M2 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 2 18z" />
</svg>
`,id=`
<svg
  class="lucide lucide-feather"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
  <path d="M16 8 2 22" />
  <path d="M17.5 15H9" />
</svg>
`,ie=`
<svg
  class="lucide lucide-fence"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 3 2 5v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" />
  <path d="M6 8h4" />
  <path d="M6 18h4" />
  <path d="m12 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" />
  <path d="M14 8h4" />
  <path d="M14 18h4" />
  <path d="m20 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" />
</svg>
`,ig=`
<svg
  class="lucide lucide-ferris-wheel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="2" />
  <path d="M12 2v4" />
  <path d="m6.8 15-3.5 2" />
  <path d="m20.7 7-3.5 2" />
  <path d="M6.8 9 3.3 7" />
  <path d="m20.7 17-3.5-2" />
  <path d="m9 22 3-8 3 8" />
  <path d="M8 22h8" />
  <path d="M18 18.7a9 9 0 1 0-12 0" />
</svg>
`,ih=`
<svg
  class="lucide lucide-figma"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
  <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
  <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
  <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
  <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
</svg>
`,ii=`
<svg
  class="lucide lucide-file-archive"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 12v-1" />
  <path d="M8 18v-2" />
  <path d="M8 7V6" />
  <circle cx="8" cy="20" r="2" />
</svg>
`,ij=`
<svg
  class="lucide lucide-file-badge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88" />
  <circle cx="6" cy="14" r="3" />
</svg>
`,ik=`
<svg
  class="lucide lucide-file-axis-3d"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m8 18 4-4" />
  <path d="M8 10v8h8" />
</svg>
`,il=`
<svg
  class="lucide lucide-file-box"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.5 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.8" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M11.7 14.2 7 17l-4.7-2.8" />
  <path d="M3 13.1a2 2 0 0 0-.999 1.76v3.24a2 2 0 0 0 .969 1.78L6 21.7a2 2 0 0 0 2.03.01L11 19.9a2 2 0 0 0 1-1.76V14.9a2 2 0 0 0-.97-1.78L8 11.3a2 2 0 0 0-2.03-.01z" />
  <path d="M7 17v5" />
</svg>
`,im=`
<svg
  class="lucide lucide-file-braces-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 22h4a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M5 14a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1 1 1 0 0 1 1 1v2a1 1 0 0 0 1 1" />
  <path d="M9 22a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1" />
</svg>
`,io=`
<svg
  class="lucide lucide-file-braces"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
  <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
</svg>
`,ip=`
<svg
  class="lucide lucide-file-chart-column-increasing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 18v-2" />
  <path d="M12 18v-4" />
  <path d="M16 18v-6" />
</svg>
`,iq=`
<svg
  class="lucide lucide-file-chart-column"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 18v-1" />
  <path d="M12 18v-6" />
  <path d="M16 18v-3" />
</svg>
`,ir=`
<svg
  class="lucide lucide-file-chart-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m16 13-3.5 3.5-2-2L8 17" />
</svg>
`,is=`
<svg
  class="lucide lucide-file-chart-pie"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.941 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.704l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.512" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
  <path d="M9 16a1 1 0 0 1-1-1v-4c0-.552.45-1.008.995-.917a6 6 0 0 1 4.922 4.922c.091.544-.365.995-.917.995z" />
</svg>
`,it=`
<svg
  class="lucide lucide-file-check-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m14 20 2 2 4-4" />
</svg>
`,iu=`
<svg
  class="lucide lucide-file-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m9 15 2 2 4-4" />
</svg>
`,iv=`
<svg
  class="lucide lucide-file-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 22h2a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v2.85" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 14v2.2l1.6 1" />
  <circle cx="8" cy="16" r="6" />
</svg>
`,iw=`
<svg
  class="lucide lucide-file-code-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m5 16-3 3 3 3" />
  <path d="m9 22 3-3-3-3" />
</svg>
`,ix=`
<svg
  class="lucide lucide-file-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 12.5 8 15l2 2.5" />
  <path d="m14 12.5 2 2.5-2 2.5" />
</svg>
`,iy=`
<svg
  class="lucide lucide-file-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.85 22H18a2 2 0 0 0 2-2V8a2 2 0 0 0-.586-1.414l-4-4A2 2 0 0 0 14 2H6a2 2 0 0 0-2 2v6.6" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m3.305 19.53.923-.382" />
  <path d="m4.228 16.852-.924-.383" />
  <path d="m5.852 15.228-.383-.923" />
  <path d="m5.852 20.772-.383.924" />
  <path d="m8.148 15.228.383-.923" />
  <path d="m8.53 21.696-.382-.924" />
  <path d="m9.773 16.852.922-.383" />
  <path d="m9.773 19.148.922.383" />
  <circle cx="7" cy="18" r="3" />
</svg>
`,iz=`
<svg
  class="lucide lucide-file-diff"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M9 10h6" />
  <path d="M12 13V7" />
  <path d="M9 17h6" />
</svg>
`,iA=`
<svg
  class="lucide lucide-file-digit"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 16h2v6" />
  <path d="M10 22h4" />
  <rect x="2" y="16" width="4" height="6" rx="2" />
</svg>
`,iB=`
<svg
  class="lucide lucide-file-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M12 18v-6" />
  <path d="m9 15 3 3 3-3" />
</svg>
`,iC=`
<svg
  class="lucide lucide-file-headphone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0" />
</svg>
`,iD=`
<svg
  class="lucide lucide-file-exclamation-point"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</svg>
`,iE=`
<svg
  class="lucide lucide-file-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v7" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M3.62 18.8A2.25 2.25 0 1 1 7 15.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a1 1 0 0 1-1.507 0z" />
</svg>
`,iF=`
<svg
  class="lucide lucide-file-image"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <circle cx="10" cy="12" r="2" />
  <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />
</svg>
`,iG=`
<svg
  class="lucide lucide-file-input"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M2 15h10" />
  <path d="m9 18 3-3-3-3" />
</svg>
`,iH=`
<svg
  class="lucide lucide-file-key"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.1" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m10 15 1 1" />
  <path d="m11 14-4.586 4.586" />
  <circle cx="5" cy="20" r="2" />
</svg>
`,iI=`
<svg
  class="lucide lucide-file-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 9.8V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M9 17v-2a2 2 0 0 0-4 0v2" />
  <rect width="8" height="5" x="3" y="17" rx="1" />
</svg>
`,iJ=`
<svg
  class="lucide lucide-file-minus-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 14V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M14 18h6" />
</svg>
`,iK=`
<svg
  class="lucide lucide-file-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M9 15h6" />
</svg>
`,iL=`
<svg
  class="lucide lucide-file-music"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.35" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 20v-7l3 1.474" />
  <circle cx="6" cy="20" r="2" />
</svg>
`,iM=`
<svg
  class="lucide lucide-file-output"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m5 11-3 3" />
  <path d="m5 17-3-3h10" />
</svg>
`,iN=`
<svg
  class="lucide lucide-file-pen-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18.226 5.226-2.52-2.52A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.351" />
  <path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  <path d="M8 18h1" />
</svg>
`,iO=`
<svg
  class="lucide lucide-file-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z" />
</svg>
`,iP=`
<svg
  class="lucide lucide-file-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z" />
</svg>
`,iQ=`
<svg
  class="lucide lucide-file-plus-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M14 19h6" />
  <path d="M17 16v6" />
</svg>
`,iR=`
<svg
  class="lucide lucide-file-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M9 15h6" />
  <path d="M12 18v-6" />
</svg>
`,iS=`
<svg
  class="lucide lucide-file-scan"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10V8a2.4 2.4 0 0 0-.706-1.704l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4.35" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M16 14a2 2 0 0 0-2 2" />
  <path d="M16 22a2 2 0 0 1-2-2" />
  <path d="M20 14a2 2 0 0 1 2 2" />
  <path d="M20 22a2 2 0 0 0 2-2" />
</svg>
`,iT=`
<svg
  class="lucide lucide-file-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M12 17h.01" />
  <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
</svg>
`,iU=`
<svg
  class="lucide lucide-file-search-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m21 22-2.88-2.88" />
  <circle cx="16" cy="17" r="3" />
</svg>
`,iV=`
<svg
  class="lucide lucide-file-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <circle cx="11.5" cy="14.5" r="2.5" />
  <path d="M13.3 16.3 15 18" />
</svg>
`,iW=`
<svg
  class="lucide lucide-file-signal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 15h.01" />
  <path d="M11.5 13.5a2.5 2.5 0 0 1 0 3" />
  <path d="M15 12a5 5 0 0 1 0 6" />
</svg>
`,iX=`
<svg
  class="lucide lucide-file-spreadsheet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 13h2" />
  <path d="M14 13h2" />
  <path d="M8 17h2" />
  <path d="M14 17h2" />
</svg>
`,iY=`
<svg
  class="lucide lucide-file-sliders"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M8 12h8" />
  <path d="M10 11v2" />
  <path d="M8 17h8" />
  <path d="M14 16v2" />
</svg>
`,iZ=`
<svg
  class="lucide lucide-file-stack"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1" />
  <path d="M16 16a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1" />
  <path d="M21 6a2 2 0 0 0-.586-1.414l-2-2A2 2 0 0 0 17 2h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1z" />
</svg>
`,i$=`
<svg
  class="lucide lucide-file-symlink"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m10 18 3-3-3-3" />
</svg>
`,i_=`
<svg
  class="lucide lucide-file-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 9H8" />
  <path d="M16 13H8" />
  <path d="M16 17H8" />
</svg>
`,i0=`
<svg
  class="lucide lucide-file-terminal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m8 16 2-2-2-2" />
  <path d="M12 18h4" />
</svg>
`,i1=`
<svg
  class="lucide lucide-file-type-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16" />
  <path d="M6 22h2" />
  <path d="M7 14v8" />
</svg>
`,i2=`
<svg
  class="lucide lucide-file-type"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M11 18h2" />
  <path d="M12 12v6" />
  <path d="M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5" />
</svg>
`,i3=`
<svg
  class="lucide lucide-file-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M12 12v6" />
  <path d="m15 15-3-3-3 3" />
</svg>
`,i4=`
<svg
  class="lucide lucide-file-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M16 22a4 4 0 0 0-8 0" />
  <circle cx="12" cy="15" r="3" />
</svg>
`,i5=`
<svg
  class="lucide lucide-file-video-camera"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m10 17.843 3.033-1.755a.64.64 0 0 1 .967.56v4.704a.65.65 0 0 1-.967.56L10 20.157" />
  <rect width="7" height="6" x="3" y="16" rx="1" />
</svg>
`,i6=`
<svg
  class="lucide lucide-file-volume"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 11.55V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-1.95" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M12 15a5 5 0 0 1 0 6" />
  <path d="M8 14.502a.5.5 0 0 0-.826-.381l-1.893 1.631a1 1 0 0 1-.651.243H3.5a.5.5 0 0 0-.5.501v3.006a.5.5 0 0 0 .5.501h1.129a1 1 0 0 1 .652.243l1.893 1.633a.5.5 0 0 0 .826-.38z" />
</svg>
`,i7=`
<svg
  class="lucide lucide-file-x-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m15 17 5 5" />
  <path d="m20 17-5 5" />
</svg>
`,i8=`
<svg
  class="lucide lucide-file-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="m14.5 12.5-5 5" />
  <path d="m9.5 12.5 5 5" />
</svg>
`,i9=`
<svg
  class="lucide lucide-file"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
</svg>
`,ja=`
<svg
  class="lucide lucide-files"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
  <path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
  <path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
</svg>
`,jb=`
<svg
  class="lucide lucide-film"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 3v18" />
  <path d="M3 7.5h4" />
  <path d="M3 12h18" />
  <path d="M3 16.5h4" />
  <path d="M17 3v18" />
  <path d="M17 7.5h4" />
  <path d="M17 16.5h4" />
</svg>
`,jc=`
<svg
  class="lucide lucide-fingerprint"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
  <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
  <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
  <path d="M2 12a10 10 0 0 1 18-6" />
  <path d="M2 16h.01" />
  <path d="M21.8 16c.2-2 .131-5.354 0-6" />
  <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
  <path d="M8.65 22c.21-.66.45-1.32.57-2" />
  <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
</svg>
`,jd=`
<svg
  class="lucide lucide-fire-extinguisher"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 6.5V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3.5" />
  <path d="M9 18h8" />
  <path d="M18 3h-3" />
  <path d="M11 3a6 6 0 0 0-6 6v11" />
  <path d="M5 13h4" />
  <path d="M17 10a4 4 0 0 0-8 0v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2Z" />
</svg>
`,je=`
<svg
  class="lucide lucide-fish-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 12.47v.03m0-.5v.47m-.475 5.056A6.744 6.744 0 0 1 15 18c-3.56 0-7.56-2.53-8.5-6 .348-1.28 1.114-2.433 2.121-3.38m3.444-2.088A8.802 8.802 0 0 1 15 6c3.56 0 6.06 2.54 7 6-.309 1.14-.786 2.177-1.413 3.058" />
  <path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33m7.48-4.372A9.77 9.77 0 0 1 16 6.07m0 11.86a9.77 9.77 0 0 1-1.728-3.618" />
  <path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98M8.53 3h5.27a2 2 0 0 1 1.98 1.67l.23 1.4M2 2l20 20" />
</svg>
`,jf=`
<svg
  class="lucide lucide-fish-symbol"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 16s9-15 20-4C11 23 2 8 2 8" />
</svg>
`,jg=`
<svg
  class="lucide lucide-fish"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z" />
  <path d="M18 12v.5" />
  <path d="M16 17.93a9.77 9.77 0 0 1 0-11.86" />
  <path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" />
  <path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4" />
  <path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98" />
</svg>
`,jh=`
<svg
  class="lucide lucide-flag-triangle-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 22V2.8a.8.8 0 0 0-1.17-.71L5.45 7.78a.8.8 0 0 0 0 1.44L18 15.5" />
</svg>`,ji=`
<svg
  class="lucide lucide-flag-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
  <path d="m2 2 20 20" />
  <path d="M4 22V4" />
  <path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347" />
</svg>
`,jj=`
<svg
  class="lucide lucide-flag-triangle-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 22V2.8a.8.8 0 0 1 1.17-.71l11.38 5.69a.8.8 0 0 1 0 1.44L6 15.5" />
</svg>
`,jk=`
<svg
  class="lucide lucide-flag"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
</svg>
`,jl=`
<svg
  class="lucide lucide-flame-kindling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-.3 0-.6.1-.9a2 2 0 1 0 3.3-2C8 4.5 11 2 12 2Z" />
  <path d="m5 22 14-4" />
  <path d="m5 18 14 4" />
</svg>
`,jm=`
<svg
  class="lucide lucide-flame"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
</svg>
`,jn=`
<svg
  class="lucide lucide-flashlight-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 16v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4" />
  <path d="M7 2h11v4c0 2-2 2-2 4v1" />
  <line x1="11" x2="18" y1="6" y2="6" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,jo=`
<svg
  class="lucide lucide-flask-conical-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v2.343" />
  <path d="M14 2v6.343" />
  <path d="m2 2 20 20" />
  <path d="M20 20a2 2 0 0 1-2 2H6a2 2 0 0 1-1.755-2.96l5.227-9.563" />
  <path d="M6.453 15H15" />
  <path d="M8.5 2h7" />
</svg>
`,jp=`
<svg
  class="lucide lucide-flashlight"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z" />
  <line x1="6" x2="18" y1="6" y2="6" />
  <line x1="12" x2="12" y1="12" y2="12" />
</svg>
`,jq=`
<svg
  class="lucide lucide-flask-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v6.292a7 7 0 1 0 4 0V2" />
  <path d="M5 15h14" />
  <path d="M8.5 2h7" />
</svg>
`,jr=`
<svg
  class="lucide lucide-flask-conical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
  <path d="M6.453 15h11.094" />
  <path d="M8.5 2h7" />
</svg>
`,js=`
<svg
  class="lucide lucide-flip-horizontal-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m3 7 5 5-5 5V7" />
  <path d="m21 7-5 5 5 5V7" />
  <path d="M12 20v2" />
  <path d="M12 14v2" />
  <path d="M12 8v2" />
  <path d="M12 2v2" />
</svg>
`,jt=`
<svg
  class="lucide lucide-flip-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
  <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
  <path d="M12 20v2" />
  <path d="M12 14v2" />
  <path d="M12 8v2" />
  <path d="M12 2v2" />
</svg>
`,ju=`
<svg
  class="lucide lucide-flip-vertical-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 3-5 5-5-5h10" />
  <path d="m17 21-5-5-5 5h10" />
  <path d="M4 12H2" />
  <path d="M10 12H8" />
  <path d="M16 12h-2" />
  <path d="M22 12h-2" />
</svg>
`,jv=`
<svg
  class="lucide lucide-flip-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
  <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
  <path d="M4 12H2" />
  <path d="M10 12H8" />
  <path d="M16 12h-2" />
  <path d="M22 12h-2" />
</svg>
`,jw=`
<svg
  class="lucide lucide-flower"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="3" />
  <path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5" />
  <path d="M12 7.5V9" />
  <path d="M7.5 12H9" />
  <path d="M16.5 12H15" />
  <path d="M12 16.5V15" />
  <path d="m8 8 1.88 1.88" />
  <path d="M14.12 9.88 16 8" />
  <path d="m8 16 1.88-1.88" />
  <path d="M14.12 14.12 16 16" />
</svg>
`,jx=`
<svg
  class="lucide lucide-flower-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1" />
  <circle cx="12" cy="8" r="2" />
  <path d="M12 10v12" />
  <path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z" />
  <path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z" />
</svg>
`,jy=`
<svg
  class="lucide lucide-focus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="3" />
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
</svg>
`,jz=`
<svg
  class="lucide lucide-fold-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-6" />
  <path d="M12 8V2" />
  <path d="M4 12H2" />
  <path d="M10 12H8" />
  <path d="M16 12h-2" />
  <path d="M22 12h-2" />
  <path d="m15 19-3-3-3 3" />
  <path d="m15 5-3 3-3-3" />
</svg>
`,jA=`
<svg
  class="lucide lucide-fold-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 12h6" />
  <path d="M22 12h-6" />
  <path d="M12 2v2" />
  <path d="M12 8v2" />
  <path d="M12 14v2" />
  <path d="M12 20v2" />
  <path d="m19 9-3 3 3 3" />
  <path d="m5 15 3-3-3-3" />
</svg>
`,jB=`
<svg
  class="lucide lucide-folder-archive"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="15" cy="19" r="2" />
  <path d="M20.9 19.8A2 2 0 0 0 22 18V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h5.1" />
  <path d="M15 11v-1" />
  <path d="M15 17v-2" />
</svg>
`,jC=`
<svg
  class="lucide lucide-folder-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="m9 13 2 2 4-4" />
</svg>
`,jD=`
<svg
  class="lucide lucide-folder-clock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 14v2.2l1.6 1" />
  <path d="M7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2" />
  <circle cx="16" cy="16" r="6" />
</svg>
`,jE=`
<svg
  class="lucide lucide-folder-closed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="M2 10h20" />
</svg>
`,jF=`
<svg
  class="lucide lucide-folder-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10.5 8 13l2 2.5" />
  <path d="m14 10.5 2 2.5-2 2.5" />
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
</svg>
`,jG=`
<svg
  class="lucide lucide-folder-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.3 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.98a2 2 0 0 1 1.69.9l.66 1.2A2 2 0 0 0 12 6h8a2 2 0 0 1 2 2v3.3" />
  <path d="m14.305 19.53.923-.382" />
  <path d="m15.228 16.852-.923-.383" />
  <path d="m16.852 15.228-.383-.923" />
  <path d="m16.852 20.772-.383.924" />
  <path d="m19.148 15.228.383-.923" />
  <path d="m19.53 21.696-.382-.924" />
  <path d="m20.772 16.852.924-.383" />
  <path d="m20.772 19.148.924.383" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,jH=`
<svg
  class="lucide lucide-folder-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  <circle cx="12" cy="13" r="1" />
</svg>
`,jI=`
<svg
  class="lucide lucide-folder-git-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
  <circle cx="13" cy="12" r="2" />
  <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
  <circle cx="20" cy="19" r="2" />
</svg>
`,jJ=`
<svg
  class="lucide lucide-folder-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="M12 10v6" />
  <path d="m15 13-3 3-3-3" />
</svg>
`,jK=`
<svg
  class="lucide lucide-folder-git"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="13" r="2" />
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="M14 13h3" />
  <path d="M7 13h3" />
</svg>
`,jL=`
<svg
  class="lucide lucide-folder-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.638 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v3.417" />
  <path d="M14.62 18.8A2.25 2.25 0 1 1 18 15.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0z" />
</svg>
`,jM=`
<svg
  class="lucide lucide-folder-input"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
  <path d="M2 13h10" />
  <path d="m9 16 3-3-3-3" />
</svg>
`,jN=`
<svg
  class="lucide lucide-folder-key"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="16" cy="20" r="2" />
  <path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2" />
  <path d="m22 14-4.5 4.5" />
  <path d="m21 15 1 1" />
</svg>
`,jO=`
<svg
  class="lucide lucide-folder-kanban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  <path d="M8 10v4" />
  <path d="M12 10v2" />
  <path d="M16 10v6" />
</svg>
`,jP=`
<svg
  class="lucide lucide-folder-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 13h6" />
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
</svg>
`,jQ=`
<svg
  class="lucide lucide-folder-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="5" x="14" y="17" rx="1" />
  <path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5" />
  <path d="M20 17v-2a2 2 0 1 0-4 0v2" />
</svg>
`,jR=`
<svg
  class="lucide lucide-folder-open-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  <circle cx="14" cy="15" r="1" />
</svg>
`,jS=`
<svg
  class="lucide lucide-folder-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
</svg>
`,jT=`
<svg
  class="lucide lucide-folder-output"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 7.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-1.5" />
  <path d="M2 13h10" />
  <path d="m5 10-3 3 3 3" />
</svg>
`,jU=`
<svg
  class="lucide lucide-folder-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 11.5V5a2 2 0 0 1 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.5" />
  <path d="M11.378 13.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
</svg>
`,jV=`
<svg
  class="lucide lucide-folder-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10v6" />
  <path d="M9 13h6" />
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
</svg>
`,jW=`
<svg
  class="lucide lucide-folder-root"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  <circle cx="12" cy="13" r="2" />
  <path d="M12 15v5" />
</svg>
`,jX=`
<svg
  class="lucide lucide-folder-search-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11.5" cy="12.5" r="2.5" />
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="M13.3 14.3 15 16" />
</svg>
`,jY=`
<svg
  class="lucide lucide-folder-symlink"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" />
  <path d="m8 16 3-3-3-3" />
</svg>
`,jZ=`
<svg
  class="lucide lucide-folder-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1" />
  <path d="m21 21-1.9-1.9" />
  <circle cx="17" cy="17" r="3" />
</svg>
`,j$=`
<svg
  class="lucide lucide-folder-sync"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5" />
  <path d="M12 10v4h4" />
  <path d="m12 14 1.535-1.605a5 5 0 0 1 8 1.5" />
  <path d="M22 22v-4h-4" />
  <path d="m22 18-1.535 1.605a5 5 0 0 1-8-1.5" />
</svg>
`,j_=`
<svg
  class="lucide lucide-folder-tree"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
  <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
  <path d="M3 5a2 2 0 0 0 2 2h3" />
  <path d="M3 3v13a2 2 0 0 0 2 2h3" />
</svg>
`,j0=`
<svg
  class="lucide lucide-folder-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="M12 10v6" />
  <path d="m9 13 3-3 3 3" />
</svg>
`,j1=`
<svg
  class="lucide lucide-folder-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  <path d="m9.5 10.5 5 5" />
  <path d="m14.5 10.5-5 5" />
</svg>
`,j2=`
<svg
  class="lucide lucide-folder"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
</svg>
`,j3=`
<svg
  class="lucide lucide-folders"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z" />
  <path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1" />
</svg>
`,j4=`
<svg
  class="lucide lucide-footprints"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
  <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
  <path d="M16 17h4" />
  <path d="M4 13h4" />
</svg>
`,j5=`
<svg
  class="lucide lucide-forklift"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12H5a2 2 0 0 0-2 2v5" />
  <circle cx="13" cy="19" r="2" />
  <circle cx="5" cy="19" r="2" />
  <path d="M8 19h3m5-17v17h6M6 12V7c0-1.1.9-2 2-2h3l5 5" />
</svg>
`,j6=`
<svg
  class="lucide lucide-frame"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="22" x2="2" y1="6" y2="6" />
  <line x1="22" x2="2" y1="18" y2="18" />
  <line x1="6" x2="6" y1="2" y2="22" />
  <line x1="18" x2="18" y1="2" y2="22" />
</svg>
`,j7=`
<svg
  class="lucide lucide-forward"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 17 5-5-5-5" />
  <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
</svg>
`,j8=`
<svg
  class="lucide lucide-framer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 16V9h14V2H5l14 14h-7m-7 0 7 7v-7m-7 0h7" />
</svg>
`,j9=`
<svg
  class="lucide lucide-fullscreen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <rect width="10" height="8" x="7" y="8" rx="1" />
</svg>
`,ka=`
<svg
  class="lucide lucide-frown"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
  <line x1="9" x2="9.01" y1="9" y2="9" />
  <line x1="15" x2="15.01" y1="9" y2="9" />
</svg>
`,kb=`
<svg
  class="lucide lucide-fuel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5" />
  <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" />
  <path d="M2 21h13" />
  <path d="M3 9h11" />
</svg>
`,kc=`
<svg
  class="lucide lucide-funnel-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.354 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l1.218-1.348" />
  <path d="M16 6h6" />
  <path d="M19 3v6" />
</svg>
`,kd=`
<svg
  class="lucide lucide-funnel-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.531 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l.427-.473" />
  <path d="m16.5 3.5 5 5" />
  <path d="m21.5 3.5-5 5" />
</svg>
`,ke=`
<svg
  class="lucide lucide-funnel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
</svg>
`,kf=`
<svg
  class="lucide lucide-gallery-horizontal-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 7v10" />
  <path d="M6 5v14" />
  <rect width="12" height="18" x="10" y="3" rx="2" />
</svg>
`,kg=`
<svg
  class="lucide lucide-gallery-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 3v18" />
  <rect width="12" height="18" x="6" y="3" rx="2" />
  <path d="M22 3v18" />
</svg>
`,kh=`
<svg
  class="lucide lucide-gallery-vertical-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 2h10" />
  <path d="M5 6h14" />
  <rect width="18" height="12" x="3" y="10" rx="2" />
</svg>
`,ki=`
<svg
  class="lucide lucide-gallery-thumbnails"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="14" x="3" y="3" rx="2" />
  <path d="M4 21h1" />
  <path d="M9 21h1" />
  <path d="M14 21h1" />
  <path d="M19 21h1" />
</svg>
`,kj=`
<svg
  class="lucide lucide-gallery-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 2h18" />
  <rect width="18" height="12" x="3" y="6" rx="2" />
  <path d="M3 22h18" />
</svg>
`,kk=`
<svg
  class="lucide lucide-gamepad-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="6" x2="10" y1="11" y2="11" />
  <line x1="8" x2="8" y1="9" y2="13" />
  <line x1="15" x2="15.01" y1="12" y2="12" />
  <line x1="18" x2="18.01" y1="10" y2="10" />
  <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
</svg>
`,kl=`
<svg
  class="lucide lucide-gamepad-directional" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path
    d="M11.146 15.854a1.207 1.207 0 0 1 1.708 0l1.56 1.56A2 2 0 0 1 15 18.828V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2.172a2 2 0 0 1 .586-1.414z" />
  <path
    d="M18.828 15a2 2 0 0 1-1.414-.586l-1.56-1.56a1.207 1.207 0 0 1 0-1.708l1.56-1.56A2 2 0 0 1 18.828 9H21a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1z" />
  <path
    d="M6.586 14.414A2 2 0 0 1 5.172 15H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.172a2 2 0 0 1 1.414.586l1.56 1.56a1.207 1.207 0 0 1 0 1.708z" />
  <path
    d="M9 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.172a2 2 0 0 1-.586 1.414l-1.56 1.56a1.207 1.207 0 0 1-1.708 0l-1.56-1.56A2 2 0 0 1 9 5.172z" />
</svg>`,km=`
<svg
  class="lucide lucide-gamepad"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="6" x2="10" y1="12" y2="12" />
  <line x1="8" x2="8" y1="10" y2="14" />
  <line x1="15" x2="15.01" y1="13" y2="13" />
  <line x1="18" x2="18.01" y1="11" y2="11" />
  <rect width="20" height="12" x="2" y="6" rx="2" />
</svg>
`,kn=`
<svg
  class="lucide lucide-gauge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 14 4-4" />
  <path d="M3.34 19a10 10 0 1 1 17.32 0" />
</svg>
`,ko=`
<svg
  class="lucide lucide-gavel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381" />
  <path d="m16 16 6-6" />
  <path d="m21.5 10.5-8-8" />
  <path d="m8 8 6-6" />
  <path d="m8.5 7.5 8 8" />
</svg>
`,kp=`
<svg
  class="lucide lucide-gem"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 3 8 9l4 13 4-13-2.5-6" />
  <path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z" />
  <path d="M2 9h20" />
</svg>
`,kq=`
<svg
  class="lucide lucide-georgian-lari"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.5 21a7.5 7.5 0 1 1 7.35-9" />
  <path d="M13 12V3" />
  <path d="M4 21h16" />
  <path d="M9 12V3" />
</svg>
`,kr=`
<svg
  class="lucide lucide-ghost"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 10h.01" />
  <path d="M15 10h.01" />
  <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
</svg>
`,ks=`
<svg
  class="lucide lucide-gift"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="8" width="18" height="4" rx="1" />
  <path d="M12 8v13" />
  <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
  <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
</svg>
`,kt=`
<svg
  class="lucide lucide-git-branch-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 6a9 9 0 0 0-9 9V3" />
  <path d="M21 18h-6" />
  <circle cx="18" cy="6" r="3" />
  <circle cx="6" cy="18" r="3" />
</svg>
`,ku=`
<svg
  class="lucide lucide-git-branch-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 3v12" />
  <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
  <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
  <path d="M15 6a9 9 0 0 0-9 9" />
  <path d="M18 15v6" />
  <path d="M21 18h-6" />
</svg>
`,kv=`
<svg
  class="lucide lucide-git-branch"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="6" x2="6" y1="3" y2="15" />
  <circle cx="18" cy="6" r="3" />
  <circle cx="6" cy="18" r="3" />
  <path d="M18 9a9 9 0 0 1-9 9" />
</svg>
`,kw=`
<svg
  class="lucide lucide-git-commit-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v6" />
  <circle cx="12" cy="12" r="3" />
  <path d="M12 15v6" />
</svg>
`,kx=`
<svg
  class="lucide lucide-git-compare-arrows"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="5" cy="6" r="3" />
  <path d="M12 6h5a2 2 0 0 1 2 2v7" />
  <path d="m15 9-3-3 3-3" />
  <circle cx="19" cy="18" r="3" />
  <path d="M12 18H7a2 2 0 0 1-2-2V9" />
  <path d="m9 15 3 3-3 3" />
</svg>
`,ky=`
<svg
  class="lucide lucide-git-compare"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <path d="M13 6h3a2 2 0 0 1 2 2v7" />
  <path d="M11 18H8a2 2 0 0 1-2-2V9" />
</svg>
`,kz=`
<svg
  class="lucide lucide-git-commit-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="3" />
  <line x1="3" x2="9" y1="12" y2="12" />
  <line x1="15" x2="21" y1="12" y2="12" />
</svg>
`,kA=`
<svg
  class="lucide lucide-git-graph"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="5" cy="6" r="3" />
  <path d="M5 9v6" />
  <circle cx="5" cy="18" r="3" />
  <path d="M12 3v18" />
  <circle cx="19" cy="6" r="3" />
  <path d="M16 15.7A9 9 0 0 0 19 9" />
</svg>
`,kB=`
<svg
  class="lucide lucide-git-merge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <path d="M6 21V9a9 9 0 0 0 9 9" />
</svg>
`,kC=`
<svg
  class="lucide lucide-git-fork"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <circle cx="18" cy="6" r="3" />
  <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
  <path d="M12 12v3" />
</svg>
`,kD=`
<svg
  class="lucide lucide-git-pull-request-arrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="5" cy="6" r="3" />
  <path d="M5 9v12" />
  <circle cx="19" cy="18" r="3" />
  <path d="m15 9-3-3 3-3" />
  <path d="M12 6h5a2 2 0 0 1 2 2v7" />
</svg>
`,kE=`
<svg
  class="lucide lucide-git-pull-request-closed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="6" r="3" />
  <path d="M6 9v12" />
  <path d="m21 3-6 6" />
  <path d="m21 9-6-6" />
  <path d="M18 11.5V15" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,kF=`
<svg
  class="lucide lucide-git-pull-request-create-arrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="5" cy="6" r="3" />
  <path d="M5 9v12" />
  <path d="m15 9-3-3 3-3" />
  <path d="M12 6h5a2 2 0 0 1 2 2v3" />
  <path d="M19 15v6" />
  <path d="M22 18h-6" />
</svg>
`,kG=`
<svg
  class="lucide lucide-git-pull-request-draft"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <path d="M18 6V5" />
  <path d="M18 11v-1" />
  <line x1="6" x2="6" y1="9" y2="21" />
</svg>
`,kH=`
<svg
  class="lucide lucide-git-pull-request"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <path d="M13 6h3a2 2 0 0 1 2 2v7" />
  <line x1="6" x2="6" y1="9" y2="21" />
</svg>
`,kI=`
<svg
  class="lucide lucide-git-pull-request-create"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="6" r="3" />
  <path d="M6 9v12" />
  <path d="M13 6h3a2 2 0 0 1 2 2v3" />
  <path d="M18 15v6" />
  <path d="M21 18h-6" />
</svg>
`,kJ=`
<svg
  class="lucide lucide-github"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
  <path d="M9 18c-4.51 2-5-2-7-2" />
</svg>
`,kK=`
<svg
  class="lucide lucide-gitlab"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m22 13.29-3.33-10a.42.42 0 0 0-.14-.18.38.38 0 0 0-.22-.11.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18l-2.26 6.67H8.32L6.1 3.26a.42.42 0 0 0-.1-.18.38.38 0 0 0-.26-.08.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18L2 13.29a.74.74 0 0 0 .27.83L12 21l9.69-6.88a.71.71 0 0 0 .31-.83Z" />
</svg>
`,kL=`
<svg
  class="lucide lucide-glass-water"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5.116 4.104A1 1 0 0 1 6.11 3h11.78a1 1 0 0 1 .994 1.105L17.19 20.21A2 2 0 0 1 15.2 22H8.8a2 2 0 0 1-2-1.79z" />
  <path d="M6 12a5 5 0 0 1 6 0 5 5 0 0 0 6 0" />
</svg>
`,kM=`
<svg
  class="lucide lucide-globe-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.686 15A14.5 14.5 0 0 1 12 22a14.5 14.5 0 0 1 0-20 10 10 0 1 0 9.542 13" />
  <path d="M2 12h8.5" />
  <path d="M20 6V4a2 2 0 1 0-4 0v2" />
  <rect width="8" height="5" x="14" y="6" rx="1" />
</svg>
`,kN=`
<svg
  class="lucide lucide-glasses"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="15" r="4" />
  <circle cx="18" cy="15" r="4" />
  <path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
  <path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2" />
  <path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2" />
</svg>
`,kO=`
<svg
  class="lucide lucide-globe"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
  <path d="M2 12h20" />
</svg>
`,kP=`
<svg
  class="lucide lucide-gpu"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21V3" />
  <path d="M2 5h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2.26" />
  <path d="M7 17v3a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-3" />
  <circle cx="16" cy="11" r="2" />
  <circle cx="8" cy="11" r="2" />
</svg>`,kQ=`
<svg
  class="lucide lucide-goal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13V2l8 4-8 4" />
  <path d="M20.561 10.222a9 9 0 1 1-12.55-5.29" />
  <path d="M8.002 9.997a5 5 0 1 0 8.9 2.02" />
</svg>
`,kR=`
<svg
  class="lucide lucide-graduation-cap"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
  <path d="M22 10v6" />
  <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
</svg>
`,kS=`
<svg
  class="lucide lucide-grape"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 5V2l-5.89 5.89" />
  <circle cx="16.6" cy="15.89" r="3" />
  <circle cx="8.11" cy="7.4" r="3" />
  <circle cx="12.35" cy="11.65" r="3" />
  <circle cx="13.91" cy="5.85" r="3" />
  <circle cx="18.15" cy="10.09" r="3" />
  <circle cx="6.56" cy="13.2" r="3" />
  <circle cx="10.8" cy="17.44" r="3" />
  <circle cx="5" cy="19" r="3" />
</svg>
`,kT=`
<svg
  class="lucide lucide-grid-2x2-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3" />
  <path d="m16 19 2 2 4-4" />
</svg>
`,kU=`
<svg
  class="lucide lucide-grid-2x2-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3" />
  <path d="M16 19h6" />
  <path d="M19 22v-6" />
</svg>
`,kV=`
<svg
  class="lucide lucide-grid-2x2-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3" />
  <path d="m16 16 5 5" />
  <path d="m16 21 5-5" />
</svg>
`,kW=`
<svg
  class="lucide lucide-grid-2x2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v18" />
  <path d="M3 12h18" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,kX=`
<svg
  class="lucide lucide-grid-3x2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 3v18" />
  <path d="M3 12h18" />
  <path d="M9 3v18" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,kY=`
<svg
  class="lucide lucide-grid-3x3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="M3 15h18" />
  <path d="M9 3v18" />
  <path d="M15 3v18" />
</svg>
`,kZ=`
<svg
  class="lucide lucide-grip-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="9" r="1" />
  <circle cx="19" cy="9" r="1" />
  <circle cx="5" cy="9" r="1" />
  <circle cx="12" cy="15" r="1" />
  <circle cx="19" cy="15" r="1" />
  <circle cx="5" cy="15" r="1" />
</svg>
`,k$=`
<svg
  class="lucide lucide-grip-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="9" cy="12" r="1" />
  <circle cx="9" cy="5" r="1" />
  <circle cx="9" cy="19" r="1" />
  <circle cx="15" cy="12" r="1" />
  <circle cx="15" cy="5" r="1" />
  <circle cx="15" cy="19" r="1" />
</svg>
`,k_=`
<svg
  class="lucide lucide-grip"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="5" r="1" />
  <circle cx="19" cy="5" r="1" />
  <circle cx="5" cy="5" r="1" />
  <circle cx="12" cy="12" r="1" />
  <circle cx="19" cy="12" r="1" />
  <circle cx="5" cy="12" r="1" />
  <circle cx="12" cy="19" r="1" />
  <circle cx="19" cy="19" r="1" />
  <circle cx="5" cy="19" r="1" />
</svg>
`,k0=`
<svg
  class="lucide lucide-group"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5c0-1.1.9-2 2-2h2" />
  <path d="M17 3h2c1.1 0 2 .9 2 2v2" />
  <path d="M21 17v2c0 1.1-.9 2-2 2h-2" />
  <path d="M7 21H5c-1.1 0-2-.9-2-2v-2" />
  <rect width="7" height="5" x="7" y="7" rx="1" />
  <rect width="7" height="5" x="10" y="12" rx="1" />
</svg>
`,k1=`
<svg
  class="lucide lucide-guitar"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11.9 12.1 4.514-4.514" />
  <path d="M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z" />
  <path d="m6 16 2 2" />
  <path d="M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z" />
</svg>
`,k2=`
<svg
  class="lucide lucide-ham"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.144 21.144A7.274 10.445 45 1 0 2.856 10.856" />
  <path d="M13.144 21.144A7.274 4.365 45 0 0 2.856 10.856a7.274 4.365 45 0 0 10.288 10.288" />
  <path d="M16.565 10.435 18.6 8.4a2.501 2.501 0 1 0 1.65-4.65 2.5 2.5 0 1 0-4.66 1.66l-2.024 2.025" />
  <path d="m8.5 16.5-1-1" />
</svg>
`,k3=`
<svg
  class="lucide lucide-hamburger"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 16H4a2 2 0 1 1 0-4h16a2 2 0 1 1 0 4h-4.25" />
  <path d="M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2" />
  <path d="M5 16a2 2 0 0 0-2 2 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 2 2 0 0 0-2-2q0 0 0 0" />
  <path d="m6.67 12 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2" />
</svg>
`,k4=`
<svg
  class="lucide lucide-hammer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" />
  <path d="m18 15 4-4" />
  <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
</svg>
`,k5=`
<svg
  class="lucide lucide-hand-coins"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
  <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
  <path d="m2 16 6 6" />
  <circle cx="16" cy="9" r="2.9" />
  <circle cx="6" cy="5" r="3" />
</svg>
`,k6=`
<svg
  class="lucide lucide-hand-fist"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.035 17.012a3 3 0 0 0-3-3l-.311-.002a.72.72 0 0 1-.505-1.229l1.195-1.195A2 2 0 0 1 10.828 11H12a2 2 0 0 0 0-4H9.243a3 3 0 0 0-2.122.879l-2.707 2.707A4.83 4.83 0 0 0 3 14a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8V7a2 2 0 1 0-4 0v2a2 2 0 1 0 4 0" />
  <path d="M13.888 9.662A2 2 0 0 0 17 8V5A2 2 0 1 0 13 5" />
  <path d="M9 5A2 2 0 1 0 5 5V10" />
  <path d="M9 7V4A2 2 0 1 1 13 4V7.268" />
</svg>
`,k7=`
<svg
  class="lucide lucide-hand-grab"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4" />
  <path d="M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
  <path d="M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5" />
  <path d="M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
  <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0" />
</svg>
`,k8=`
<svg
  class="lucide lucide-hand-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16" />
  <path d="m14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95" />
  <path d="m2 15 6 6" />
  <path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91" />
</svg>
`,k9=`
<svg
  class="lucide lucide-hand-helping"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 12h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 14" />
  <path d="m7 18 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
  <path d="m2 13 6 6" />
</svg>
`,la=`
<svg
  class="lucide lucide-hand-metal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 12.5V10a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4" />
  <path d="M14 11V9a2 2 0 1 0-4 0v2" />
  <path d="M10 10.5V5a2 2 0 1 0-4 0v9" />
  <path d="m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8V7a2 2 0 1 0-4 0v5" />
</svg>
`,lb=`
<svg
  class="lucide lucide-hand-platter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3V2" />
  <path d="m15.4 17.4 3.2-2.8a2 2 0 1 1 2.8 2.9l-3.6 3.3c-.7.8-1.7 1.2-2.8 1.2h-4c-1.1 0-2.1-.4-2.8-1.2l-1.302-1.464A1 1 0 0 0 6.151 19H5" />
  <path d="M2 14h12a2 2 0 0 1 0 4h-2" />
  <path d="M4 10h16" />
  <path d="M5 10a7 7 0 0 1 14 0" />
  <path d="M5 14v6a1 1 0 0 1-1 1H2" />
</svg>
`,lc=`
<svg
  class="lucide lucide-hand"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
  <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
  <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
</svg>
`,ld=`
<svg
  class="lucide lucide-handshake"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 17 2 2a1 1 0 1 0 3-3" />
  <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
  <path d="m21 3 1 11h-2" />
  <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
  <path d="M3 4h8" />
</svg>
`,le=`
<svg
  class="lucide lucide-handbag"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.048 18.566A2 2 0 0 0 4 21h16a2 2 0 0 0 1.952-2.434l-2-9A2 2 0 0 0 18 8H6a2 2 0 0 0-1.952 1.566z" />
  <path d="M8 11V6a4 4 0 0 1 8 0v5" />
</svg>
`,lf=`
<svg
  class="lucide lucide-hard-drive-download"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v8" />
  <path d="m16 6-4 4-4-4" />
  <rect width="20" height="8" x="2" y="14" rx="2" />
  <path d="M6 18h.01" />
  <path d="M10 18h.01" />
</svg>
`,lg=`
<svg
  class="lucide lucide-hard-drive-upload"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 6-4-4-4 4" />
  <path d="M12 2v8" />
  <rect width="20" height="8" x="2" y="14" rx="2" />
  <path d="M6 18h.01" />
  <path d="M10 18h.01" />
</svg>
`,lh=`
<svg
  class="lucide lucide-hard-drive"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="22" x2="2" y1="12" y2="12" />
  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  <line x1="6" x2="6.01" y1="16" y2="16" />
  <line x1="10" x2="10.01" y1="16" y2="16" />
</svg>
`,li=`
<svg
  class="lucide lucide-hard-hat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
  <path d="M14 6a6 6 0 0 1 6 6v3" />
  <path d="M4 15v-3a6 6 0 0 1 6-6" />
  <rect x="2" y="15" width="20" height="4" rx="1" />
</svg>
`,lj=`
<svg
  class="lucide lucide-hash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="4" x2="20" y1="9" y2="9" />
  <line x1="4" x2="20" y1="15" y2="15" />
  <line x1="10" x2="8" y1="3" y2="21" />
  <line x1="16" x2="14" y1="3" y2="21" />
</svg>
`,lk=`
<svg
  class="lucide lucide-hat-glasses"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 18a2 2 0 0 0-4 0" />
  <path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11" />
  <path d="M2 11h20" />
  <circle cx="17" cy="18" r="3" />
  <circle cx="7" cy="18" r="3" />
</svg>
`,ll=`
<svg
  class="lucide lucide-haze"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m5.2 6.2 1.4 1.4" />
  <path d="M2 13h2" />
  <path d="M20 13h2" />
  <path d="m17.4 7.6 1.4-1.4" />
  <path d="M22 17H2" />
  <path d="M22 21H2" />
  <path d="M16 13a4 4 0 0 0-8 0" />
  <path d="M12 5V2.5" />
</svg>
`,lm=`
<svg
  class="lucide lucide-heading-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12h8" />
  <path d="M4 18V6" />
  <path d="M12 18V6" />
  <path d="m17 12 3-2v8" />
</svg>
`,ln=`
<svg
  class="lucide lucide-hdmi-port"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 9a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1l2 2h12l2-2h1a1 1 0 0 0 1-1Z" />
  <path d="M7.5 12h9" />
</svg>
`,lo=`
<svg
  class="lucide lucide-heading-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12h8" />
  <path d="M4 18V6" />
  <path d="M12 18V6" />
  <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
</svg>
`,lp=`
<svg
  class="lucide lucide-heading-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12h8" />
  <path d="M4 18V6" />
  <path d="M12 18V6" />
  <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" />
  <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" />
</svg>
`,lq=`
<svg
  class="lucide lucide-heading-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18V6" />
  <path d="M17 10v3a1 1 0 0 0 1 1h3" />
  <path d="M21 10v8" />
  <path d="M4 12h8" />
  <path d="M4 18V6" />
</svg>
`,lr=`
<svg
  class="lucide lucide-heading-5"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12h8" />
  <path d="M4 18V6" />
  <path d="M12 18V6" />
  <path d="M17 13v-3h4" />
  <path d="M17 17.7c.4.2.8.3 1.3.3 1.5 0 2.7-1.1 2.7-2.5S19.8 13 18.3 13H17" />
</svg>
`,ls=`
<svg
  class="lucide lucide-heading-6"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 12h8" />
  <path d="M4 18V6" />
  <path d="M12 18V6" />
  <circle cx="19" cy="16" r="2" />
  <path d="M20 10c-2 2-3 3.5-3 6" />
</svg>
`,lt=`
<svg
  class="lucide lucide-heading"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 12h12" />
  <path d="M6 20V4" />
  <path d="M18 20V4" />
</svg>
`,lu=`
<svg
  class="lucide lucide-headphone-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 14h-1.343" />
  <path d="M9.128 3.47A9 9 0 0 1 21 12v3.343" />
  <path d="m2 2 20 20" />
  <path d="M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3" />
  <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364" />
</svg>
`,lv=`
<svg
  class="lucide lucide-headphones"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
</svg>
`,lw=`
<svg
  class="lucide lucide-headset"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
  <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
</svg>
`,lx=`
<svg
  class="lucide lucide-heart-crack"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.409 5.824c-.702.792-1.15 1.496-1.415 2.166l2.153 2.156a.5.5 0 0 1 0 .707l-2.293 2.293a.5.5 0 0 0 0 .707L12 15" />
  <path d="M13.508 20.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.677.6.6 0 0 0 .818.001A5.5 5.5 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5z" />
</svg>
`,ly=`
<svg
  class="lucide lucide-heart-handshake"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762" />
</svg>
`,lz=`
<svg
  class="lucide lucide-heart-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.876 18.99-1.368 1.323a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5a5.2 5.2 0 0 1-.244 1.572" />
  <path d="M15 15h6" />
</svg>
`,lA=`
<svg
  class="lucide lucide-heart-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 4.893a5.5 5.5 0 0 1 1.091.931.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 1.872-1.002 3.356-2.187 4.655" />
  <path d="m16.967 16.967-3.459 3.346a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 2.747-4.761" />
  <path d="m2 2 20 20" />
</svg>
`,lB=`
<svg
  class="lucide lucide-heart-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.479 19.374-.971.939a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5a5.2 5.2 0 0 1-.219 1.49" />
  <path d="M15 15h6" />
  <path d="M18 12v6" />
</svg>
`,lC=`
<svg
  class="lucide lucide-heart-pulse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
  <path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
</svg>
`,lD=`
<svg
  class="lucide lucide-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
</svg>
`,lE=`
<svg
  class="lucide lucide-heater"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 8c2-3-2-3 0-6" />
  <path d="M15.5 8c2-3-2-3 0-6" />
  <path d="M6 10h.01" />
  <path d="M6 14h.01" />
  <path d="M10 16v-4" />
  <path d="M14 16v-4" />
  <path d="M18 16v-4" />
  <path d="M20 6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3" />
  <path d="M5 20v2" />
  <path d="M19 20v2" />
</svg>
`,lF=`
<svg
  class="lucide lucide-helicopter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 17v4" />
  <path d="M14 3v8a2 2 0 0 0 2 2h5.865" />
  <path d="M17 17v4" />
  <path d="M18 17a4 4 0 0 0 4-4 8 6 0 0 0-8-6 6 5 0 0 0-6 5v3a2 2 0 0 0 2 2z" />
  <path d="M2 10v5" />
  <path d="M6 3h16" />
  <path d="M7 21h14" />
  <path d="M8 13H2" />
</svg>
`,lG=`
<svg
  class="lucide lucide-hexagon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
</svg>
`,lH=`
<svg
  class="lucide lucide-highlighter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 11-6 6v3h9l3-3" />
  <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
</svg>
`,lI=`
<svg
  class="lucide lucide-history"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
  <path d="M12 7v5l4 2" />
</svg>
`,lJ=`
<svg
  class="lucide lucide-hop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.82 16.12c1.69.6 3.91.79 5.18.85.55.03 1-.42.97-.97-.06-1.27-.26-3.5-.85-5.18" />
  <path d="M11.5 6.5c1.64 0 5-.38 6.71-1.07.52-.2.55-.82.12-1.17A10 10 0 0 0 4.26 18.33c.35.43.96.4 1.17-.12.69-1.71 1.07-5.07 1.07-6.71 1.34.45 3.1.9 4.88.62a.88.88 0 0 0 .73-.74c.3-2.14-.15-3.5-.61-4.88" />
  <path d="M15.62 16.95c.2.85.62 2.76.5 4.28a.77.77 0 0 1-.9.7 16.64 16.64 0 0 1-4.08-1.36" />
  <path d="M16.13 21.05c1.65.63 3.68.84 4.87.91a.9.9 0 0 0 .96-.96 17.68 17.68 0 0 0-.9-4.87" />
  <path d="M16.94 15.62c.86.2 2.77.62 4.29.5a.77.77 0 0 0 .7-.9 16.64 16.64 0 0 0-1.36-4.08" />
  <path d="M17.99 5.52a20.82 20.82 0 0 1 3.15 4.5.8.8 0 0 1-.68 1.13c-2.33.2-5.3-.32-8.27-1.57" />
  <path d="M4.93 4.93 3 3a.7.7 0 0 1 0-1" />
  <path d="M9.58 12.18c1.24 2.98 1.77 5.95 1.57 8.28a.8.8 0 0 1-1.13.68 20.82 20.82 0 0 1-4.5-3.15" />
</svg>
`,lK=`
<svg
  class="lucide lucide-hop-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.82 16.12c1.69.6 3.91.79 5.18.85.28.01.53-.09.7-.27" />
  <path d="M11.14 20.57c.52.24 2.44 1.12 4.08 1.37.46.06.86-.25.9-.71.12-1.52-.3-3.43-.5-4.28" />
  <path d="M16.13 21.05c1.65.63 3.68.84 4.87.91a.9.9 0 0 0 .7-.26" />
  <path d="M17.99 5.52a20.83 20.83 0 0 1 3.15 4.5.8.8 0 0 1-.68 1.13c-1.17.1-2.5.02-3.9-.25" />
  <path d="M20.57 11.14c.24.52 1.12 2.44 1.37 4.08.04.3-.08.59-.31.75" />
  <path d="M4.93 4.93a10 10 0 0 0-.67 13.4c.35.43.96.4 1.17-.12.69-1.71 1.07-5.07 1.07-6.71 1.34.45 3.1.9 4.88.62a.85.85 0 0 0 .48-.24" />
  <path d="M5.52 17.99c1.05.95 2.91 2.42 4.5 3.15a.8.8 0 0 0 1.13-.68c.2-2.34-.33-5.3-1.57-8.28" />
  <path d="M8.35 2.68a10 10 0 0 1 9.98 1.58c.43.35.4.96-.12 1.17-1.5.6-4.3.98-6.07 1.05" />
  <path d="m2 2 20 20" />
</svg>
`,lL=`
<svg
  class="lucide lucide-hospital"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v4" />
  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
  <path d="M14 9h-4" />
  <path d="M18 11h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2" />
  <path d="M18 21V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16" />
</svg>
`,lM=`
<svg
  class="lucide lucide-hotel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 22v-6.57" />
  <path d="M12 11h.01" />
  <path d="M12 7h.01" />
  <path d="M14 15.43V22" />
  <path d="M15 16a5 5 0 0 0-6 0" />
  <path d="M16 11h.01" />
  <path d="M16 7h.01" />
  <path d="M8 11h.01" />
  <path d="M8 7h.01" />
  <rect x="4" y="2" width="16" height="20" rx="2" />
</svg>
`,lN=`
<svg
  class="lucide lucide-house-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8.62 13.8A2.25 2.25 0 1 1 12 10.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0z" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
</svg>
`,lO=`
<svg
  class="lucide lucide-hourglass"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 22h14" />
  <path d="M5 2h14" />
  <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
  <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
</svg>
`,lP=`
<svg
  class="lucide lucide-house-plug"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 12V8.964" />
  <path d="M14 12V8.964" />
  <path d="M15 12a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1z" />
  <path d="M8.5 21H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-2" />
</svg>
`,lQ=`
<svg
  class="lucide lucide-house-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.35 21H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v2.35" />
  <path d="M14.8 12.4A1 1 0 0 0 14 12h-4a1 1 0 0 0-1 1v8" />
  <path d="M15 18h6" />
  <path d="M18 15v6" />
</svg>
`,lR=`
<svg
  class="lucide lucide-house-wifi"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9.5 13.866a4 4 0 0 1 5 .01" />
  <path d="M12 17h.01" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  <path d="M7 10.754a8 8 0 0 1 10 0" />
</svg>
`,lS=`
<svg
  class="lucide lucide-house"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
</svg>
`,lT=`
<svg
  class="lucide lucide-ice-cream-bowl"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17c5 0 8-2.69 8-6H4c0 3.31 3 6 8 6m-4 4h8m-4-3v3M5.14 11a3.5 3.5 0 1 1 6.71 0" />
  <path d="M12.14 11a3.5 3.5 0 1 1 6.71 0" />
  <path d="M15.5 6.5a3.5 3.5 0 1 0-7 0" />
</svg>
`,lU=`
<svg
  class="lucide lucide-ice-cream-cone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 11 4.08 10.35a1 1 0 0 0 1.84 0L17 11" />
  <path d="M17 7A5 5 0 0 0 7 7" />
  <path d="M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4" />
</svg>
`,lV=`
<svg
  class="lucide lucide-id-card"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 10h2" />
  <path d="M16 14h2" />
  <path d="M6.17 15a3 3 0 0 1 5.66 0" />
  <circle cx="9" cy="11" r="2" />
  <rect x="2" y="5" width="20" height="14" rx="2" />
</svg>
`,lW=`
<svg
  class="lucide lucide-image-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" />
  <path d="m14 19 3 3v-5.5" />
  <path d="m17 22 3-3" />
  <circle cx="9" cy="9" r="2" />
</svg>
`,lX=`
<svg
  class="lucide lucide-id-card-lanyard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.5 8h-3" />
  <path d="m15 2-1 2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" />
  <path d="M16.899 22A5 5 0 0 0 7.1 22" />
  <path d="m9 2 3 6" />
  <circle cx="12" cy="15" r="3" />
</svg>`,lY=`
<svg
  class="lucide lucide-image-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="2" x2="22" y1="2" y2="22" />
  <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
  <line x1="13.5" x2="6" y1="13.5" y2="21" />
  <line x1="18" x2="21" y1="12" y2="15" />
  <path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59" />
  <path d="M21 15V5a2 2 0 0 0-2-2H9" />
</svg>
`,lZ=`
<svg
  class="lucide lucide-image-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
  <line x1="16" x2="22" y1="5" y2="5" />
  <circle cx="9" cy="9" r="2" />
  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
</svg>
`,l$=`
<svg
  class="lucide lucide-image-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z" />
  <path d="M21 12.17V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  <path d="m6 21 5-5" />
  <circle cx="9" cy="9" r="2" />
</svg>
`,l_=`
<svg
  class="lucide lucide-image-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5h6" />
  <path d="M19 2v6" />
  <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  <circle cx="9" cy="9" r="2" />
</svg>
`,l0=`
<svg
  class="lucide lucide-image-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" />
  <path d="m14 19.5 3-3 3 3" />
  <path d="M17 22v-5.5" />
  <circle cx="9" cy="9" r="2" />
</svg>
`,l1=`
<svg
  class="lucide lucide-image-upscale"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3h5v5" />
  <path d="M17 21h2a2 2 0 0 0 2-2" />
  <path d="M21 12v3" />
  <path d="m21 3-5 5" />
  <path d="M3 7V5a2 2 0 0 1 2-2" />
  <path d="m5 21 4.144-4.144a1.21 1.21 0 0 1 1.712 0L13 19" />
  <path d="M9 3h3" />
  <rect x="3" y="11" width="10" height="10" rx="1" />
</svg>
`,l2=`
<svg
  class="lucide lucide-image"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <circle cx="9" cy="9" r="2" />
  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
</svg>
`,l3=`
<svg
  class="lucide lucide-images"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" />
  <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" />
  <circle cx="13" cy="7" r="1" fill="currentColor" />
  <rect x="8" y="2" width="14" height="14" rx="2" />
</svg>
`,l4=`
<svg
  class="lucide lucide-import"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v12" />
  <path d="m8 11 4 4 4-4" />
  <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
</svg>
`,l5=`
<svg
  class="lucide lucide-indian-rupee"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 3h12" />
  <path d="M6 8h12" />
  <path d="m6 13 8.5 8" />
  <path d="M6 13h3" />
  <path d="M9 13c6.667 0 6.667-10 0-10" />
</svg>
`,l6=`
<svg
  class="lucide lucide-inbox"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
</svg>
`,l7=`
<svg
  class="lucide lucide-infinity"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8" />
</svg>
`,l8=`
<svg
  class="lucide lucide-info"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 16v-4" />
  <path d="M12 8h.01" />
</svg>
`,l9=`
<svg
  class="lucide lucide-inspection-panel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 7h.01" />
  <path d="M17 7h.01" />
  <path d="M7 17h.01" />
  <path d="M17 17h.01" />
</svg>
`,ma=`
<svg
  class="lucide lucide-instagram"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
</svg>
`,mb=`
<svg
  class="lucide lucide-italic"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="19" x2="10" y1="4" y2="4" />
  <line x1="14" x2="5" y1="20" y2="20" />
  <line x1="15" x2="9" y1="4" y2="20" />
</svg>
`,mc=`
<svg
  class="lucide lucide-iteration-ccw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 14 4 4-4 4" />
  <path d="M20 10a8 8 0 1 0-8 8h8" />
</svg>
`,md=`
<svg
  class="lucide lucide-iteration-cw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 10a8 8 0 1 1 8 8H4" />
  <path d="m8 22-4-4 4-4" />
</svg>
`,me=`
<svg
  class="lucide lucide-japanese-yen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 9.5V21m0-11.5L6 3m6 6.5L18 3" />
  <path d="M6 15h12" />
  <path d="M6 11h12" />
</svg>
`,mf=`
<svg
  class="lucide lucide-joystick"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2Z" />
  <path d="M6 15v-2" />
  <path d="M12 15V9" />
  <circle cx="12" cy="6" r="3" />
</svg>
`,mg=`
<svg
  class="lucide lucide-kanban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 3v14" />
  <path d="M12 3v8" />
  <path d="M19 3v18" />
</svg>
`,mh=`
<svg
  class="lucide lucide-kayak"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 17a1 1 0 0 0-1 1v1a2 2 0 1 0 2-2z" />
  <path d="M20.97 3.61a.45.45 0 0 0-.58-.58C10.2 6.6 6.6 10.2 3.03 20.39a.45.45 0 0 0 .58.58C13.8 17.4 17.4 13.8 20.97 3.61" />
  <path d="m6.707 6.707 10.586 10.586" />
  <path d="M7 5a2 2 0 1 0-2 2h1a1 1 0 0 0 1-1z" />
</svg>
`,mi=`
<svg
  class="lucide lucide-key-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
  <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
</svg>
`,mj=`
<svg
  class="lucide lucide-key-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.4 2.7a2.5 2.5 0 0 1 3.4 0l5.5 5.5a2.5 2.5 0 0 1 0 3.4l-3.7 3.7a2.5 2.5 0 0 1-3.4 0L8.7 9.8a2.5 2.5 0 0 1 0-3.4z" />
  <path d="m14 7 3 3" />
  <path d="m9.4 10.6-6.814 6.814A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814" />
</svg>
`,mk=`
<svg
  class="lucide lucide-key"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
  <path d="m21 2-9.6 9.6" />
  <circle cx="7.5" cy="15.5" r="5.5" />
</svg>
`,ml=`
<svg
  class="lucide lucide-keyboard-music"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M6 8h4" />
  <path d="M14 8h.01" />
  <path d="M18 8h.01" />
  <path d="M2 12h20" />
  <path d="M6 12v4" />
  <path d="M10 12v4" />
  <path d="M14 12v4" />
  <path d="M18 12v4" />
</svg>
`,mm=`
<svg
  class="lucide lucide-keyboard-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M 20 4 A2 2 0 0 1 22 6" />
  <path d="M 22 6 L 22 16.41" />
  <path d="M 7 16 L 16 16" />
  <path d="M 9.69 4 L 20 4" />
  <path d="M14 8h.01" />
  <path d="M18 8h.01" />
  <path d="m2 2 20 20" />
  <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />
  <path d="M6 8h.01" />
  <path d="M8 12h.01" />
</svg>`,mn=`
<svg
  class="lucide lucide-lamp-ceiling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v5" />
  <path d="M14.829 15.998a3 3 0 1 1-5.658 0" />
  <path d="M20.92 14.606A1 1 0 0 1 20 16H4a1 1 0 0 1-.92-1.394l3-7A1 1 0 0 1 7 7h10a1 1 0 0 1 .92.606z" />
</svg>
`,mo=`
<svg
  class="lucide lucide-keyboard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 8h.01" />
  <path d="M12 12h.01" />
  <path d="M14 8h.01" />
  <path d="M16 12h.01" />
  <path d="M18 8h.01" />
  <path d="M6 8h.01" />
  <path d="M7 16h10" />
  <path d="M8 12h.01" />
  <rect width="20" height="16" x="2" y="4" rx="2" />
</svg>
`,mp=`
<svg
  class="lucide lucide-lamp-desk"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.293 2.293a1 1 0 0 1 1.414 0l2.5 2.5 5.994 1.227a1 1 0 0 1 .506 1.687l-7 7a1 1 0 0 1-1.687-.506l-1.227-5.994-2.5-2.5a1 1 0 0 1 0-1.414z" />
  <path d="m14.207 4.793-3.414 3.414" />
  <path d="M3 20a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  <path d="m9.086 6.5-4.793 4.793a1 1 0 0 0-.18 1.17L7 18" />
</svg>
`,mq=`
<svg
  class="lucide lucide-lamp-floor"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10v12" />
  <path d="M17.929 7.629A1 1 0 0 1 17 9H7a1 1 0 0 1-.928-1.371l2-5A1 1 0 0 1 9 2h6a1 1 0 0 1 .928.629z" />
  <path d="M9 22h6" />
</svg>
`,mr=`
<svg
  class="lucide lucide-lamp-wall-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.929 18.629A1 1 0 0 1 19 20H9a1 1 0 0 1-.928-1.371l2-5A1 1 0 0 1 11 13h6a1 1 0 0 1 .928.629z" />
  <path d="M6 3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  <path d="M8 6h4a2 2 0 0 1 2 2v5" />
</svg>
`,ms=`
<svg
  class="lucide lucide-lamp-wall-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.929 9.629A1 1 0 0 1 19 11H9a1 1 0 0 1-.928-1.371l2-5A1 1 0 0 1 11 4h6a1 1 0 0 1 .928.629z" />
  <path d="M6 15a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
  <path d="M8 18h4a2 2 0 0 0 2-2v-5" />
</svg>
`,mt=`
<svg
  class="lucide lucide-lamp"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12v6" />
  <path d="M4.077 10.615A1 1 0 0 0 5 12h14a1 1 0 0 0 .923-1.385l-3.077-7.384A2 2 0 0 0 15 2H9a2 2 0 0 0-1.846 1.23Z" />
  <path d="M8 20a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
</svg>
`,mu=`
<svg
  class="lucide lucide-land-plot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 8 6-3-6-3v10" />
  <path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12" />
  <path d="m6.49 12.85 11.02 6.3" />
  <path d="M17.51 12.85 6.5 19.15" />
</svg>
`,mv=`
<svg
  class="lucide lucide-landmark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 18v-7" />
  <path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z" />
  <path d="M14 18v-7" />
  <path d="M18 18v-7" />
  <path d="M3 22h18" />
  <path d="M6 18v-7" />
</svg>
`,mw=`
<svg
  class="lucide lucide-languages"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m5 8 6 6" />
  <path d="m4 14 6-6 2-3" />
  <path d="M2 5h12" />
  <path d="M7 2h1" />
  <path d="m22 22-5-10-5 10" />
  <path d="M14 18h6" />
</svg>
`,mx=`
<svg
  class="lucide lucide-laptop-minimal-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h20" />
  <path d="m9 10 2 2 4-4" />
  <rect x="3" y="4" width="18" height="12" rx="2" />
</svg>
`,my=`
<svg
  class="lucide lucide-laptop-minimal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="12" x="3" y="4" rx="2" ry="2" />
  <line x1="2" x2="22" y1="20" y2="20" />
</svg>
`,mz=`
<svg
  class="lucide lucide-laptop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" />
  <path d="M20.054 15.987H3.946" />
</svg>
`,mA=`
<svg
  class="lucide lucide-lasso-select"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 22a5 5 0 0 1-2-4" />
  <path d="M7 16.93c.96.43 1.96.74 2.99.91" />
  <path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8a7.19 7.19 0 0 1-.33 2" />
  <path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
  <path d="M14.33 22h-.09a.35.35 0 0 1-.24-.32v-10a.34.34 0 0 1 .33-.34c.08 0 .15.03.21.08l7.34 6a.33.33 0 0 1-.21.59h-4.49l-2.57 3.85a.35.35 0 0 1-.28.14z" />
</svg>
`,mB=`
<svg
  class="lucide lucide-lasso"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.704 14.467A10 8 0 0 1 2 10a10 8 0 0 1 20 0 10 8 0 0 1-10 8 10 8 0 0 1-5.181-1.158" />
  <path d="M7 22a5 5 0 0 1-2-3.994" />
  <circle cx="5" cy="16" r="2" />
</svg>
`,mC=`
<svg
  class="lucide lucide-laugh"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z" />
  <line x1="9" x2="9.01" y1="9" y2="9" />
  <line x1="15" x2="15.01" y1="9" y2="9" />
</svg>
`,mD=`
<svg
  class="lucide lucide-layers-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z" />
  <path d="m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845" />
</svg>
`,mE=`
<svg
  class="lucide lucide-layers"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
  <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
  <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
</svg>
`,mF=`
<svg
  class="lucide lucide-layout-dashboard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="9" x="3" y="3" rx="1" />
  <rect width="7" height="5" x="14" y="3" rx="1" />
  <rect width="7" height="9" x="14" y="12" rx="1" />
  <rect width="7" height="5" x="3" y="16" rx="1" />
</svg>
`,mG=`
<svg
  class="lucide lucide-layout-grid"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="7" x="3" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="14" rx="1" />
  <rect width="7" height="7" x="3" y="14" rx="1" />
</svg>
`,mH=`
<svg
  class="lucide lucide-layout-list"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="7" x="3" y="3" rx="1" />
  <rect width="7" height="7" x="3" y="14" rx="1" />
  <path d="M14 4h7" />
  <path d="M14 9h7" />
  <path d="M14 15h7" />
  <path d="M14 20h7" />
</svg>
`,mI=`
<svg
  class="lucide lucide-layout-panel-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="18" x="3" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="14" rx="1" />
</svg>
`,mJ=`
<svg
  class="lucide lucide-layout-panel-top"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="7" x="3" y="3" rx="1" />
  <rect width="7" height="7" x="3" y="14" rx="1" />
  <rect width="7" height="7" x="14" y="14" rx="1" />
</svg>
`,mK=`
<svg
  class="lucide lucide-leaf"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
  <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
</svg>
`,mL=`
<svg
  class="lucide lucide-layout-template"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="7" x="3" y="3" rx="1" />
  <rect width="9" height="7" x="3" y="14" rx="1" />
  <rect width="5" height="7" x="16" y="14" rx="1" />
</svg>
`,mM=`
<svg
  class="lucide lucide-leafy-green"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 22c1.25-.987 2.27-1.975 3.9-2.2a5.56 5.56 0 0 1 3.8 1.5 4 4 0 0 0 6.187-2.353 3.5 3.5 0 0 0 3.69-5.116A3.5 3.5 0 0 0 20.95 8 3.5 3.5 0 1 0 16 3.05a3.5 3.5 0 0 0-5.831 1.373 3.5 3.5 0 0 0-5.116 3.69 4 4 0 0 0-2.348 6.155C3.499 15.42 4.409 16.712 4.2 18.1 3.926 19.743 3.014 20.732 2 22" />
  <path d="M2 22 17 7" />
</svg>
`,mN=`
<svg
  class="lucide lucide-lectern"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 12h3a2 2 0 0 0 1.902-1.38l1.056-3.333A1 1 0 0 0 21 6H3a1 1 0 0 0-.958 1.287l1.056 3.334A2 2 0 0 0 5 12h3" />
  <path d="M18 6V3a1 1 0 0 0-1-1h-3" />
  <rect width="8" height="12" x="8" y="10" rx="1" />
</svg>
`,mO=`
<svg
  class="lucide lucide-library-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="18" x="3" y="3" rx="1" />
  <path d="M7 3v18" />
  <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z" />
</svg>
`,mP=`
<svg
  class="lucide lucide-library"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 6 4 14" />
  <path d="M12 6v14" />
  <path d="M8 8v12" />
  <path d="M4 4v16" />
</svg>
`,mQ=`
<svg
  class="lucide lucide-life-buoy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="m4.93 4.93 4.24 4.24" />
  <path d="m14.83 9.17 4.24-4.24" />
  <path d="m14.83 14.83 4.24 4.24" />
  <path d="m9.17 14.83-4.24 4.24" />
  <circle cx="12" cy="12" r="4" />
</svg>
`,mR=`
<svg
  class="lucide lucide-ligature"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 12h2v8" />
  <path d="M14 20h4" />
  <path d="M6 12h4" />
  <path d="M6 20h4" />
  <path d="M8 20V8a4 4 0 0 1 7.464-2" />
</svg>
`,mS=`
<svg
  class="lucide lucide-lightbulb-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.8 11.2c.8-.9 1.2-2 1.2-3.2a6 6 0 0 0-9.3-5" />
  <path d="m2 2 20 20" />
  <path d="M6.3 6.3a4.67 4.67 0 0 0 1.2 5.2c.7.7 1.3 1.5 1.5 2.5" />
  <path d="M9 18h6" />
  <path d="M10 22h4" />
</svg>
`,mT=`
<svg
  class="lucide lucide-lightbulb"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
  <path d="M9 18h6" />
  <path d="M10 22h4" />
</svg>
`,mU=`
<svg
  class="lucide lucide-line-squiggle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 3.5c5-2 7 2.5 3 4C1.5 10 2 15 5 16c5 2 9-10 14-7s.5 13.5-4 12c-5-2.5.5-11 6-2" />
</svg>`,mV=`
<svg
  class="lucide lucide-link-2-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 17H7A5 5 0 0 1 7 7" />
  <path d="M15 7h2a5 5 0 0 1 4 8" />
  <line x1="8" x2="12" y1="12" y2="12" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,mW=`
<svg
  class="lucide lucide-link-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 17H7A5 5 0 0 1 7 7h2" />
  <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
  <line x1="8" x2="16" y1="12" y2="12" />
</svg>
`,mX=`
<svg
  class="lucide lucide-linkedin"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
  <rect width="4" height="12" x="2" y="9" />
  <circle cx="4" cy="4" r="2" />
</svg>
`,mY=`
<svg
  class="lucide lucide-link"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
</svg>
`,mZ=`
<svg
  class="lucide lucide-list-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M16 12H3" />
  <path d="M11 19H3" />
  <path d="m15 18 2 2 4-4" />
</svg>
`,m$=`
<svg
  class="lucide lucide-list-checks"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 5h8" />
  <path d="M13 12h8" />
  <path d="M13 19h8" />
  <path d="m3 17 2 2 4-4" />
  <path d="m3 7 2 2 4-4" />
</svg>
`,m_=`
<svg
  class="lucide lucide-list-chevrons-down-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h8" />
  <path d="M3 12h8" />
  <path d="M3 19h8" />
  <path d="m15 5 3 3 3-3" />
  <path d="m15 19 3-3 3 3" />
</svg>
`,m0=`
<svg
  class="lucide lucide-list-chevrons-up-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h8" />
  <path d="M3 12h8" />
  <path d="M3 19h8" />
  <path d="m15 8 3-3 3 3" />
  <path d="m15 16 3 3 3-3" />
</svg>
`,m1=`
<svg
  class="lucide lucide-list-collapse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 5h11" />
  <path d="M10 12h11" />
  <path d="M10 19h11" />
  <path d="m3 10 3-3-3-3" />
  <path d="m3 20 3-3-3-3" />
</svg>
`,m2=`
<svg
  class="lucide lucide-list-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M16 12H3" />
  <path d="M9 19H3" />
  <path d="m16 16-3 3 3 3" />
  <path d="M21 5v12a2 2 0 0 1-2 2h-6" />
</svg>
`,m3=`
<svg
  class="lucide lucide-list-filter-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5H2" />
  <path d="M6 12h12" />
  <path d="M9 19h6" />
  <path d="M16 5h6" />
  <path d="M19 8V2" />
</svg>
`,m4=`
<svg
  class="lucide lucide-list-filter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 5h20" />
  <path d="M6 12h12" />
  <path d="M9 19h6" />
</svg>
`,m5=`
<svg
  class="lucide lucide-list-indent-decrease"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H11" />
  <path d="M21 12H11" />
  <path d="M21 19H11" />
  <path d="m7 8-4 4 4 4" />
</svg>
`,m6=`
<svg
  class="lucide lucide-list-indent-increase"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H11" />
  <path d="M21 12H11" />
  <path d="M21 19H11" />
  <path d="m3 8 4 4-4 4" />
</svg>
`,m7=`
<svg
  class="lucide lucide-list-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M11 12H3" />
  <path d="M16 19H3" />
  <path d="M21 12h-6" />
</svg>
`,m8=`
<svg
  class="lucide lucide-list-music"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M11 12H3" />
  <path d="M11 19H3" />
  <path d="M21 16V5" />
  <circle cx="18" cy="16" r="3" />
</svg>
`,m9=`
<svg
  class="lucide lucide-list-ordered"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 5h10" />
  <path d="M11 12h10" />
  <path d="M11 19h10" />
  <path d="M4 4h1v5" />
  <path d="M4 9h2" />
  <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />
</svg>
`,na=`
<svg
  class="lucide lucide-list-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M11 12H3" />
  <path d="M16 19H3" />
  <path d="M18 9v6" />
  <path d="M21 12h-6" />
</svg>
`,nb=`
<svg
  class="lucide lucide-list-restart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M7 12H3" />
  <path d="M7 19H3" />
  <path d="M12 18a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L11 14" />
  <path d="M11 10v4h4" />
</svg>
`,nc=`
<svg
  class="lucide lucide-list-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h6" />
  <path d="M3 12h13" />
  <path d="M3 19h13" />
  <path d="m16 8-3-3 3-3" />
  <path d="M21 19V7a2 2 0 0 0-2-2h-6" />
</svg>
`,nd=`
<svg
  class="lucide lucide-list-todo"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 5h8" />
  <path d="M13 12h8" />
  <path d="M13 19h8" />
  <path d="m3 17 2 2 4-4" />
  <rect x="3" y="4" width="6" height="6" rx="1" />
</svg>
`,ne=`
<svg
  class="lucide lucide-list-tree"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 5h13" />
  <path d="M13 12h8" />
  <path d="M13 19h8" />
  <path d="M3 10a2 2 0 0 0 2 2h3" />
  <path d="M3 5v12a2 2 0 0 0 2 2h3" />
</svg>
`,nf=`
<svg
  class="lucide lucide-list-video"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M10 12H3" />
  <path d="M10 19H3" />
  <path d="M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z" />
</svg>
`,ng=`
<svg
  class="lucide lucide-list-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M11 12H3" />
  <path d="M16 19H3" />
  <path d="m15.5 9.5 5 5" />
  <path d="m20.5 9.5-5 5" />
</svg>
`,nh=`
<svg
  class="lucide lucide-list"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h.01" />
  <path d="M3 12h.01" />
  <path d="M3 19h.01" />
  <path d="M8 5h13" />
  <path d="M8 12h13" />
  <path d="M8 19h13" />
</svg>
`,ni=`
<svg
  class="lucide lucide-loader-circle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
</svg>
`,nj=`
<svg
  class="lucide lucide-loader"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v4" />
  <path d="m16.2 7.8 2.9-2.9" />
  <path d="M18 12h4" />
  <path d="m16.2 16.2 2.9 2.9" />
  <path d="M12 18v4" />
  <path d="m4.9 19.1 2.9-2.9" />
  <path d="M2 12h4" />
  <path d="m4.9 4.9 2.9 2.9" />
</svg>
`,nk=`
<svg
  class="lucide lucide-loader-pinwheel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0" />
  <path d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6" />
  <path d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,nl=`
<svg
  class="lucide lucide-locate-fixed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="2" x2="5" y1="12" y2="12" />
  <line x1="19" x2="22" y1="12" y2="12" />
  <line x1="12" x2="12" y1="2" y2="5" />
  <line x1="12" x2="12" y1="19" y2="22" />
  <circle cx="12" cy="12" r="7" />
  <circle cx="12" cy="12" r="3" />
</svg>
`,nm=`
<svg
  class="lucide lucide-locate-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 19v3" />
  <path d="M12 2v3" />
  <path d="M18.89 13.24a7 7 0 0 0-8.13-8.13" />
  <path d="M19 12h3" />
  <path d="M2 12h3" />
  <path d="m2 2 20 20" />
  <path d="M7.05 7.05a7 7 0 0 0 9.9 9.9" />
</svg>
`,nn=`
<svg
  class="lucide lucide-locate"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="2" x2="5" y1="12" y2="12" />
  <line x1="19" x2="22" y1="12" y2="12" />
  <line x1="12" x2="12" y1="2" y2="5" />
  <line x1="12" x2="12" y1="19" y2="22" />
  <circle cx="12" cy="12" r="7" />
</svg>
`,no=`
<svg
  class="lucide lucide-lock-keyhole-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="16" r="1" />
  <rect width="18" height="12" x="3" y="10" rx="2" />
  <path d="M7 10V7a5 5 0 0 1 9.33-2.5" />
</svg>
`,np=`
<svg
  class="lucide lucide-lock-keyhole"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="16" r="1" />
  <rect x="3" y="10" width="18" height="12" rx="2" />
  <path d="M7 10V7a5 5 0 0 1 10 0v3" />
</svg>
`,nq=`
<svg
  class="lucide lucide-lock-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
</svg>
`,nr=`
<svg
  class="lucide lucide-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
</svg>
`,ns=`
<svg
  class="lucide lucide-log-in"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 17 5-5-5-5" />
  <path d="M15 12H3" />
  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
</svg>
`,nt=`
<svg
  class="lucide lucide-logs"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h1" />
  <path d="M3 12h1" />
  <path d="M3 19h1" />
  <path d="M8 5h1" />
  <path d="M8 12h1" />
  <path d="M8 19h1" />
  <path d="M13 5h8" />
  <path d="M13 12h8" />
  <path d="M13 19h8" />
</svg>
`,nu=`
<svg
  class="lucide lucide-log-out"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 17 5-5-5-5" />
  <path d="M21 12H9" />
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
</svg>
`,nv=`
<svg
  class="lucide lucide-lollipop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="11" r="8" />
  <path d="m21 21-4.3-4.3" />
  <path d="M11 11a2 2 0 0 0 4 0 4 4 0 0 0-8 0 6 6 0 0 0 12 0" />
</svg>
`,nw=`
<svg
  class="lucide lucide-luggage"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" />
  <path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" />
  <path d="M10 20h4" />
  <circle cx="16" cy="20" r="2" />
  <circle cx="8" cy="20" r="2" />
</svg>
`,nx=`
<svg
  class="lucide lucide-magnet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 15 4 4" />
  <path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z" />
  <path d="m5 8 4 4" />
</svg>
`,ny=`
<svg
  class="lucide lucide-mail-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="m16 19 2 2 4-4" />
</svg>
`,nz=`
<svg
  class="lucide lucide-mail-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 15V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="M16 19h6" />
</svg>
`,nA=`
<svg
  class="lucide lucide-mail-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z" />
  <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
</svg>
`,nB=`
<svg
  class="lucide lucide-mail-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="M19 16v6" />
  <path d="M16 19h6" />
</svg>
`,nC=`
<svg
  class="lucide lucide-mail-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 12.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h7.5" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  <circle cx="18" cy="18" r="3" />
  <path d="m22 22-1.5-1.5" />
</svg>
`,nD=`
<svg
  class="lucide lucide-mail-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="M18 15.28c.2-.4.5-.8.9-1a2.1 2.1 0 0 1 2.6.4c.3.4.5.8.5 1.3 0 1.3-2 2-2 2" />
  <path d="M20 22v.01" />
</svg>
`,nE=`
<svg
  class="lucide lucide-mail-warning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="M20 14v4" />
  <path d="M20 22v.01" />
</svg>
`,nF=`
<svg
  class="lucide lucide-mail-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="m17 17 4 4" />
  <path d="m21 17-4 4" />
</svg>
`,nG=`
<svg
  class="lucide lucide-mail"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
  <rect x="2" y="4" width="20" height="16" rx="2" />
</svg>
`,nH=`
<svg
  class="lucide lucide-mailbox"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18c2.2 0 4 1.8 4 4v8Z" />
  <polyline points="15,9 18,9 18,11" />
  <path d="M6.5 5C9 5 11 7 11 9.5V17a2 2 0 0 1-2 2" />
  <line x1="6" x2="7" y1="10" y2="10" />
</svg>
`,nI=`
<svg
  class="lucide lucide-mails"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 1-1.732" />
  <path d="m22 5.5-6.419 4.179a2 2 0 0 1-2.162 0L7 5.5" />
  <rect x="7" y="3" width="15" height="12" rx="2" />
</svg>
`,nJ=`
<svg
  class="lucide lucide-map-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 19-1.106-.552a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0l4.212 2.106a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619V14" />
  <path d="M15 5.764V14" />
  <path d="M21 18h-6" />
  <path d="M9 3.236v15" />
</svg>
`,nK=`
<svg
  class="lucide lucide-map-pin-check-inside"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <path d="m9 10 2 2 4-4" />
</svg>
`,nL=`
<svg
  class="lucide lucide-map-pin-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.43 12.935c.357-.967.57-1.955.57-2.935a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 32.197 32.197 0 0 0 .813-.728" />
  <circle cx="12" cy="10" r="3" />
  <path d="m16 18 2 2 4-4" />
</svg>
`,nM=`
<svg
  class="lucide lucide-map-pin-house"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 22a1 1 0 0 1-1-1v-4a1 1 0 0 1 .445-.832l3-2a1 1 0 0 1 1.11 0l3 2A1 1 0 0 1 22 17v4a1 1 0 0 1-1 1z" />
  <path d="M18 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 .601.2" />
  <path d="M18 22v-3" />
  <circle cx="10" cy="10" r="3" />
</svg>
`,nN=`
<svg
  class="lucide lucide-map-pin-minus-inside"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <path d="M9 10h6" />
</svg>
`,nO=`
<svg
  class="lucide lucide-map-pin-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.75 7.09a3 3 0 0 1 2.16 2.16" />
  <path d="M17.072 17.072c-1.634 2.17-3.527 3.912-4.471 4.727a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 1.432-4.568" />
  <path d="m2 2 20 20" />
  <path d="M8.475 2.818A8 8 0 0 1 20 10c0 1.183-.31 2.377-.81 3.533" />
  <path d="M9.13 9.13a3 3 0 0 0 3.74 3.74" />
</svg>
`,nP=`
<svg
  class="lucide lucide-map-pin-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.977 14C19.6 12.701 20 11.343 20 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 32 32 0 0 0 .824-.738" />
  <circle cx="12" cy="10" r="3" />
  <path d="M16 18h6" />
</svg>
`,nQ=`
<svg
  class="lucide lucide-map-pin-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.97 9.304A8 8 0 0 0 2 10c0 4.69 4.887 9.562 7.022 11.468" />
  <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  <circle cx="10" cy="10" r="3" />
</svg>
`,nR=`
<svg
  class="lucide lucide-map-pin-plus-inside"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <path d="M12 7v6" />
  <path d="M9 10h6" />
</svg>
`,nS=`
<svg
  class="lucide lucide-map-pin-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.914 11.105A7.298 7.298 0 0 0 20 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 32 32 0 0 0 .824-.738" />
  <circle cx="12" cy="10" r="3" />
  <path d="M16 18h6" />
  <path d="M19 15v6" />
</svg>
`,nT=`
<svg
  class="lucide lucide-map-pin-x-inside"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <path d="m14.5 7.5-5 5" />
  <path d="m9.5 7.5 5 5" />
</svg>
`,nU=`
<svg
  class="lucide lucide-map-pin"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <circle cx="12" cy="10" r="3" />
</svg>
`,nV=`
<svg
  class="lucide lucide-map-pin-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.752 11.901A7.78 7.78 0 0 0 20 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 19 19 0 0 0 .09-.077" />
  <circle cx="12" cy="10" r="3" />
  <path d="m21.5 15.5-5 5" />
  <path d="m21.5 20.5-5-5" />
</svg>
`,nW=`
<svg
  class="lucide lucide-map-pinned"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0" />
  <circle cx="12" cy="8" r="2" />
  <path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712" />
</svg>
`,nX=`
<svg
  class="lucide lucide-map-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 19-1.106-.552a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0l4.212 2.106a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619V12" />
  <path d="M15 5.764V12" />
  <path d="M18 15v6" />
  <path d="M21 18h-6" />
  <path d="M9 3.236v15" />
</svg>
`,nY=`
<svg
  class="lucide lucide-map"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
  <path d="M15 5.764v15" />
  <path d="M9 3.236v15" />
</svg>
`,nZ=`
<svg
  class="lucide lucide-mars-stroke"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 6 4 4" />
  <path d="M17 3h4v4" />
  <path d="m21 3-7.75 7.75" />
  <circle cx="9" cy="15" r="6" />
</svg>
`,n$=`
<svg
  class="lucide lucide-mars"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3h5v5" />
  <path d="m21 3-6.75 6.75" />
  <circle cx="10" cy="14" r="6" />
</svg>
`,n_=`
<svg
  class="lucide lucide-martini"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 22h8" />
  <path d="M12 11v11" />
  <path d="m19 3-7 8-7-8Z" />
</svg>
`,n0=`
<svg
  class="lucide lucide-maximize-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 3h6v6" />
  <path d="m21 3-7 7" />
  <path d="m3 21 7-7" />
  <path d="M9 21H3v-6" />
</svg>
`,n1=`
<svg
  class="lucide lucide-maximize"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
</svg>
`,n2=`
<svg
  class="lucide lucide-medal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
  <path d="M11 12 5.12 2.2" />
  <path d="m13 12 5.88-9.8" />
  <path d="M8 7h8" />
  <circle cx="12" cy="17" r="5" />
  <path d="M12 18v-2h-.5" />
</svg>
`,n3=`
<svg
  class="lucide lucide-megaphone-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.636 6A13 13 0 0 0 19.4 3.2 1 1 0 0 1 21 4v11.344" />
  <path d="M14.378 14.357A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1" />
  <path d="m2 2 20 20" />
  <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
  <path d="M8 8v6" />
</svg>
`,n4=`
<svg
  class="lucide lucide-megaphone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
  <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
  <path d="M8 6v8" />
</svg>
`,n5=`
<svg
  class="lucide lucide-meh"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="8" x2="16" y1="15" y2="15" />
  <line x1="9" x2="9.01" y1="9" y2="9" />
  <line x1="15" x2="15.01" y1="9" y2="9" />
</svg>
`,n6=`
<svg
  class="lucide lucide-memory-stick"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 19v-3" />
  <path d="M10 19v-3" />
  <path d="M14 19v-3" />
  <path d="M18 19v-3" />
  <path d="M8 11V9" />
  <path d="M16 11V9" />
  <path d="M12 11V9" />
  <path d="M2 15h20" />
  <path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z" />
</svg>
`,n7=`
<svg
  class="lucide lucide-menu"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 5h16" />
  <path d="M4 12h16" />
  <path d="M4 19h16" />
</svg>
`,n8=`
<svg
  class="lucide lucide-merge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m8 6 4-4 4 4" />
  <path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
  <path d="m20 22-5-5" />
</svg>
`,n9=`
<svg
  class="lucide lucide-message-circle-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 9-3 3 3 3" />
  <path d="m14 15 3-3-3-3" />
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
</svg>
`,oa=`
<svg
  class="lucide lucide-message-circle-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
  <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
  <path d="M17.609 3.72a10 10 0 0 1 2.69 2.7" />
  <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
  <path d="M20.28 17.61a10 10 0 0 1-2.7 2.69" />
  <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
  <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
  <path d="m6.163 21.117-2.906.85a1 1 0 0 1-1.236-1.169l.965-2.98" />
</svg>
`,ob=`
<svg
  class="lucide lucide-message-circle-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M7.828 13.07A3 3 0 0 1 12 8.764a3 3 0 0 1 5.004 2.224 3 3 0 0 1-.832 2.083l-3.447 3.62a1 1 0 0 1-1.45-.001z" />
</svg>
`,oc=`
<svg
  class="lucide lucide-message-circle-more"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M8 12h.01" />
  <path d="M12 12h.01" />
  <path d="M16 12h.01" />
</svg>
`,od=`
<svg
  class="lucide lucide-message-circle-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 20 20" />
  <path d="M4.93 4.929a10 10 0 0 0-1.938 11.412 2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 0 0 11.302-1.989" />
  <path d="M8.35 2.69A10 10 0 0 1 21.3 15.65" />
</svg>
`,oe=`
<svg
  class="lucide lucide-message-circle-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <path d="M12 17h.01" />
</svg>
`,of=`
<svg
  class="lucide lucide-message-circle-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M8 12h8" />
  <path d="M12 8v8" />
</svg>
`,og=`
<svg
  class="lucide lucide-message-circle-reply"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="m10 15-3-3 3-3" />
  <path d="M7 12h8a2 2 0 0 1 2 2v1" />
</svg>
`,oh=`
<svg
  class="lucide lucide-message-circle-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="m15 9-6 6" />
  <path d="m9 9 6 6" />
</svg>
`,oi=`
<svg
  class="lucide lucide-message-circle-warning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M12 8v4" />
  <path d="M12 16h.01" />
</svg>
`,oj=`
<svg
  class="lucide lucide-message-circle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
</svg>
`,ok=`
<svg
  class="lucide lucide-message-square-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 19h.01" />
  <path d="M12 3h.01" />
  <path d="M16 19h.01" />
  <path d="M16 3h.01" />
  <path d="M2 13h.01" />
  <path d="M2 17v4.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H8" />
  <path d="M2 5a2 2 0 0 1 2-2" />
  <path d="M2 9h.01" />
  <path d="M20 3a2 2 0 0 1 2 2" />
  <path d="M22 13h.01" />
  <path d="M22 17a2 2 0 0 1-2 2" />
  <path d="M22 9h.01" />
  <path d="M8 3h.01" />
</svg>
`,ol=`
<svg
  class="lucide lucide-message-square-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="m10 8-3 3 3 3" />
  <path d="m14 14 3-3-3-3" />
</svg>
`,om=`
<svg
  class="lucide lucide-message-square-diff"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M10 15h4" />
  <path d="M10 9h4" />
  <path d="M12 7v4" />
</svg>
`,on=`
<svg
  class="lucide lucide-message-square-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.7 3H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H20a2 2 0 0 0 2-2v-4.7" />
  <circle cx="19" cy="6" r="3" />
</svg>
`,oo=`
<svg
  class="lucide lucide-message-square-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M7.5 9.5c0 .687.265 1.383.697 1.844l3.009 3.264a1.14 1.14 0 0 0 .407.314 1 1 0 0 0 .783-.004 1.14 1.14 0 0 0 .398-.31l3.008-3.264A2.77 2.77 0 0 0 16.5 9.5 2.5 2.5 0 0 0 12 8a2.5 2.5 0 0 0-4.5 1.5" />
</svg>
`,op=`
<svg
  class="lucide lucide-message-square-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 8.5V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H10" />
  <path d="M20 15v-2a2 2 0 0 0-4 0v2" />
  <rect x="14" y="15" width="8" height="5" rx="1" />
</svg>
`,oq=`
<svg
  class="lucide lucide-message-square-more"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M12 11h.01" />
  <path d="M16 11h.01" />
  <path d="M8 11h.01" />
</svg>
`,or=`
<svg
  class="lucide lucide-message-square-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 19H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 1.184-1.826" />
  <path d="m2 2 20 20" />
  <path d="M8.656 3H20a2 2 0 0 1 2 2v11.344" />
</svg>
`,os=`
<svg
  class="lucide lucide-message-square-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M12 8v6" />
  <path d="M9 11h6" />
</svg>
`,ot=`
<svg
  class="lucide lucide-message-square-reply"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="m10 8-3 3 3 3" />
  <path d="M17 14v-1a2 2 0 0 0-2-2H7" />
</svg>
`,ou=`
<svg
  class="lucide lucide-message-square-quote"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 14a2 2 0 0 0 2-2V8h-2" />
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M8 14a2 2 0 0 0 2-2V8H8" />
</svg>
`,ov=`
<svg
  class="lucide lucide-message-square-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M7 11h10" />
  <path d="M7 15h6" />
  <path d="M7 7h8" />
</svg>
`,ow=`
<svg
  class="lucide lucide-message-square-share"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H20a2 2 0 0 0 2-2v-4" />
  <path d="M16 3h6v6" />
  <path d="m16 9 6-6" />
</svg>
`,ox=`
<svg
  class="lucide lucide-message-square-warning"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M12 15h.01" />
  <path d="M12 7v4" />
</svg>
`,oy=`
<svg
  class="lucide lucide-message-square-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="m14.5 8.5-5 5" />
  <path d="m9.5 8.5 5 5" />
</svg>
`,oz=`
<svg
  class="lucide lucide-message-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
</svg>
`,oA=`
<svg
  class="lucide lucide-messages-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
</svg>
`,oB=`
<svg
  class="lucide lucide-mic-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 19v3" />
  <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
  <path d="M16.95 16.95A7 7 0 0 1 5 12v-2" />
  <path d="M18.89 13.23A7 7 0 0 0 19 12v-2" />
  <path d="m2 2 20 20" />
  <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
</svg>
`,oC=`
<svg
  class="lucide lucide-mic-vocal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12" />
  <path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5" />
  <circle cx="16" cy="7" r="5" />
</svg>
`,oD=`
<svg
  class="lucide lucide-mic"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 19v3" />
  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  <rect x="9" y="2" width="6" height="13" rx="3" />
</svg>
`,oE=`
<svg
  class="lucide lucide-microscope"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 18h8" />
  <path d="M3 22h18" />
  <path d="M14 22a7 7 0 1 0 0-14h-1" />
  <path d="M9 14h2" />
  <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
  <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
</svg>
`,oF=`
<svg
  class="lucide lucide-microchip"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 12h2" />
  <path d="M18 16h2" />
  <path d="M18 20h2" />
  <path d="M18 4h2" />
  <path d="M18 8h2" />
  <path d="M4 12h2" />
  <path d="M4 16h2" />
  <path d="M4 20h2" />
  <path d="M4 4h2" />
  <path d="M4 8h2" />
  <path d="M8 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-1.5c-.276 0-.494.227-.562.495a2 2 0 0 1-3.876 0C9.994 2.227 9.776 2 9.5 2z" />
</svg>
`,oG=`
<svg
  class="lucide lucide-microwave"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="15" x="2" y="4" rx="2" />
  <rect width="8" height="7" x="6" y="8" rx="1" />
  <path d="M18 8v7" />
  <path d="M6 19v2" />
  <path d="M18 19v2" />
</svg>
`,oH=`
<svg
  class="lucide lucide-milk-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2h8" />
  <path d="M9 2v1.343M15 2v2.789a4 4 0 0 0 .672 2.219l.656.984a4 4 0 0 1 .672 2.22v1.131M7.8 7.8l-.128.192A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3" />
  <path d="M7 15a6.47 6.47 0 0 1 5 0 6.472 6.472 0 0 0 3.435.435" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,oI=`
<svg
  class="lucide lucide-milestone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v8" />
  <path d="M12 3v3" />
  <path d="M4 6a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h13a2 2 0 0 0 1.152-.365l3.424-2.317a1 1 0 0 0 0-1.635l-3.424-2.318A2 2 0 0 0 17 6z" />
</svg>
`,oJ=`
<svg
  class="lucide lucide-milk"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2h8" />
  <path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2" />
  <path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0" />
</svg>
`,oK=`
<svg
  class="lucide lucide-minimize-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 10 7-7" />
  <path d="M20 10h-6V4" />
  <path d="m3 21 7-7" />
  <path d="M4 14h6v6" />
</svg>
`,oL=`
<svg
  class="lucide lucide-minimize"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
</svg>
`,oM=`
<svg
  class="lucide lucide-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 12h14" />
</svg>
`,oN=`
<svg
  class="lucide lucide-monitor-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 10 2 2 4-4" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
</svg>
`,oO=`
<svg
  class="lucide lucide-monitor-cloud"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 13a3 3 0 1 1 2.83-4H14a2 2 0 0 1 0 4z" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
  <rect x="2" y="3" width="20" height="14" rx="2" />
</svg>
`,oP=`
<svg
  class="lucide lucide-monitor-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v4" />
  <path d="m14.305 7.53.923-.382" />
  <path d="m15.228 4.852-.923-.383" />
  <path d="m16.852 3.228-.383-.924" />
  <path d="m16.852 8.772-.383.923" />
  <path d="m19.148 3.228.383-.924" />
  <path d="m19.53 9.696-.382-.924" />
  <path d="m20.772 4.852.924-.383" />
  <path d="m20.772 7.148.924.383" />
  <path d="M22 13v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
  <path d="M8 21h8" />
  <circle cx="18" cy="6" r="3" />
</svg>
`,oQ=`
<svg
  class="lucide lucide-monitor-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v4" />
  <path d="M22 12.307V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8.693" />
  <path d="M8 21h8" />
  <circle cx="19" cy="6" r="3" />
</svg>
`,oR=`
<svg
  class="lucide lucide-monitor-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2" />
  <path d="M22 15V5a2 2 0 0 0-2-2H9" />
  <path d="M8 21h8" />
  <path d="M12 17v4" />
  <path d="m2 2 20 20" />
</svg>
`,oS=`
<svg
  class="lucide lucide-monitor-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13V7" />
  <path d="m15 10-3 3-3-3" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
</svg>
`,oT=`
<svg
  class="lucide lucide-monitor-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
  <rect x="2" y="3" width="20" height="14" rx="2" />
</svg>
`,oU=`
<svg
  class="lucide lucide-monitor-pause"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 13V7" />
  <path d="M14 13V7" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
</svg>
`,oV=`
<svg
  class="lucide lucide-monitor-smartphone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
  <path d="M10 19v-3.96 3.15" />
  <path d="M7 19h5" />
  <rect width="6" height="10" x="16" y="12" rx="2" />
</svg>
`,oW=`
<svg
  class="lucide lucide-monitor-speaker"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5.5 20H8" />
  <path d="M17 9h.01" />
  <rect width="10" height="16" x="12" y="4" rx="2" />
  <path d="M8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4" />
  <circle cx="17" cy="15" r="1" />
</svg>
`,oX=`
<svg
  class="lucide lucide-monitor-stop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v4" />
  <path d="M8 21h8" />
  <rect x="2" y="3" width="20" height="14" rx="2" />
  <rect x="9" y="7" width="6" height="6" rx="1" />
</svg>
`,oY=`
<svg
  class="lucide lucide-monitor-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 10 3-3 3 3" />
  <path d="M12 13V7" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
</svg>
`,oZ=`
<svg
  class="lucide lucide-monitor-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.5 12.5-5-5" />
  <path d="m9.5 12.5 5-5" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M12 17v4" />
  <path d="M8 21h8" />
</svg>
`,o$=`
<svg
  class="lucide lucide-monitor"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <line x1="8" x2="16" y1="21" y2="21" />
  <line x1="12" x2="12" y1="17" y2="21" />
</svg>
`,o_=`
<svg
  class="lucide lucide-moon-star"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 5h4" />
  <path d="M20 3v4" />
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
</svg>
`,o0=`
<svg
  class="lucide lucide-moon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
</svg>
`,o1=`
<svg
  class="lucide lucide-motorbike"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 14-1-3" />
  <path d="m3 9 6 2a2 2 0 0 1 2-2h2a2 2 0 0 1 1.99 1.81" />
  <path d="M8 17h3a1 1 0 0 0 1-1 6 6 0 0 1 6-6 1 1 0 0 0 1-1v-.75A5 5 0 0 0 17 5" />
  <circle cx="19" cy="17" r="3" />
  <circle cx="5" cy="17" r="3" />
</svg>
`,o2=`
<svg
  class="lucide lucide-mountain-snow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
  <path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" />
</svg>
`,o3=`
<svg
  class="lucide lucide-mountain"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
</svg>
`,o4=`
<svg
  class="lucide lucide-mouse-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6v.343" />
  <path d="M18.218 18.218A7 7 0 0 1 5 15V9a7 7 0 0 1 .782-3.218" />
  <path d="M19 13.343V9A7 7 0 0 0 8.56 2.902" />
  <path d="M22 22 2 2" />
</svg>
`,o5=`
<svg
  class="lucide lucide-mouse-pointer-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
</svg>
`,o6=`
<svg
  class="lucide lucide-mouse-pointer-ban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.034 2.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.944L8.204 7.545a1 1 0 0 0-.66.66l-1.066 3.443a.5.5 0 0 1-.944.033z" />
  <circle cx="16" cy="16" r="6" />
  <path d="m11.8 11.8 8.4 8.4" />
</svg>
`,o7=`
<svg
  class="lucide lucide-mouse-pointer-click"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 4.1 12 6" />
  <path d="m5.1 8-2.9-.8" />
  <path d="m6 12-1.9 2" />
  <path d="M7.2 2.2 8 5.1" />
  <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
</svg>
`,o8=`
<svg
  class="lucide lucide-mouse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="5" y="2" width="14" height="20" rx="7" />
  <path d="M12 6v4" />
</svg>
`,o9=`
<svg
  class="lucide lucide-mouse-pointer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.586 12.586 19 19" />
  <path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z" />
</svg>
`,pa=`
<svg
  class="lucide lucide-move-3d"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 3v16h16" />
  <path d="m5 19 6-6" />
  <path d="m2 6 3-3 3 3" />
  <path d="m18 16 3 3-3 3" />
</svg>
`,pb=`
<svg
  class="lucide lucide-move-diagonal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 19H5v-6" />
  <path d="M13 5h6v6" />
  <path d="M19 5 5 19" />
</svg>
`,pc=`
<svg
  class="lucide lucide-move-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 19H5V13" />
  <path d="M19 5L5 19" />
</svg>
`,pd=`
<svg
  class="lucide lucide-move-diagonal-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 13v6h-6" />
  <path d="M5 11V5h6" />
  <path d="m5 5 14 14" />
</svg>
`,pe=`
<svg
  class="lucide lucide-move-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 13V19H13" />
  <path d="M5 5L19 19" />
</svg>
`,pf=`
<svg
  class="lucide lucide-move-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 18L12 22L16 18" />
  <path d="M12 2V22" />
</svg>
`,pg=`
<svg
  class="lucide lucide-move-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 8 4 4-4 4" />
  <path d="M2 12h20" />
  <path d="m6 8-4 4 4 4" />
</svg>
`,ph=`
<svg
  class="lucide lucide-move-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 8L2 12L6 16" />
  <path d="M2 12H22" />
</svg>
`,pi=`
<svg
  class="lucide lucide-move-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 8L22 12L18 16" />
  <path d="M2 12H22" />
</svg>
`,pj=`
<svg
  class="lucide lucide-move-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 11V5H11" />
  <path d="M5 5L19 19" />
</svg>
`,pk=`
<svg
  class="lucide lucide-move-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 5H19V11" />
  <path d="M19 5L5 19" />
</svg>
`,pl=`
<svg
  class="lucide lucide-move-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 6L12 2L16 6" />
  <path d="M12 2V22" />
</svg>
`,pm=`
<svg
  class="lucide lucide-move-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v20" />
  <path d="m8 18 4 4 4-4" />
  <path d="m8 6 4-4 4 4" />
</svg>
`,pn=`
<svg
  class="lucide lucide-music-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="8" cy="18" r="4" />
  <path d="M12 18V2l7 4" />
</svg>
`,po=`
<svg
  class="lucide lucide-move"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v20" />
  <path d="m15 19-3 3-3-3" />
  <path d="m19 9 3 3-3 3" />
  <path d="M2 12h20" />
  <path d="m5 9-3 3 3 3" />
  <path d="m9 5 3-3 3 3" />
</svg>
`,pp=`
<svg
  class="lucide lucide-music-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="18" r="4" />
  <path d="M16 18V2" />
</svg>
`,pq=`
<svg
  class="lucide lucide-music-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 18V5l12-2v13" />
  <path d="m9 9 12-2" />
  <circle cx="6" cy="18" r="3" />
  <circle cx="18" cy="16" r="3" />
</svg>
`,pr=`
<svg
  class="lucide lucide-music"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 18V5l12-2v13" />
  <circle cx="6" cy="18" r="3" />
  <circle cx="18" cy="16" r="3" />
</svg>
`,ps=`
<svg
  class="lucide lucide-navigation-2-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9.31 9.31 5 21l7-4 7 4-1.17-3.17" />
  <path d="M14.53 8.88 12 2l-1.17 3.17" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,pt=`
<svg
  class="lucide lucide-navigation-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polygon points="12 2 19 21 12 17 5 21 12 2" />
</svg>
`,pu=`
<svg
  class="lucide lucide-navigation-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8.43 8.43 3 11l8 2 2 8 2.57-5.43" />
  <path d="M17.39 11.73 22 2l-9.73 4.61" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,pv=`
<svg
  class="lucide lucide-navigation"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polygon points="3 11 22 2 13 21 11 13 3 11" />
</svg>
`,pw=`
<svg
  class="lucide lucide-network"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="16" y="16" width="6" height="6" rx="1" />
  <rect x="2" y="16" width="6" height="6" rx="1" />
  <rect x="9" y="2" width="6" height="6" rx="1" />
  <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
  <path d="M12 12V8" />
</svg>
`,px=`
<svg
  class="lucide lucide-newspaper"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 18h-5" />
  <path d="M18 14h-8" />
  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" />
  <rect width="8" height="4" x="10" y="6" rx="1" />
</svg>
`,py=`
<svg
  class="lucide lucide-nfc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 8.32a7.43 7.43 0 0 1 0 7.36" />
  <path d="M9.46 6.21a11.76 11.76 0 0 1 0 11.58" />
  <path d="M12.91 4.1a15.91 15.91 0 0 1 .01 15.8" />
  <path d="M16.37 2a20.16 20.16 0 0 1 0 20" />
</svg>
`,pz=`
<svg
  class="lucide lucide-non-binary"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v10" />
  <path d="m8.5 4 7 4" />
  <path d="m8.5 8 7-4" />
  <circle cx="12" cy="17" r="5" />
</svg>
`,pA=`
<svg
  class="lucide lucide-notebook-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
  <path d="M2 6h4" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
</svg>
`,pB=`
<svg
  class="lucide lucide-notebook-tabs"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 6h4" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <rect width="16" height="20" x="4" y="2" rx="2" />
  <path d="M15 2v20" />
  <path d="M15 7h5" />
  <path d="M15 12h5" />
  <path d="M15 17h5" />
</svg>
`,pC=`
<svg
  class="lucide lucide-notebook-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 6h4" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <rect width="16" height="20" x="4" y="2" rx="2" />
  <path d="M9.5 8h5" />
  <path d="M9.5 12H16" />
  <path d="M9.5 16H14" />
</svg>
`,pD=`
<svg
  class="lucide lucide-notebook"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 6h4" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <rect width="16" height="20" x="4" y="2" rx="2" />
  <path d="M16 2v20" />
</svg>
`,pE=`
<svg
  class="lucide lucide-notepad-text-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M12 2v4" />
  <path d="M16 2v4" />
  <path d="M16 4h2a2 2 0 0 1 2 2v2" />
  <path d="M20 12v2" />
  <path d="M20 18v2a2 2 0 0 1-2 2h-1" />
  <path d="M13 22h-2" />
  <path d="M7 22H6a2 2 0 0 1-2-2v-2" />
  <path d="M4 14v-2" />
  <path d="M4 8V6a2 2 0 0 1 2-2h2" />
  <path d="M8 10h6" />
  <path d="M8 14h8" />
  <path d="M8 18h5" />
</svg>
`,pF=`
<svg
  class="lucide lucide-notepad-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 2v4" />
  <path d="M12 2v4" />
  <path d="M16 2v4" />
  <rect width="16" height="18" x="4" y="4" rx="2" />
  <path d="M8 10h6" />
  <path d="M8 14h8" />
  <path d="M8 18h5" />
</svg>
`,pG=`
<svg
  class="lucide lucide-nut-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 4V2" />
  <path d="M5 10v4a7.004 7.004 0 0 0 5.277 6.787c.412.104.802.292 1.102.592L12 22l.621-.621c.3-.3.69-.488 1.102-.592a7.01 7.01 0 0 0 4.125-2.939" />
  <path d="M19 10v3.343" />
  <path d="M12 12c-1.349-.573-1.905-1.005-2.5-2-.546.902-1.048 1.353-2.5 2-1.018-.644-1.46-1.08-2-2-1.028.71-1.69.918-3 1 1.081-1.048 1.757-2.03 2-3 .194-.776.84-1.551 1.79-2.21m11.654 5.997c.887-.457 1.28-.891 1.556-1.787 1.032.916 1.683 1.157 3 1-1.297-1.036-1.758-2.03-2-3-.5-2-4-4-8-4-.74 0-1.461.068-2.15.192" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,pH=`
<svg
  class="lucide lucide-nut"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 4V2" />
  <path d="M5 10v4a7.004 7.004 0 0 0 5.277 6.787c.412.104.802.292 1.102.592L12 22l.621-.621c.3-.3.69-.488 1.102-.592A7.003 7.003 0 0 0 19 14v-4" />
  <path d="M12 4C8 4 4.5 6 4 8c-.243.97-.919 1.952-2 3 1.31-.082 1.972-.29 3-1 .54.92.982 1.356 2 2 1.452-.647 1.954-1.098 2.5-2 .595.995 1.151 1.427 2.5 2 1.31-.621 1.862-1.058 2.5-2 .629.977 1.162 1.423 2.5 2 1.209-.548 1.68-.967 2-2 1.032.916 1.683 1.157 3 1-1.297-1.036-1.758-2.03-2-3-.5-2-4-4-8-4Z" />
</svg>
`,pI=`
<svg
  class="lucide lucide-octagon-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 16h.01" />
  <path d="M12 8v4" />
  <path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" />
</svg>
`,pJ=`
<svg
  class="lucide lucide-octagon-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
  <path d="M8 12h8" />
</svg>
`,pK=`
<svg
  class="lucide lucide-octagon-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 9-6 6" />
  <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
  <path d="m9 9 6 6" />
</svg>
`,pL=`
<svg
  class="lucide lucide-octagon-pause"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 15V9" />
  <path d="M14 15V9" />
  <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
</svg>
`,pM=`
<svg
  class="lucide lucide-octagon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
</svg>
`,pN=`
<svg
  class="lucide lucide-omega"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21" />
</svg>
`,pO=`
<svg
  class="lucide lucide-option"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3h6l6 18h6" />
  <path d="M14 3h7" />
</svg>
`,pP=`
<svg
  class="lucide lucide-orbit"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85" />
  <path d="M3.659 17.516A10 10 0 0 1 13.74 2.152" />
  <circle cx="12" cy="12" r="3" />
  <circle cx="19" cy="5" r="2" />
  <circle cx="5" cy="19" r="2" />
</svg>
`,pQ=`
<svg
  class="lucide lucide-origami"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12V4a1 1 0 0 1 1-1h6.297a1 1 0 0 1 .651 1.759l-4.696 4.025" />
  <path d="m12 21-7.414-7.414A2 2 0 0 1 4 12.172V6.415a1.002 1.002 0 0 1 1.707-.707L20 20.009" />
  <path d="m12.214 3.381 8.414 14.966a1 1 0 0 1-.167 1.199l-1.168 1.163a1 1 0 0 1-.706.291H6.351a1 1 0 0 1-.625-.219L3.25 18.8a1 1 0 0 1 .631-1.781l4.165.027" />
</svg>
`,pR=`
<svg
  class="lucide lucide-package-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v6" />
  <path d="M16.76 3a2 2 0 0 1 1.8 1.1l2.23 4.479a2 2 0 0 1 .21.891V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.472a2 2 0 0 1 .211-.894L5.45 4.1A2 2 0 0 1 7.24 3z" />
  <path d="M3.054 9.013h17.893" />
</svg>
`,pS=`
<svg
  class="lucide lucide-package-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 16 2 2 4-4" />
  <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
  <path d="m7.5 4.27 9 5.15" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <line x1="12" x2="12" y1="22" y2="12" />
</svg>
`,pT=`
<svg
  class="lucide lucide-package-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 16h6" />
  <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
  <path d="m7.5 4.27 9 5.15" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <line x1="12" x2="12" y1="22" y2="12" />
</svg>
`,pU=`
<svg
  class="lucide lucide-package-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-9" />
  <path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z" />
  <path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13" />
  <path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z" />
</svg>
`,pV=`
<svg
  class="lucide lucide-package-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
  <path d="m7.5 4.27 9 5.15" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <line x1="12" x2="12" y1="22" y2="12" />
  <circle cx="18.5" cy="15.5" r="2.5" />
  <path d="M20.27 17.27 22 19" />
</svg>
`,pW=`
<svg
  class="lucide lucide-package-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 16h6" />
  <path d="M19 13v6" />
  <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
  <path d="m7.5 4.27 9 5.15" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <line x1="12" x2="12" y1="22" y2="12" />
</svg>
`,pX=`
<svg
  class="lucide lucide-package"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
  <path d="M12 22V12" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <path d="m7.5 4.27 9 5.15" />
</svg>
`,pY=`
<svg
  class="lucide lucide-paint-bucket"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
  <path d="m5 2 5 5" />
  <path d="M2 13h15" />
  <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
</svg>
`,pZ=`
<svg
  class="lucide lucide-package-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
  <path d="m7.5 4.27 9 5.15" />
  <polyline points="3.29 7 12 12 20.71 7" />
  <line x1="12" x2="12" y1="22" y2="12" />
  <path d="m17 13 5 5m-5 0 5-5" />
</svg>
`,p$=`
<svg
  class="lucide lucide-paintbrush-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v2" />
  <path d="M14 2v4" />
  <path d="M17 2a1 1 0 0 1 1 1v9H6V3a1 1 0 0 1 1-1z" />
  <path d="M6 12a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v2.9a2 2 0 1 0 4 0V17a1 1 0 0 1 1-1h2a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1" />
</svg>
`,p_=`
<svg
  class="lucide lucide-paint-roller"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="6" x="2" y="2" rx="2" />
  <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
  <rect width="4" height="6" x="8" y="16" rx="1" />
</svg>
`,p0=`
<svg
  class="lucide lucide-paintbrush"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.622 17.897-10.68-2.913" />
  <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" />
  <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
</svg>
`,p1=`
<svg
  class="lucide lucide-palette"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
</svg>
`,p2=`
<svg
  class="lucide lucide-panda"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.25 17.25h1.5L12 18z" />
  <path d="m15 12 2 2" />
  <path d="M18 6.5a.5.5 0 0 0-.5-.5" />
  <path d="M20.69 9.67a4.5 4.5 0 1 0-7.04-5.5 8.35 8.35 0 0 0-3.3 0 4.5 4.5 0 1 0-7.04 5.5C2.49 11.2 2 12.88 2 14.5 2 19.47 6.48 22 12 22s10-2.53 10-7.5c0-1.62-.48-3.3-1.3-4.83" />
  <path d="M6 6.5a.495.495 0 0 1 .5-.5" />
  <path d="m9 12-2 2" />
</svg>
`,p3=`
<svg
  class="lucide lucide-panel-bottom-close"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 15h18" />
  <path d="m15 8-3 3-3-3" />
</svg>
`,p4=`
<svg
  class="lucide lucide-panel-bottom-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M14 15h1" />
  <path d="M19 15h2" />
  <path d="M3 15h2" />
  <path d="M9 15h1" />
</svg>
`,p5=`
<svg
  class="lucide lucide-panel-bottom-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 15h18" />
  <path d="m9 10 3-3 3 3" />
</svg>
`,p6=`
<svg
  class="lucide lucide-panel-bottom"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 15h18" />
</svg>
`,p7=`
<svg
  class="lucide lucide-panel-left-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 14v1" />
  <path d="M9 19v2" />
  <path d="M9 3v2" />
  <path d="M9 9v1" />
</svg>
`,p8=`
<svg
  class="lucide lucide-panel-left-close"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="m16 15-3-3 3-3" />
</svg>
`,p9=`
<svg
  class="lucide lucide-panel-left-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="m14 9 3 3-3 3" />
</svg>
`,qa=`
<svg
  class="lucide lucide-panel-left-right-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 10V9" />
  <path d="M15 15v-1" />
  <path d="M15 21v-2" />
  <path d="M15 5V3" />
  <path d="M9 10V9" />
  <path d="M9 15v-1" />
  <path d="M9 21v-2" />
  <path d="M9 5V3" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,qb=`
<svg
  class="lucide lucide-panel-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
</svg>
`,qc=`
<svg
  class="lucide lucide-panel-right-close"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M15 3v18" />
  <path d="m8 9 3 3-3 3" />
</svg>
`,qd=`
<svg
  class="lucide lucide-panel-right-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M15 14v1" />
  <path d="M15 19v2" />
  <path d="M15 3v2" />
  <path d="M15 9v1" />
</svg>
`,qe=`
<svg
  class="lucide lucide-panel-right-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M15 3v18" />
  <path d="m10 15-3-3 3-3" />
</svg>
`,qf=`
<svg
  class="lucide lucide-panel-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M15 3v18" />
</svg>
`,qg=`
<svg
  class="lucide lucide-panel-top-bottom-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 15h1" />
  <path d="M14 9h1" />
  <path d="M19 15h2" />
  <path d="M19 9h2" />
  <path d="M3 15h2" />
  <path d="M3 9h2" />
  <path d="M9 15h1" />
  <path d="M9 9h1" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,qh=`
<svg
  class="lucide lucide-panel-top-close"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="m9 16 3-3 3 3" />
</svg>
`,qi=`
<svg
  class="lucide lucide-panel-top-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M14 9h1" />
  <path d="M19 9h2" />
  <path d="M3 9h2" />
  <path d="M9 9h1" />
</svg>
`,qj=`
<svg
  class="lucide lucide-panel-top-open"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="m15 14-3 3-3-3" />
</svg>
`,qk=`
<svg
  class="lucide lucide-panel-top"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
</svg>
`,ql=`
<svg
  class="lucide lucide-panels-left-bottom"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="M9 15h12" />
</svg>
`,qm=`
<svg
  class="lucide lucide-panels-top-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="M9 21V9" />
</svg>
`,qn=`
<svg
  class="lucide lucide-panels-right-bottom"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 15h12" />
  <path d="M15 3v18" />
</svg>
`,qo=`
<svg
  class="lucide lucide-paperclip"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
</svg>
`,qp=`
<svg
  class="lucide lucide-parentheses"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 21s-4-3-4-9 4-9 4-9" />
  <path d="M16 3s4 3 4 9-4 9-4 9" />
</svg>
`,qq=`
<svg
  class="lucide lucide-party-popper"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5.8 11.3 2 22l10.7-3.79" />
  <path d="M4 3h.01" />
  <path d="M22 8h.01" />
  <path d="M15 2h.01" />
  <path d="M22 20h.01" />
  <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" />
  <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" />
  <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" />
  <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" />
</svg>
`,qr=`
<svg
  class="lucide lucide-parking-meter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 15h2" />
  <path d="M12 12v3" />
  <path d="M12 19v3" />
  <path d="M15.282 19a1 1 0 0 0 .948-.68l2.37-6.988a7 7 0 1 0-13.2 0l2.37 6.988a1 1 0 0 0 .948.68z" />
  <path d="M9 9a3 3 0 1 1 6 0" />
</svg>
`,qs=`
<svg
  class="lucide lucide-pause"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="14" y="3" width="5" height="18" rx="1" />
  <rect x="5" y="3" width="5" height="18" rx="1" />
</svg>
`,qt=`
<svg
  class="lucide lucide-paw-print"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="4" r="2" />
  <circle cx="18" cy="8" r="2" />
  <circle cx="20" cy="16" r="2" />
  <path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" />
</svg>
`,qu=`
<svg
  class="lucide lucide-pc-case"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="20" x="5" y="2" rx="2" />
  <path d="M15 14h.01" />
  <path d="M9 6h6" />
  <path d="M9 10h6" />
</svg>
`,qv=`
<svg
  class="lucide lucide-pen-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 21h8" />
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
</svg>
`,qw=`
<svg
  class="lucide lucide-pen-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 10-6.157 6.162a2 2 0 0 0-.5.833l-1.322 4.36a.5.5 0 0 0 .622.624l4.358-1.323a2 2 0 0 0 .83-.5L14 13.982" />
  <path d="m12.829 7.172 4.359-4.346a1 1 0 1 1 3.986 3.986l-4.353 4.353" />
  <path d="m2 2 20 20" />
</svg>
`,qx=`
<svg
  class="lucide lucide-pen-tool"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
  <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
  <path d="m2.3 2.3 7.286 7.286" />
  <circle cx="11" cy="11" r="2" />
</svg>
`,qy=`
<svg
  class="lucide lucide-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
</svg>
`,qz=`
<svg
  class="lucide lucide-pencil-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 10-6.157 6.162a2 2 0 0 0-.5.833l-1.322 4.36a.5.5 0 0 0 .622.624l4.358-1.323a2 2 0 0 0 .83-.5L14 13.982" />
  <path d="m12.829 7.172 4.359-4.346a1 1 0 1 1 3.986 3.986l-4.353 4.353" />
  <path d="m15 5 4 4" />
  <path d="m2 2 20 20" />
</svg>
`,qA=`
<svg
  class="lucide lucide-pencil-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 21h8" />
  <path d="m15 5 4 4" />
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
</svg>
`,qB=`
<svg
  class="lucide lucide-pencil-ruler"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
  <path d="m8 6 2-2" />
  <path d="m18 16 2-2" />
  <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  <path d="m15 5 4 4" />
</svg>
`,qC=`
<svg
  class="lucide lucide-pencil"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  <path d="m15 5 4 4" />
</svg>
`,qD=`
<svg
  class="lucide lucide-pentagon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.83 2.38a2 2 0 0 1 2.34 0l8 5.74a2 2 0 0 1 .73 2.25l-3.04 9.26a2 2 0 0 1-1.9 1.37H7.04a2 2 0 0 1-1.9-1.37L2.1 10.37a2 2 0 0 1 .73-2.25z" />
</svg>
`,qE=`
<svg
  class="lucide lucide-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="19" x2="5" y1="5" y2="19" />
  <circle cx="6.5" cy="6.5" r="2.5" />
  <circle cx="17.5" cy="17.5" r="2.5" />
</svg>
`,qF=`
<svg
  class="lucide lucide-person-standing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="5" r="1" />
  <path d="m9 20 3-6 3 6" />
  <path d="m6 8 6 2 6-2" />
  <path d="M12 10v4" />
</svg>
`,qG=`
<svg
  class="lucide lucide-phone-call"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 2a9 9 0 0 1 9 9" />
  <path d="M13 6a5 5 0 0 1 5 5" />
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qH=`
<svg
  class="lucide lucide-philippine-peso"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 11H4" />
  <path d="M20 7H4" />
  <path d="M7 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 0 12H7" />
</svg>
`,qI=`
<svg
  class="lucide lucide-phone-forwarded"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 6h8" />
  <path d="m18 2 4 4-4 4" />
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qJ=`
<svg
  class="lucide lucide-phone-incoming"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 2v6h6" />
  <path d="m22 2-6 6" />
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qK=`
<svg
  class="lucide lucide-phone-missed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 2 6 6" />
  <path d="m22 2-6 6" />
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qL=`
<svg
  class="lucide lucide-phone-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272" />
  <path d="M22 2 2 22" />
  <path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473" />
</svg>
`,qM=`
<svg
  class="lucide lucide-phone-outgoing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 8 6-6" />
  <path d="M22 8V2h-6" />
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qN=`
<svg
  class="lucide lucide-phone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
</svg>
`,qO=`
<svg
  class="lucide lucide-piano"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8" />
  <path d="M2 14h20" />
  <path d="M6 14v4" />
  <path d="M10 14v4" />
  <path d="M14 14v4" />
  <path d="M18 14v4" />
</svg>
`,qP=`
<svg
  class="lucide lucide-pi"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="9" x2="9" y1="4" y2="20" />
  <path d="M4 7c0-1.7 1.3-3 3-3h13" />
  <path d="M18 20c-1.7 0-3-1.3-3-3V4" />
</svg>
`,qQ=`
<svg
  class="lucide lucide-pickaxe"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999" />
  <path d="M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024" />
  <path d="M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069" />
  <path d="M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z" />
</svg>
`,qR=`
<svg
  class="lucide lucide-picture-in-picture-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
  <rect width="10" height="7" x="12" y="13" rx="2" />
</svg>
`,qS=`
<svg
  class="lucide lucide-picture-in-picture"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 10h6V4" />
  <path d="m2 4 6 6" />
  <path d="M21 10V7a2 2 0 0 0-2-2h-7" />
  <path d="M3 14v2a2 2 0 0 0 2 2h3" />
  <rect x="12" y="14" width="10" height="7" rx="1" />
</svg>
`,qT=`
<svg
  class="lucide lucide-piggy-bank"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z" />
  <path d="M16 10h.01" />
  <path d="M2 8v1a2 2 0 0 0 2 2h1" />
</svg>
`,qU=`
<svg
  class="lucide lucide-pilcrow-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 3v11" />
  <path d="M14 9h-3a3 3 0 0 1 0-6h9" />
  <path d="M18 3v11" />
  <path d="M22 18H2l4-4" />
  <path d="m6 22-4-4" />
</svg>
`,qV=`
<svg
  class="lucide lucide-pilcrow-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 3v11" />
  <path d="M10 9H7a1 1 0 0 1 0-6h8" />
  <path d="M14 3v11" />
  <path d="m18 14 4 4H2" />
  <path d="m22 18-4 4" />
</svg>`,qW=`
<svg
  class="lucide lucide-pilcrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 4v16" />
  <path d="M17 4v16" />
  <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
</svg>
`,qX=`
<svg
  class="lucide lucide-pill-bottle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 11h-4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h4" />
  <path d="M6 7v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
  <rect width="16" height="5" x="4" y="2" rx="1" />
</svg>
`,qY=`
<svg
  class="lucide lucide-pill"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
  <path d="m8.5 8.5 7 7" />
</svg>
`,qZ=`
<svg
  class="lucide lucide-pin-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v5" />
  <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
  <path d="m2 2 20 20" />
  <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
</svg>
`,q$=`
<svg
  class="lucide lucide-pin"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v5" />
  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
</svg>
`,q_=`
<svg
  class="lucide lucide-pipette"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12" />
  <path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z" />
  <path d="m2 22 .414-.414" />
</svg>
`,q0=`
<svg
  class="lucide lucide-pizza"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 14-1 1" />
  <path d="m13.75 18.25-1.25 1.42" />
  <path d="M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12" />
  <path d="M18.8 9.3a1 1 0 0 0 2.1 7.7" />
  <path d="M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z" />
</svg>
`,q1=`
<svg
  class="lucide lucide-plane-landing"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 22h20" />
  <path d="M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38Z" />
</svg>
`,q2=`
<svg
  class="lucide lucide-plane-takeoff"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 22h20" />
  <path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z" />
</svg>
`,q3=`
<svg
  class="lucide lucide-plane"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
</svg>
`,q4=`
<svg
  class="lucide lucide-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
</svg>
`,q5=`
<svg
  class="lucide lucide-plug-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 2v6" />
  <path d="M15 2v6" />
  <path d="M12 17v5" />
  <path d="M5 8h14" />
  <path d="M6 11V8h12v3a6 6 0 1 1-12 0Z" />
</svg>
`,q6=`
<svg
  class="lucide lucide-plug-zap"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
  <path d="m2 22 3-3" />
  <path d="M7.5 13.5 10 11" />
  <path d="M10.5 16.5 13 14" />
  <path d="m18 3-4 4h6l-4 4" />
</svg>
`,q7=`
<svg
  class="lucide lucide-plug"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-5" />
  <path d="M9 8V2" />
  <path d="M15 8V2" />
  <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
</svg>
`,q8=`
<svg
  class="lucide lucide-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 12h14" />
  <path d="M12 5v14" />
</svg>
`,q9=`
<svg
  class="lucide lucide-pocket"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 3a2 2 0 0 1 2 2v6a1 1 0 0 1-20 0V5a2 2 0 0 1 2-2z" />
  <path d="m8 10 4 4 4-4" />
</svg>
`,ra=`
<svg
  class="lucide lucide-podcast"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 17a1 1 0 1 0-2 0l.5 4.5a0.5 0.5 0 0 0 1 0z" fill="currentColor" />
  <path d="M16.85 18.58a9 9 0 1 0-9.7 0" />
  <path d="M8 14a5 5 0 1 1 8 0" />
  <circle cx="12" cy="11" r="1" fill="currentColor" />
</svg>
`,rb=`
<svg
  class="lucide lucide-pocket-knife"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 2v1c0 1 2 1 2 2S3 6 3 7s2 1 2 2-2 1-2 2 2 1 2 2" />
  <path d="M18 6h.01" />
  <path d="M6 18h.01" />
  <path d="M20.83 8.83a4 4 0 0 0-5.66-5.66l-12 12a4 4 0 1 0 5.66 5.66Z" />
  <path d="M18 11.66V22a4 4 0 0 0 4-4V6" />
</svg>
`,rc=`
<svg
  class="lucide lucide-pointer-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 4.5V4a2 2 0 0 0-2.41-1.957" />
  <path d="M13.9 8.4a2 2 0 0 0-1.26-1.295" />
  <path d="M21.7 16.2A8 8 0 0 0 22 14v-3a2 2 0 1 0-4 0v-1a2 2 0 0 0-3.63-1.158" />
  <path d="m7 15-1.8-1.8a2 2 0 0 0-2.79 2.86L6 19.7a7.74 7.74 0 0 0 6 2.3h2a8 8 0 0 0 5.657-2.343" />
  <path d="M6 6v8" />
  <path d="m2 2 20 20" />
</svg>
`,rd=`
<svg
  class="lucide lucide-pointer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 14a8 8 0 0 1-8 8" />
  <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
  <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
  <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
  <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
</svg>
`,re=`
<svg
  class="lucide lucide-popcorn"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4" />
  <path d="M10 22 9 8" />
  <path d="m14 22 1-14" />
  <path d="M20 8c.5 0 .9.4.8 1l-2.6 12c-.1.5-.7 1-1.2 1H7c-.6 0-1.1-.4-1.2-1L3.2 9c-.1-.6.3-1 .8-1Z" />
</svg>
`,rf=`
<svg
  class="lucide lucide-popsicle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.6 14.4c.8-.8.8-2 0-2.8l-8.1-8.1a4.95 4.95 0 1 0-7.1 7.1l8.1 8.1c.9.7 2.1.7 2.9-.1Z" />
  <path d="m22 22-5.5-5.5" />
</svg>
`,rg=`
<svg
  class="lucide lucide-pound-sterling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 7c0-5.333-8-5.333-8 0" />
  <path d="M10 7v14" />
  <path d="M6 21h12" />
  <path d="M6 13h10" />
</svg>
`,rh=`
<svg
  class="lucide lucide-power-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
  <path d="M6.16 6.16a9 9 0 1 0 12.68 12.68" />
  <path d="M12 2v4" />
  <path d="m2 2 20 20" />
</svg>
`,ri=`
<svg
  class="lucide lucide-power"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v10" />
  <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
</svg>
`,rj=`
<svg
  class="lucide lucide-presentation"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 3h20" />
  <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
  <path d="m7 21 5-5 5 5" />
</svg>
`,rk=`
<svg
  class="lucide lucide-printer-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.5 22H7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v.5" />
  <path d="m16 19 2 2 4-4" />
  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2" />
  <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
</svg>
`,rl=`
<svg
  class="lucide lucide-printer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
  <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
  <rect x="6" y="14" width="12" height="8" rx="1" />
</svg>
`,rm=`
<svg
  class="lucide lucide-projector"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 7 3 5" />
  <path d="M9 6V3" />
  <path d="m13 7 2-2" />
  <circle cx="9" cy="13" r="3" />
  <path d="M11.83 12H20a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h2.17" />
  <path d="M16 16h2" />
</svg>
`,rn=`
<svg
  class="lucide lucide-proportions"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M12 9v11" />
  <path d="M2 9h13a2 2 0 0 1 2 2v9" />
</svg>
`,ro=`
<svg
  class="lucide lucide-puzzle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
</svg>
`,rp=`
<svg
  class="lucide lucide-pyramid"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.5 16.88a1 1 0 0 1-.32-1.43l9-13.02a1 1 0 0 1 1.64 0l9 13.01a1 1 0 0 1-.32 1.44l-8.51 4.86a2 2 0 0 1-1.98 0Z" />
  <path d="M12 2v20" />
</svg>
`,rq=`
<svg
  class="lucide lucide-qr-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="5" height="5" x="3" y="3" rx="1" />
  <rect width="5" height="5" x="16" y="3" rx="1" />
  <rect width="5" height="5" x="3" y="16" rx="1" />
  <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
  <path d="M21 21v.01" />
  <path d="M12 7v3a2 2 0 0 1-2 2H7" />
  <path d="M3 12h.01" />
  <path d="M12 3h.01" />
  <path d="M12 16v.01" />
  <path d="M16 12h1" />
  <path d="M21 12v.01" />
  <path d="M12 21v-1" />
</svg>
`,rr=`
<svg
  class="lucide lucide-quote"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
  <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
</svg>
`,rs=`
<svg
  class="lucide lucide-rabbit"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 16a3 3 0 0 1 2.24 5" />
  <path d="M18 12h.01" />
  <path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3" />
  <path d="M20 8.54V4a2 2 0 1 0-4 0v3" />
  <path d="M7.612 12.524a3 3 0 1 0-1.6 4.3" />
</svg>
`,rt=`
<svg
  class="lucide lucide-radar"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
  <path d="M4 6h.01" />
  <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
  <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
  <path d="M12 18h.01" />
  <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
  <circle cx="12" cy="12" r="2" />
  <path d="m13.41 10.59 5.66-5.66" />
</svg>
`,ru=`
<svg
  class="lucide lucide-radical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 12h3.28a1 1 0 0 1 .948.684l2.298 7.934a.5.5 0 0 0 .96-.044L13.82 4.771A1 1 0 0 1 14.792 4H21" />
</svg>
`,rv=`
<svg
  class="lucide lucide-radiation"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 12h.01" />
  <path d="M14 15.4641a4 4 0 0 1-4 0L7.52786 19.74597 A 1 1 0 0 0 7.99303 21.16211 10 10 0 0 0 16.00697 21.16211 1 1 0 0 0 16.47214 19.74597z" />
  <path d="M16 12a4 4 0 0 0-2-3.464l2.472-4.282a1 1 0 0 1 1.46-.305 10 10 0 0 1 4.006 6.94A1 1 0 0 1 21 12z" />
  <path d="M8 12a4 4 0 0 1 2-3.464L7.528 4.254a1 1 0 0 0-1.46-.305 10 10 0 0 0-4.006 6.94A1 1 0 0 0 3 12z" />
</svg>
`,rw=`
<svg
  class="lucide lucide-radio-receiver"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 16v2" />
  <path d="M19 16v2" />
  <rect width="20" height="8" x="2" y="8" rx="2" />
  <path d="M18 12h.01" />
</svg>
`,rx=`
<svg
  class="lucide lucide-radio-tower"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
  <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
  <circle cx="12" cy="9" r="2" />
  <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
  <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
  <path d="M9.5 18h5" />
  <path d="m8 22 4-11 4 11" />
</svg>
`,ry=`
<svg
  class="lucide lucide-radio"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.247 7.761a6 6 0 0 1 0 8.478" />
  <path d="M19.075 4.933a10 10 0 0 1 0 14.134" />
  <path d="M4.925 19.067a10 10 0 0 1 0-14.134" />
  <path d="M7.753 16.239a6 6 0 0 1 0-8.478" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,rz=`
<svg
  class="lucide lucide-radius"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.34 17.52a10 10 0 1 0-2.82 2.82" />
  <circle cx="19" cy="19" r="2" />
  <path d="m13.41 13.41 4.18 4.18" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,rA=`
<svg
  class="lucide lucide-rail-symbol"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 15h14" />
  <path d="M5 9h14" />
  <path d="m14 20-5-5 6-6-5-5" />
</svg>
`,rB=`
<svg
  class="lucide lucide-rat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 22H4a2 2 0 0 1 0-4h12" />
  <path d="M13.236 18a3 3 0 0 0-2.2-5" />
  <path d="M16 9h.01" />
  <path d="M16.82 3.94a3 3 0 1 1 3.237 4.868l1.815 2.587a1.5 1.5 0 0 1-1.5 2.1l-2.872-.453a3 3 0 0 0-3.5 3" />
  <path d="M17 4.988a3 3 0 1 0-5.2 2.052A7 7 0 0 0 4 14.015 4 4 0 0 0 8 18" />
</svg>
`,rC=`
<svg
  class="lucide lucide-rainbow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17a10 10 0 0 0-20 0" />
  <path d="M6 17a6 6 0 0 1 12 0" />
  <path d="M10 17a2 2 0 0 1 4 0" />
</svg>
`,rD=`
<svg
  class="lucide lucide-ratio"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="12" height="20" x="6" y="2" rx="2" />
  <rect width="20" height="12" x="2" y="6" rx="2" />
</svg>
`,rE=`
<svg
  class="lucide lucide-receipt-cent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M12 6.5v11" />
  <path d="M15 9.4a4 4 0 1 0 0 5.2" />
</svg>
`,rF=`
<svg
  class="lucide lucide-receipt-euro"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M8 12h5" />
  <path d="M16 9.5a4 4 0 1 0 0 5.2" />
</svg>
`,rG=`
<svg
  class="lucide lucide-receipt-indian-rupee"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M8 7h8" />
  <path d="M12 17.5 8 15h1a4 4 0 0 0 0-8" />
  <path d="M8 11h8" />
</svg>
`,rH=`
<svg
  class="lucide lucide-receipt-japanese-yen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="m12 10 3-3" />
  <path d="m9 7 3 3v7.5" />
  <path d="M9 11h6" />
  <path d="M9 15h6" />
</svg>
`,rI=`
<svg
  class="lucide lucide-receipt-pound-sterling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M8 13h5" />
  <path d="M10 17V9.5a2.5 2.5 0 0 1 5 0" />
  <path d="M8 17h7" />
</svg>
`,rJ=`
<svg
  class="lucide lucide-receipt-russian-ruble"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M8 15h5" />
  <path d="M8 11h5a2 2 0 1 0 0-4h-3v10" />
</svg>
`,rK=`
<svg
  class="lucide lucide-receipt-swiss-franc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M10 17V7h5" />
  <path d="M10 11h4" />
  <path d="M8 15h5" />
</svg>
`,rL=`
<svg
  class="lucide lucide-receipt-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 16H8" />
  <path d="M14 8H8" />
  <path d="M16 12H8" />
  <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />
</svg>
`,rM=`
<svg
  class="lucide lucide-receipt-turkish-lira"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 6.5v11a5.5 5.5 0 0 0 5.5-5.5" />
  <path d="m14 8-6 3" />
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
</svg>
`,rN=`
<svg
  class="lucide lucide-receipt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
  <path d="M12 17.5v-11" />
</svg>
`,rO=`
<svg
  class="lucide lucide-rectangle-circle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 4v16H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
  <circle cx="14" cy="12" r="8" />
</svg>
`,rP=`
<svg
  class="lucide lucide-rectangle-ellipsis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="12" x="2" y="6" rx="2" />
  <path d="M12 12h.01" />
  <path d="M17 12h.01" />
  <path d="M7 12h.01" />
</svg>
`,rQ=`
<svg
  class="lucide lucide-rectangle-goggles"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-1.6-.8l-1.6-2.13a1 1 0 0 0-1.6 0L9.6 17.2A2 2 0 0 1 8 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
</svg>
`,rR=`
<svg
  class="lucide lucide-rectangle-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="12" x="2" y="6" rx="2" />
</svg>
`,rS=`
<svg
  class="lucide lucide-rectangle-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="12" height="20" x="6" y="2" rx="2" />
</svg>
`,rT=`
<svg
  class="lucide lucide-recycle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
  <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" />
  <path d="m14 16-3 3 3 3" />
  <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
  <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
  <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
</svg>
`,rU=`
<svg
  class="lucide lucide-redo-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 14 5-5-5-5" />
  <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
</svg>
`,rV=`
<svg
  class="lucide lucide-redo-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="17" r="1" />
  <path d="M21 7v6h-6" />
  <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
</svg>
`,rW=`
<svg
  class="lucide lucide-redo"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 7v6h-6" />
  <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
</svg>
`,rX=`
<svg
  class="lucide lucide-refresh-ccw-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
  <path d="M16 16h5v5" />
  <circle cx="12" cy="12" r="1" />
</svg>
`,rY=`
<svg
  class="lucide lucide-refresh-ccw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
  <path d="M16 16h5v5" />
</svg>
`,rZ=`
<svg
  class="lucide lucide-refresh-cw-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 8L18.74 5.74A9.75 9.75 0 0 0 12 3C11 3 10.03 3.16 9.13 3.47" />
  <path d="M8 16H3v5" />
  <path d="M3 12C3 9.51 4 7.26 5.64 5.64" />
  <path d="m3 16 2.26 2.26A9.75 9.75 0 0 0 12 21c2.49 0 4.74-1 6.36-2.64" />
  <path d="M21 12c0 1-.16 1.97-.47 2.87" />
  <path d="M21 3v5h-5" />
  <path d="M22 22 2 2" />
</svg>
`,r$=`
<svg
  class="lucide lucide-refresh-cw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
  <path d="M8 16H3v5" />
</svg>
`,r_=`
<svg
  class="lucide lucide-refrigerator"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z" />
  <path d="M5 10h14" />
  <path d="M15 7v6" />
</svg>
`,r0=`
<svg
  class="lucide lucide-regex"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 3v10" />
  <path d="m12.67 5.5 8.66 5" />
  <path d="m12.67 10.5 8.66-5" />
  <path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" />
</svg>
`,r1=`
<svg
  class="lucide lucide-remove-formatting"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 7V4h16v3" />
  <path d="M5 20h6" />
  <path d="M13 4 8 20" />
  <path d="m15 15 5 5" />
  <path d="m20 15-5 5" />
</svg>
`,r2=`
<svg
  class="lucide lucide-repeat-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 2 4 4-4 4" />
  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
  <path d="m7 22-4-4 4-4" />
  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  <path d="M11 10h1v4" />
</svg>
`,r3=`
<svg
  class="lucide lucide-repeat-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 9 3-3 3 3" />
  <path d="M13 18H7a2 2 0 0 1-2-2V6" />
  <path d="m22 15-3 3-3-3" />
  <path d="M11 6h6a2 2 0 0 1 2 2v10" />
</svg>
`,r4=`
<svg
  class="lucide lucide-repeat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 2 4 4-4 4" />
  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
  <path d="m7 22-4-4 4-4" />
  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
</svg>
`,r5=`
<svg
  class="lucide lucide-replace-all"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
  <path d="M14 4a1 1 0 0 1 1-1" />
  <path d="M15 10a1 1 0 0 1-1-1" />
  <path d="M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
  <path d="M21 4a1 1 0 0 0-1-1" />
  <path d="M21 9a1 1 0 0 1-1 1" />
  <path d="m3 7 3 3 3-3" />
  <path d="M6 10V5a2 2 0 0 1 2-2h2" />
  <rect x="3" y="14" width="7" height="7" rx="1" />
</svg>
`,r6=`
<svg
  class="lucide lucide-replace"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 4a1 1 0 0 1 1-1" />
  <path d="M15 10a1 1 0 0 1-1-1" />
  <path d="M21 4a1 1 0 0 0-1-1" />
  <path d="M21 9a1 1 0 0 1-1 1" />
  <path d="m3 7 3 3 3-3" />
  <path d="M6 10V5a2 2 0 0 1 2-2h2" />
  <rect x="3" y="14" width="7" height="7" rx="1" />
</svg>
`,r7=`
<svg
  class="lucide lucide-reply-all"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 17-5-5 5-5" />
  <path d="M22 18v-2a4 4 0 0 0-4-4H7" />
  <path d="m7 17-5-5 5-5" />
</svg>
`,r8=`
<svg
  class="lucide lucide-reply"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  <path d="m9 17-5-5 5-5" />
</svg>
`,r9=`
<svg
  class="lucide lucide-rewind"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z" />
  <path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z" />
</svg>
`,sa=`
<svg
  class="lucide lucide-ribbon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 11.22C11 9.997 10 9 10 8a2 2 0 0 1 4 0c0 1-.998 2.002-2.01 3.22" />
  <path d="m12 18 2.57-3.5" />
  <path d="M6.243 9.016a7 7 0 0 1 11.507-.009" />
  <path d="M9.35 14.53 12 11.22" />
  <path d="M9.35 14.53C7.728 12.246 6 10.221 6 7a6 5 0 0 1 12 0c-.005 3.22-1.778 5.235-3.43 7.5l3.557 4.527a1 1 0 0 1-.203 1.43l-1.894 1.36a1 1 0 0 1-1.384-.215L12 18l-2.679 3.593a1 1 0 0 1-1.39.213l-1.865-1.353a1 1 0 0 1-.203-1.422z" />
</svg>
`,sb=`
<svg
  class="lucide lucide-rocket"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
</svg>
`,sc=`
<svg
  class="lucide lucide-roller-coaster"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 19V5" />
  <path d="M10 19V6.8" />
  <path d="M14 19v-7.8" />
  <path d="M18 5v4" />
  <path d="M18 19v-6" />
  <path d="M22 19V9" />
  <path d="M2 19V9a4 4 0 0 1 4-4c2 0 4 1.33 6 4s4 4 6 4a4 4 0 1 0-3-6.65" />
</svg>
`,sd=`
<svg
  class="lucide lucide-rocking-chair"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polyline points="3.5 2 6.5 12.5 18 12.5" />
  <line x1="9.5" x2="5.5" y1="12.5" y2="20" />
  <line x1="15" x2="18.5" y1="12.5" y2="20" />
  <path d="M2.75 18a13 13 0 0 0 18.5 0" />
</svg>
`,se=`
<svg
  class="lucide lucide-rose"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 10h-1a4 4 0 1 1 4-4v.534" />
  <path d="M17 6h1a4 4 0 0 1 1.42 7.74l-2.29.87a6 6 0 0 1-5.339-10.68l2.069-1.31" />
  <path d="M4.5 17c2.8-.5 4.4 0 5.5.8s1.8 2.2 2.3 3.7c-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2" />
  <path d="M9.77 12C4 15 2 22 2 22" />
  <circle cx="17" cy="8" r="2" />
</svg>
`,sf=`
<svg
  class="lucide lucide-rotate-3d"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2" />
  <path d="m15.194 13.707 3.814 1.86-1.86 3.814" />
  <path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4" />
</svg>
`,sg=`
<svg
  class="lucide lucide-rotate-ccw-key"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.5 9.5 1 1" />
  <path d="m15.5 8.5-4 4" />
  <path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
  <circle cx="10" cy="14" r="2" />
</svg>
`,sh=`
<svg
  class="lucide lucide-rotate-ccw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
</svg>
`,si=`
<svg
  class="lucide lucide-rotate-ccw-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 9V7a2 2 0 0 0-2-2h-6" />
  <path d="m15 2-3 3 3 3" />
  <path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
</svg>
`,sj=`
<svg
  class="lucide lucide-rotate-cw-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 5H6a2 2 0 0 0-2 2v3" />
  <path d="m9 8 3-3-3-3" />
  <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
</svg>
`,sk=`
<svg
  class="lucide lucide-rotate-cw"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
</svg>
`,sl=`
<svg
  class="lucide lucide-route-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="19" r="3" />
  <path d="M9 19h8.5c.4 0 .9-.1 1.3-.2" />
  <path d="M5.2 5.2A3.5 3.53 0 0 0 6.5 12H12" />
  <path d="m2 2 20 20" />
  <path d="M21 15.3a3.5 3.5 0 0 0-3.3-3.3" />
  <path d="M15 5h-4.3" />
  <circle cx="18" cy="5" r="3" />
</svg>
`,sm=`
<svg
  class="lucide lucide-route"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="19" r="3" />
  <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
  <circle cx="18" cy="5" r="3" />
</svg>
`,sn=`
<svg
  class="lucide lucide-router"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="8" x="2" y="14" rx="2" />
  <path d="M6.01 18H6" />
  <path d="M10.01 18H10" />
  <path d="M15 10v4" />
  <path d="M17.84 7.17a4 4 0 0 0-5.66 0" />
  <path d="M20.66 4.34a8 8 0 0 0-11.31 0" />
</svg>
`,so=`
<svg
  class="lucide lucide-rows-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 12h18" />
</svg>
`,sp=`
<svg
  class="lucide lucide-rows-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M21 9H3" />
  <path d="M21 15H3" />
</svg>
`,sq=`
<svg
  class="lucide lucide-rows-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M21 7.5H3" />
  <path d="M21 12H3" />
  <path d="M21 16.5H3" />
</svg>
`,sr=`
<svg
  class="lucide lucide-rss"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 11a9 9 0 0 1 9 9" />
  <path d="M4 4a16 16 0 0 1 16 16" />
  <circle cx="5" cy="19" r="1" />
</svg>
`,ss=`
<svg
  class="lucide lucide-ruler-dimension-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 15v-3.014" />
  <path d="M16 15v-3.014" />
  <path d="M20 6H4" />
  <path d="M20 8V4" />
  <path d="M4 8V4" />
  <path d="M8 15v-3.014" />
  <rect x="3" y="12" width="18" height="7" rx="1" />
</svg>
`,st=`
<svg
  class="lucide lucide-ruler"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
  <path d="m14.5 12.5 2-2" />
  <path d="m11.5 9.5 2-2" />
  <path d="m8.5 6.5 2-2" />
  <path d="m17.5 15.5 2-2" />
</svg>
`,su=`
<svg
  class="lucide lucide-russian-ruble"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 11h8a4 4 0 0 0 0-8H9v18" />
  <path d="M6 15h8" />
</svg>
`,sv=`
<svg
  class="lucide lucide-sailboat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v15" />
  <path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z" />
  <path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z" />
</svg>
`,sw=`
<svg
  class="lucide lucide-salad"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 21h10" />
  <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" />
  <path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" />
  <path d="m13 12 4-4" />
  <path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" />
</svg>
`,sx=`
<svg
  class="lucide lucide-sandwich"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2.37 11.223 8.372-6.777a2 2 0 0 1 2.516 0l8.371 6.777" />
  <path d="M21 15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5.25" />
  <path d="M3 15a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h9" />
  <path d="m6.67 15 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2" />
  <rect width="20" height="4" x="2" y="11" rx="1" />
</svg>
`,sy=`
<svg
  class="lucide lucide-satellite-dish"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 10a7.31 7.31 0 0 0 10 10Z" />
  <path d="m9 15 3-3" />
  <path d="M17 13a6 6 0 0 0-6-6" />
  <path d="M21 13A10 10 0 0 0 11 3" />
</svg>
`,sz=`
<svg
  class="lucide lucide-satellite"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13.5 6.5-3.148-3.148a1.205 1.205 0 0 0-1.704 0L6.352 5.648a1.205 1.205 0 0 0 0 1.704L9.5 10.5" />
  <path d="M16.5 7.5 19 5" />
  <path d="m17.5 10.5 3.148 3.148a1.205 1.205 0 0 1 0 1.704l-2.296 2.296a1.205 1.205 0 0 1-1.704 0L13.5 14.5" />
  <path d="M9 21a6 6 0 0 0-6-6" />
  <path d="M9.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l4.296-4.296a1.205 1.205 0 0 0 0-1.704l-2.296-2.296a1.205 1.205 0 0 0-1.704 0z" />
</svg>
`,sA=`
<svg
  class="lucide lucide-save-all"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v3a1 1 0 0 0 1 1h5" />
  <path d="M18 18v-6a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6" />
  <path d="M18 22H4a2 2 0 0 1-2-2V6" />
  <path d="M8 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9.172a2 2 0 0 1 1.414.586l2.828 2.828A2 2 0 0 1 22 6.828V16a2 2 0 0 1-2.01 2z" />
</svg>
`,sB=`
<svg
  class="lucide lucide-saudi-riyal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m20 19.5-5.5 1.2" />
  <path d="M14.5 4v11.22a1 1 0 0 0 1.242.97L20 15.2" />
  <path d="m2.978 19.351 5.549-1.363A2 2 0 0 0 10 16V2" />
  <path d="M20 10 4 13.5" />
</svg>
`,sC=`
<svg
  class="lucide lucide-save-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 13H8a1 1 0 0 0-1 1v7" />
  <path d="M14 8h1" />
  <path d="M17 21v-4" />
  <path d="m2 2 20 20" />
  <path d="M20.41 20.41A2 2 0 0 1 19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 .59-1.41" />
  <path d="M29.5 11.5s5 5 4 5" />
  <path d="M9 3h6.2a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V15" />
</svg>
`,sD=`
<svg
  class="lucide lucide-save"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
  <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
  <path d="M7 3v4a1 1 0 0 0 1 1h7" />
</svg>
`,sE=`
<svg
  class="lucide lucide-scale-3d"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 7v11a1 1 0 0 0 1 1h11" />
  <path d="M5.293 18.707 11 13" />
  <circle cx="19" cy="19" r="2" />
  <circle cx="5" cy="5" r="2" />
</svg>
`,sF=`
<svg
  class="lucide lucide-scale"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
  <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
  <path d="M7 21h10" />
  <path d="M12 3v18" />
  <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
</svg>
`,sG=`
<svg
  class="lucide lucide-scaling"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
  <path d="M14 15H9v-5" />
  <path d="M16 3h5v5" />
  <path d="M21 3 9 15" />
</svg>
`,sH=`
<svg
  class="lucide lucide-scan-barcode"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path d="M8 7v10" />
  <path d="M12 7v10" />
  <path d="M17 7v10" />
</svg>
`,sI=`
<svg
  class="lucide lucide-scan-eye"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <circle cx="12" cy="12" r="1" />
  <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
</svg>
`,sJ=`
<svg
  class="lucide lucide-scan-face"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
  <path d="M9 9h.01" />
  <path d="M15 9h.01" />
</svg>
`,sK=`
<svg
  class="lucide lucide-scan-heart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path d="M7.828 13.07A3 3 0 0 1 12 8.764a3 3 0 0 1 4.172 4.306l-3.447 3.62a1 1 0 0 1-1.449 0z" />
</svg>
`,sL=`
<svg
  class="lucide lucide-scan-qr-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 12v4a1 1 0 0 1-1 1h-4" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M17 8V7" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M7 17h.01" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <rect x="7" y="7" width="5" height="5" rx="1" />
</svg>
`,sM=`
<svg
  class="lucide lucide-scan-line"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path d="M7 12h10" />
</svg>
`,sN=`
<svg
  class="lucide lucide-scan-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <circle cx="12" cy="12" r="3" />
  <path d="m16 16-1.9-1.9" />
</svg>
`,sO=`
<svg
  class="lucide lucide-scan"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
</svg>
`,sP=`
<svg
  class="lucide lucide-scan-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path d="M7 8h8" />
  <path d="M7 12h10" />
  <path d="M7 16h6" />
</svg>
`,sQ=`
<svg
  class="lucide lucide-school"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
  <path d="M18 5v16" />
  <path d="m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6" />
  <path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11" />
  <path d="M6 5v16" />
  <circle cx="12" cy="9" r="2" />
</svg>
`,sR=`
<svg
  class="lucide lucide-scissors-line-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5.42 9.42 8 12" />
  <circle cx="4" cy="8" r="2" />
  <path d="m14 6-8.58 8.58" />
  <circle cx="4" cy="16" r="2" />
  <path d="M10.8 14.8 14 18" />
  <path d="M16 12h-2" />
  <path d="M22 12h-2" />
</svg>
`,sS=`
<svg
  class="lucide lucide-scissors"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="6" r="3" />
  <path d="M8.12 8.12 12 12" />
  <path d="M20 4 8.12 15.88" />
  <circle cx="6" cy="18" r="3" />
  <path d="M14.8 14.8 20 20" />
</svg>
`,sT=`
<svg
  class="lucide lucide-screen-share-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" />
  <path d="M8 21h8" />
  <path d="M12 17v4" />
  <path d="m22 3-5 5" />
  <path d="m17 3 5 5" />
</svg>
`,sU=`
<svg
  class="lucide lucide-screen-share"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" />
  <path d="M8 21h8" />
  <path d="M12 17v4" />
  <path d="m17 8 5-5" />
  <path d="M17 3h5v5" />
</svg>
`,sV=`
<svg
  class="lucide lucide-scroll-text"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 12h-5" />
  <path d="M15 8h-5" />
  <path d="M19 17V5a2 2 0 0 0-2-2H4" />
  <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
</svg>
`,sW=`
<svg
  class="lucide lucide-scroll"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 17V5a2 2 0 0 0-2-2H4" />
  <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
</svg>
`,sX=`
<svg
  class="lucide lucide-search-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m8 11 2 2 4-4" />
  <circle cx="11" cy="11" r="8" />
  <path d="m21 21-4.3-4.3" />
</svg>
`,sY=`
<svg
  class="lucide lucide-search-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13 13.5 2-2.5-2-2.5" />
  <path d="m21 21-4.3-4.3" />
  <path d="M9 8.5 7 11l2 2.5" />
  <circle cx="11" cy="11" r="8" />
</svg>
`,sZ=`
<svg
  class="lucide lucide-search-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13.5 8.5-5 5" />
  <circle cx="11" cy="11" r="8" />
  <path d="m21 21-4.3-4.3" />
</svg>
`,s$=`
<svg
  class="lucide lucide-search-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m13.5 8.5-5 5" />
  <path d="m8.5 8.5 5 5" />
  <circle cx="11" cy="11" r="8" />
  <path d="m21 21-4.3-4.3" />
</svg>
`,s_=`
<svg
  class="lucide lucide-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21 21-4.34-4.34" />
  <circle cx="11" cy="11" r="8" />
</svg>
`,s0=`
<svg
  class="lucide lucide-section"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0" />
  <path d="M8 19a4 3 0 0 0 8 0c0-4-8-3-8-7a4 3 0 0 1 8 0" />
</svg>
`,s1=`
<svg
  class="lucide lucide-send-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" />
  <path d="M6 12h16" />
</svg>
`,s2=`
<svg
  class="lucide lucide-send-to-back"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="14" y="14" width="8" height="8" rx="2" />
  <rect x="2" y="2" width="8" height="8" rx="2" />
  <path d="M7 14v1a2 2 0 0 0 2 2h1" />
  <path d="M14 7h1a2 2 0 0 1 2 2v1" />
</svg>
`,s3=`
<svg
  class="lucide lucide-send"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
  <path d="m21.854 2.147-10.94 10.939" />
</svg>
`,s4=`
<svg
  class="lucide lucide-separator-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 16-4 4-4-4" />
  <path d="M3 12h18" />
  <path d="m8 8 4-4 4 4" />
</svg>
`,s5=`
<svg
  class="lucide lucide-separator-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v18" />
  <path d="m16 16 4-4-4-4" />
  <path d="m8 8-4 4 4 4" />
</svg>
`,s6=`
<svg
  class="lucide lucide-server-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10.852 14.772-.383.923" />
  <path d="M13.148 14.772a3 3 0 1 0-2.296-5.544l-.383-.923" />
  <path d="m13.148 9.228.383-.923" />
  <path d="m13.53 15.696-.382-.924a3 3 0 1 1-2.296-5.544" />
  <path d="m14.772 10.852.923-.383" />
  <path d="m14.772 13.148.923.383" />
  <path d="M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5" />
  <path d="M4.5 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5" />
  <path d="M6 18h.01" />
  <path d="M6 6h.01" />
  <path d="m9.228 10.852-.923-.383" />
  <path d="m9.228 13.148-.923.383" />
</svg>
`,s7=`
<svg
  class="lucide lucide-server-crash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
  <path d="M6 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2" />
  <path d="M6 6h.01" />
  <path d="M6 18h.01" />
  <path d="m13 6-4 6h6l-4 6" />
</svg>
`,s8=`
<svg
  class="lucide lucide-server-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5" />
  <path d="M10 10 2.5 2.5C2 2 2 2.5 2 5v3a2 2 0 0 0 2 2h6z" />
  <path d="M22 17v-1a2 2 0 0 0-2-2h-1" />
  <path d="M4 14a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16.5l1-.5.5.5-8-8H4z" />
  <path d="M6 18h.01" />
  <path d="m2 2 20 20" />
</svg>
`,s9=`
<svg
  class="lucide lucide-server"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
  <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
  <line x1="6" x2="6.01" y1="6" y2="6" />
  <line x1="6" x2="6.01" y1="18" y2="18" />
</svg>
`,ta=`
<svg
  class="lucide lucide-settings-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 17H5" />
  <path d="M19 7h-9" />
  <circle cx="17" cy="17" r="3" />
  <circle cx="7" cy="7" r="3" />
</svg>
`,tb=`
<svg
  class="lucide lucide-settings"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
  <circle cx="12" cy="12" r="3" />
</svg>
`,tc=`
<svg
  class="lucide lucide-shapes"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
  <rect x="3" y="14" width="7" height="7" rx="1" />
  <circle cx="17.5" cy="17.5" r="3.5" />
</svg>
`,td=`
<svg
  class="lucide lucide-share-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="18" cy="5" r="3" />
  <circle cx="6" cy="12" r="3" />
  <circle cx="18" cy="19" r="3" />
  <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
  <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
</svg>
`,te=`
<svg
  class="lucide lucide-share"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v13" />
  <path d="m16 6-4-4-4 4" />
  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
</svg>
`,tf=`
<svg
  class="lucide lucide-sheet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <line x1="3" x2="21" y1="9" y2="9" />
  <line x1="3" x2="21" y1="15" y2="15" />
  <line x1="9" x2="9" y1="9" y2="21" />
  <line x1="15" x2="15" y1="9" y2="21" />
</svg>
`,tg=`
<svg
  class="lucide lucide-shell"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44" />
</svg>
`,th=`
<svg
  class="lucide lucide-shield-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M12 8v4" />
  <path d="M12 16h.01" />
</svg>
`,ti=`
<svg
  class="lucide lucide-shield-ban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="m4.243 5.21 14.39 12.472" />
</svg>
`,tj=`
<svg
  class="lucide lucide-shield-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="m9 12 2 2 4-4" />
</svg>
`,tk=`
<svg
  class="lucide lucide-shield-ellipsis"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M8 12h.01" />
  <path d="M12 12h.01" />
  <path d="M16 12h.01" />
</svg>
`,tl=`
<svg
  class="lucide lucide-shield-half"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M12 22V2" />
</svg>
`,tm=`
<svg
  class="lucide lucide-shield-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M9 12h6" />
</svg>
`,tn=`
<svg
  class="lucide lucide-shield-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 2 20 20" />
  <path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71" />
  <path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264" />
</svg>
`,to=`
<svg
  class="lucide lucide-shield-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M9 12h6" />
  <path d="M12 9v6" />
</svg>
`,tp=`
<svg
  class="lucide lucide-shield-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M6.376 18.91a6 6 0 0 1 11.249.003" />
  <circle cx="12" cy="11" r="4" />
</svg>
`,tq=`
<svg
  class="lucide lucide-shield-question-mark"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
  <path d="M12 17h.01" />
</svg>
`,tr=`
<svg
  class="lucide lucide-shield-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="m14.5 9.5-5 5" />
  <path d="m9.5 9.5 5 5" />
</svg>
`,ts=`
<svg
  class="lucide lucide-shield"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
</svg>
`,tt=`
<svg
  class="lucide lucide-ship-wheel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="8" />
  <path d="M12 2v7.5" />
  <path d="m19 5-5.23 5.23" />
  <path d="M22 12h-7.5" />
  <path d="m19 19-5.23-5.23" />
  <path d="M12 14.5V22" />
  <path d="M10.23 13.77 5 19" />
  <path d="M9.5 12H2" />
  <path d="M10.23 10.23 5 5" />
  <circle cx="12" cy="12" r="2.5" />
</svg>
`,tu=`
<svg
  class="lucide lucide-shirt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
</svg>
`,tv=`
<svg
  class="lucide lucide-shopping-bag"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 10a4 4 0 0 1-8 0" />
  <path d="M3.103 6.034h17.794" />
  <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />
</svg>
`,tw=`
<svg
  class="lucide lucide-ship"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10.189V14" />
  <path d="M12 2v3" />
  <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
  <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76" />
  <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
</svg>
`,tx=`
<svg
  class="lucide lucide-shopping-basket"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 11-1 9" />
  <path d="m19 11-4-7" />
  <path d="M2 11h20" />
  <path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4" />
  <path d="M4.5 15.5h15" />
  <path d="m5 11 4-7" />
  <path d="m9 11 1 9" />
</svg>
`,ty=`
<svg
  class="lucide lucide-shovel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z" />
  <path d="M3 22a1 1 0 0 1-1-1v-3.586a1 1 0 0 1 .293-.707l3.355-3.355a1.205 1.205 0 0 1 1.704 0l3.296 3.296a1.205 1.205 0 0 1 0 1.704l-3.355 3.355a1 1 0 0 1-.707.293z" />
  <path d="m9 15 7.879-7.878" />
</svg>
`,tz=`
<svg
  class="lucide lucide-shopping-cart"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="8" cy="21" r="1" />
  <circle cx="19" cy="21" r="1" />
  <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
</svg>
`,tA=`
<svg
  class="lucide lucide-shower-head"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m4 4 2.5 2.5" />
  <path d="M13.5 6.5a4.95 4.95 0 0 0-7 7" />
  <path d="M15 5 5 15" />
  <path d="M14 17v.01" />
  <path d="M10 16v.01" />
  <path d="M13 13v.01" />
  <path d="M16 10v.01" />
  <path d="M11 20v.01" />
  <path d="M17 14v.01" />
  <path d="M20 11v.01" />
</svg>
`,tB=`
<svg
  class="lucide lucide-shredder"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 13V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 22v-5" />
  <path d="M14 19v-2" />
  <path d="M18 20v-3" />
  <path d="M2 13h20" />
  <path d="M6 20v-3" />
</svg>
`,tC=`
<svg
  class="lucide lucide-shrimp"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 12h.01" />
  <path d="M13 22c.5-.5 1.12-1 2.5-1-1.38 0-2-.5-2.5-1" />
  <path d="M14 2a3.28 3.28 0 0 1-3.227 1.798l-6.17-.561A2.387 2.387 0 1 0 4.387 8H15.5a1 1 0 0 1 0 13 1 1 0 0 0 0-5H12a7 7 0 0 1-7-7V8" />
  <path d="M14 8a8.5 8.5 0 0 1 0 8" />
  <path d="M16 16c2 0 4.5-4 4-6" />
</svg>
`,tD=`
<svg
  class="lucide lucide-shrink"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8" />
  <path d="M9 19.8V15m0 0H4.2M9 15l-6 6" />
  <path d="M15 4.2V9m0 0h4.8M15 9l6-6" />
  <path d="M9 4.2V9m0 0H4.2M9 9 3 3" />
</svg>
`,tE=`
<svg
  class="lucide lucide-shrub"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-5.172a2 2 0 0 0-.586-1.414L9.5 13.5" />
  <path d="M14.5 14.5 12 17" />
  <path d="M17 8.8A6 6 0 0 1 13.8 20H10A6.5 6.5 0 0 1 7 8a5 5 0 0 1 10 0z" />
</svg>
`,tF=`
<svg
  class="lucide lucide-shuffle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 14 4 4-4 4" />
  <path d="m18 2 4 4-4 4" />
  <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22" />
  <path d="M2 6h1.972a4 4 0 0 1 3.6 2.2" />
  <path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45" />
</svg>
`,tG=`
<svg
  class="lucide lucide-sigma"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" />
</svg>
`,tH=`
<svg
  class="lucide lucide-signal-high"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h.01" />
  <path d="M7 20v-4" />
  <path d="M12 20v-8" />
  <path d="M17 20V8" />
</svg>
`,tI=`
<svg
  class="lucide lucide-signal-low"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h.01" />
  <path d="M7 20v-4" />
</svg>
`,tJ=`
<svg
  class="lucide lucide-signal-medium"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h.01" />
  <path d="M7 20v-4" />
  <path d="M12 20v-8" />
</svg>
`,tK=`
<svg
  class="lucide lucide-signal-zero"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h.01" />
</svg>
`,tL=`
<svg
  class="lucide lucide-signal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 20h.01" />
  <path d="M7 20v-4" />
  <path d="M12 20v-8" />
  <path d="M17 20V8" />
  <path d="M22 4v16" />
</svg>
`,tM=`
<svg
  class="lucide lucide-signature"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284" />
  <path d="M3 21h18" />
</svg>
`,tN=`
<svg
  class="lucide lucide-signpost-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9H4L2 7l2-2h6" />
  <path d="M14 5h6l2 2-2 2h-6" />
  <path d="M10 22V4a2 2 0 1 1 4 0v18" />
  <path d="M8 22h8" />
</svg>
`,tO=`
<svg
  class="lucide lucide-signpost"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v8" />
  <path d="M12 3v3" />
  <path d="M18 6a2 2 0 0 1 1.387.56l2.307 2.22a1 1 0 0 1 0 1.44l-2.307 2.22A2 2 0 0 1 18 13H6a2 2 0 0 1-1.387-.56l-2.306-2.22a1 1 0 0 1 0-1.44l2.306-2.22A2 2 0 0 1 6 6z" />
</svg>
`,tP=`
<svg
  class="lucide lucide-siren"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 18v-6a5 5 0 1 1 10 0v6" />
  <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" />
  <path d="M21 12h1" />
  <path d="M18.5 4.5 18 5" />
  <path d="M2 12h1" />
  <path d="M12 2v1" />
  <path d="m4.929 4.929.707.707" />
  <path d="M12 12v6" />
</svg>
`,tQ=`
<svg
  class="lucide lucide-skip-back"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" />
  <path d="M3 20V4" />
</svg>
`,tR=`
<svg
  class="lucide lucide-skip-forward"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 4v16" />
  <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />
</svg>
`,tS=`
<svg
  class="lucide lucide-skull"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12.5 17-.5-1-.5 1h1z" />
  <path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z" />
  <circle cx="15" cy="12" r="1" />
  <circle cx="9" cy="12" r="1" />
</svg>
`,tT=`
<svg
  class="lucide lucide-slack"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="3" height="8" x="13" y="2" rx="1.5" />
  <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" />
  <rect width="3" height="8" x="8" y="14" rx="1.5" />
  <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" />
  <rect width="8" height="3" x="14" y="13" rx="1.5" />
  <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" />
  <rect width="8" height="3" x="2" y="8" rx="1.5" />
  <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" />
</svg>
`,tU=`
<svg
  class="lucide lucide-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 2 2 22" />
</svg>
`,tV=`
<svg
  class="lucide lucide-sliders-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 5H3" />
  <path d="M12 19H3" />
  <path d="M14 3v4" />
  <path d="M16 17v4" />
  <path d="M21 12h-9" />
  <path d="M21 19h-5" />
  <path d="M21 5h-7" />
  <path d="M8 10v4" />
  <path d="M8 12H3" />
</svg>
`,tW=`
<svg
  class="lucide lucide-slice"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 16.586V19a1 1 0 0 1-1 1H2L18.37 3.63a1 1 0 1 1 3 3l-9.663 9.663a1 1 0 0 1-1.414 0L8 14" />
</svg>
`,tX=`
<svg
  class="lucide lucide-sliders-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 8h4" />
  <path d="M12 21v-9" />
  <path d="M12 8V3" />
  <path d="M17 16h4" />
  <path d="M19 12V3" />
  <path d="M19 21v-5" />
  <path d="M3 14h4" />
  <path d="M5 10V3" />
  <path d="M5 21v-7" />
</svg>
`,tY=`
<svg
  class="lucide lucide-smartphone-charging"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
  <path d="M12.667 8 10 12h4l-2.667 4" />
</svg>
`,tZ=`
<svg
  class="lucide lucide-smartphone-nfc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="7" height="12" x="2" y="6" rx="1" />
  <path d="M13 8.32a7.43 7.43 0 0 1 0 7.36" />
  <path d="M16.46 6.21a11.76 11.76 0 0 1 0 11.58" />
  <path d="M19.91 4.1a15.91 15.91 0 0 1 .01 15.8" />
</svg>
`,t$=`
<svg
  class="lucide lucide-smartphone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
  <path d="M12 18h.01" />
</svg>
`,t_=`
<svg
  class="lucide lucide-smile-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 11v1a10 10 0 1 1-9-10" />
  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
  <line x1="9" x2="9.01" y1="9" y2="9" />
  <line x1="15" x2="15.01" y1="9" y2="9" />
  <path d="M16 5h6" />
  <path d="M19 2v6" />
</svg>
`,t0=`
<svg
  class="lucide lucide-snail"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0" />
  <circle cx="10" cy="13" r="8" />
  <path d="M2 21h12c4.4 0 8-3.6 8-8V7a2 2 0 1 0-4 0v6" />
  <path d="M18 3 19.1 5.2" />
  <path d="M22 3 20.9 5.2" />
</svg>
`,t1=`
<svg
  class="lucide lucide-smile"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
  <line x1="9" x2="9.01" y1="9" y2="9" />
  <line x1="15" x2="15.01" y1="9" y2="9" />
</svg>
`,t2=`
<svg
  class="lucide lucide-snowflake"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 20-1.25-2.5L6 18" />
  <path d="M10 4 8.75 6.5 6 6" />
  <path d="m14 20 1.25-2.5L18 18" />
  <path d="m14 4 1.25 2.5L18 6" />
  <path d="m17 21-3-6h-4" />
  <path d="m17 3-3 6 1.5 3" />
  <path d="M2 12h6.5L10 9" />
  <path d="m20 10-1.5 2 1.5 2" />
  <path d="M22 12h-6.5L14 15" />
  <path d="m4 10 1.5 2L4 14" />
  <path d="m7 21 3-6-1.5-3" />
  <path d="m7 3 3 6h4" />
</svg>
`,t3=`
<svg
  class="lucide lucide-soap-dispenser-droplet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 2v4" />
  <path d="M14 2H7a2 2 0 0 0-2 2" />
  <path d="M19.29 14.76A6.67 6.67 0 0 1 17 11a6.6 6.6 0 0 1-2.29 3.76c-1.15.92-1.71 2.04-1.71 3.19 0 2.22 1.8 4.05 4 4.05s4-1.83 4-4.05c0-1.16-.57-2.26-1.71-3.19" />
  <path d="M9.607 21H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h7V7a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
</svg>
`,t4=`
<svg
  class="lucide lucide-sofa"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3" />
  <path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z" />
  <path d="M4 18v2" />
  <path d="M20 18v2" />
  <path d="M12 4v9" />
</svg>
`,t5=`
<svg
  class="lucide lucide-solar-panel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 2h2" />
  <path d="m14.28 14-4.56 8" />
  <path d="m21 22-1.558-4H4.558" />
  <path d="M3 10v2" />
  <path d="M6.245 15.04A2 2 0 0 1 8 14h12a1 1 0 0 1 .864 1.505l-3.11 5.457A2 2 0 0 1 16 22H4a1 1 0 0 1-.863-1.506z" />
  <path d="M7 2a4 4 0 0 1-4 4" />
  <path d="m8.66 7.66 1.41 1.41" />
</svg>
`,t6=`
<svg
  class="lucide lucide-soup"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" />
  <path d="M7 21h10" />
  <path d="M19.5 12 22 6" />
  <path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62" />
  <path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62" />
  <path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62" />
</svg>
`,t7=`
<svg
  class="lucide lucide-space"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
</svg>
`,t8=`
<svg
  class="lucide lucide-spade"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18v4" />
  <path d="M2 14.499a5.5 5.5 0 0 0 9.591 3.675.6.6 0 0 1 .818.001A5.5 5.5 0 0 0 22 14.5c0-2.29-1.5-4-3-5.5l-5.492-5.312a2 2 0 0 0-3-.02L5 8.999c-1.5 1.5-3 3.2-3 5.5" />
</svg>
`,t9=`
<svg
  class="lucide lucide-sparkle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
</svg>
`,ua=`
<svg
  class="lucide lucide-sparkles"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
  <path d="M20 2v4" />
  <path d="M22 4h-4" />
  <circle cx="4" cy="20" r="2" />
</svg>
`,ub=`
<svg
  class="lucide lucide-speaker"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="20" x="4" y="2" rx="2" />
  <path d="M12 6h.01" />
  <circle cx="12" cy="14" r="4" />
  <path d="M12 14h.01" />
</svg>
`,uc=`
<svg
  class="lucide lucide-speech"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20" />
  <path d="M19.8 17.8a7.5 7.5 0 0 0 .003-10.603" />
  <path d="M17 15a3.5 3.5 0 0 0-.025-4.975" />
</svg>
`,ud=`
<svg
  class="lucide lucide-spell-check-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 16 6-12 6 12" />
  <path d="M8 12h8" />
  <path d="M4 21c1.1 0 1.1-1 2.3-1s1.1 1 2.3 1c1.1 0 1.1-1 2.3-1 1.1 0 1.1 1 2.3 1 1.1 0 1.1-1 2.3-1 1.1 0 1.1 1 2.3 1 1.1 0 1.1-1 2.3-1" />
</svg>
`,ue=`
<svg
  class="lucide lucide-spline-pointer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
  <path d="M5 17A12 12 0 0 1 17 5" />
  <circle cx="19" cy="5" r="2" />
  <circle cx="5" cy="19" r="2" />
</svg>`,uf=`
<svg
  class="lucide lucide-spell-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m6 16 6-12 6 12" />
  <path d="M8 12h8" />
  <path d="m16 20 2 2 4-4" />
</svg>
`,ug=`
<svg
  class="lucide lucide-split"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 3h5v5" />
  <path d="M8 3H3v5" />
  <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
  <path d="m15 9 6-6" />
</svg>
`,uh=`
<svg
  class="lucide lucide-spline"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="19" cy="5" r="2" />
  <circle cx="5" cy="19" r="2" />
  <path d="M5 17A12 12 0 0 1 17 5" />
</svg>
`,ui=`
<svg
  class="lucide lucide-spool"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 13.44 4.442 17.082A2 2 0 0 0 4.982 21H19a2 2 0 0 0 .558-3.921l-1.115-.32A2 2 0 0 1 17 14.837V7.66" />
  <path d="m7 10.56 12.558-3.642A2 2 0 0 0 19.018 3H5a2 2 0 0 0-.558 3.921l1.115.32A2 2 0 0 1 7 9.163v7.178" />
</svg>
`,uj=`
<svg
  class="lucide lucide-spotlight"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.295 19.562 16 22" />
  <path d="m17 16 3.758 2.098" />
  <path d="m19 12.5 3.026-.598" />
  <path d="M7.61 6.3a3 3 0 0 0-3.92 1.3l-1.38 2.79a3 3 0 0 0 1.3 3.91l6.89 3.597a1 1 0 0 0 1.342-.447l3.106-6.211a1 1 0 0 0-.447-1.341z" />
  <path d="M8 9V2" />
</svg>
`,uk=`
<svg
  class="lucide lucide-spray-can"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 3h.01" />
  <path d="M7 5h.01" />
  <path d="M11 7h.01" />
  <path d="M3 7h.01" />
  <path d="M7 9h.01" />
  <path d="M3 11h.01" />
  <rect width="4" height="4" x="15" y="5" />
  <path d="m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2" />
  <path d="m13 14 8-2" />
  <path d="m13 19 8-2" />
</svg>
`,ul=`
<svg
  class="lucide lucide-sprout"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3" />
  <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4" />
  <path d="M5 21h14" />
</svg>
`,um=`
<svg
  class="lucide lucide-square-activity"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M17 12h-2l-2 5-2-10-2 5H7" />
</svg>
`,un=`
<svg
  class="lucide lucide-square-arrow-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m16 8-8 8" />
  <path d="M16 16H8V8" />
</svg>
`,uo=`
<svg
  class="lucide lucide-square-arrow-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m8 8 8 8" />
  <path d="M16 8v8H8" />
</svg>
`,up=`
<svg
  class="lucide lucide-square-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M12 8v8" />
  <path d="m8 12 4 4 4-4" />
</svg>
`,uq=`
<svg
  class="lucide lucide-square-arrow-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m12 8-4 4 4 4" />
  <path d="M16 12H8" />
</svg>
`,ur=`
<svg
  class="lucide lucide-square-arrow-out-down-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 21h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6" />
  <path d="m3 21 9-9" />
  <path d="M9 21H3v-6" />
</svg>
`,us=`
<svg
  class="lucide lucide-square-arrow-out-down-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  <path d="m21 21-9-9" />
  <path d="M21 15v6h-6" />
</svg>
`,ut=`
<svg
  class="lucide lucide-square-arrow-out-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6" />
  <path d="m3 3 9 9" />
  <path d="M3 9V3h6" />
</svg>
`,uu=`
<svg
  class="lucide lucide-square-arrow-out-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
  <path d="m21 3-9 9" />
  <path d="M15 3h6v6" />
</svg>
`,uv=`
<svg
  class="lucide lucide-square-arrow-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 12h8" />
  <path d="m12 16 4-4-4-4" />
</svg>
`,uw=`
<svg
  class="lucide lucide-square-arrow-up-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 16V8h8" />
  <path d="M16 16 8 8" />
</svg>
`,ux=`
<svg
  class="lucide lucide-square-arrow-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m16 12-4-4-4 4" />
  <path d="M12 16V8" />
</svg>
`,uy=`
<svg
  class="lucide lucide-square-arrow-up-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 8h8v8" />
  <path d="m8 16 8-8" />
</svg>
`,uz=`
<svg
  class="lucide lucide-square-asterisk"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M12 8v8" />
  <path d="m8.5 14 7-4" />
  <path d="m8.5 10 7 4" />
</svg>
`,uA=`
<svg
  class="lucide lucide-square-bottom-dashed-scissors"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2" />
  <path d="M10 22H8" />
  <path d="M16 22h-2" />
  <circle cx="8" cy="8" r="2" />
  <path d="M9.414 9.414 12 12" />
  <path d="M14.8 14.8 18 18" />
  <circle cx="8" cy="16" r="2" />
  <path d="m18 6-8.586 8.586" />
</svg>
`,uB=`
<svg
  class="lucide lucide-square-check-big"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344" />
  <path d="m9 11 3 3L22 4" />
</svg>
`,uC=`
<svg
  class="lucide lucide-square-chart-gantt"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 8h7" />
  <path d="M8 12h6" />
  <path d="M11 16h5" />
</svg>
`,uD=`
<svg
  class="lucide lucide-square-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m9 12 2 2 4-4" />
</svg>
`,uE=`
<svg
  class="lucide lucide-square-chevron-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m16 10-4 4-4-4" />
</svg>
`,uF=`
<svg
  class="lucide lucide-square-chevron-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m14 16-4-4 4-4" />
</svg>
`,uG=`
<svg
  class="lucide lucide-square-chevron-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m10 8 4 4-4 4" />
</svg>
`,uH=`
<svg
  class="lucide lucide-square-chevron-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m8 14 4-4 4 4" />
</svg>
`,uI=`
<svg
  class="lucide lucide-square-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 9-3 3 3 3" />
  <path d="m14 15 3-3-3-3" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,uJ=`
<svg
  class="lucide lucide-square-dashed-bottom-code"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 9.5 8 12l2 2.5" />
  <path d="M14 21h1" />
  <path d="m14 9.5 2 2.5-2 2.5" />
  <path d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2" />
  <path d="M9 21h1" />
</svg>
`,uK=`
<svg
  class="lucide lucide-square-dashed-bottom"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2" />
  <path d="M9 21h1" />
  <path d="M14 21h1" />
</svg>
`,uL=`
<svg
  class="lucide lucide-square-dashed-kanban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 7v7" />
  <path d="M12 7v4" />
  <path d="M16 7v9" />
  <path d="M5 3a2 2 0 0 0-2 2" />
  <path d="M9 3h1" />
  <path d="M14 3h1" />
  <path d="M19 3a2 2 0 0 1 2 2" />
  <path d="M21 9v1" />
  <path d="M21 14v1" />
  <path d="M21 19a2 2 0 0 1-2 2" />
  <path d="M14 21h1" />
  <path d="M9 21h1" />
  <path d="M5 21a2 2 0 0 1-2-2" />
  <path d="M3 14v1" />
  <path d="M3 9v1" />
</svg>
`,uM=`
<svg
  class="lucide lucide-square-dashed-mouse-pointer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
  <path d="M5 3a2 2 0 0 0-2 2" />
  <path d="M19 3a2 2 0 0 1 2 2" />
  <path d="M5 21a2 2 0 0 1-2-2" />
  <path d="M9 3h1" />
  <path d="M9 21h2" />
  <path d="M14 3h1" />
  <path d="M3 9v1" />
  <path d="M21 9v2" />
  <path d="M3 14v1" />
</svg>
`,uN=`
<svg
  class="lucide lucide-square-dashed-top-solid"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 21h1" />
  <path d="M21 14v1" />
  <path d="M21 19a2 2 0 0 1-2 2" />
  <path d="M21 9v1" />
  <path d="M3 14v1" />
  <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2" />
  <path d="M3 9v1" />
  <path d="M5 21a2 2 0 0 1-2-2" />
  <path d="M9 21h1" />
</svg>
`,uO=`
<svg
  class="lucide lucide-square-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 3a2 2 0 0 0-2 2" />
  <path d="M19 3a2 2 0 0 1 2 2" />
  <path d="M21 19a2 2 0 0 1-2 2" />
  <path d="M5 21a2 2 0 0 1-2-2" />
  <path d="M9 3h1" />
  <path d="M9 21h1" />
  <path d="M14 3h1" />
  <path d="M14 21h1" />
  <path d="M3 9v1" />
  <path d="M21 9v1" />
  <path d="M3 14v1" />
  <path d="M21 14v1" />
</svg>
`,uP=`
<svg
  class="lucide lucide-square-divide"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <line x1="8" x2="16" y1="12" y2="12" />
  <line x1="12" x2="12" y1="16" y2="16" />
  <line x1="12" x2="12" y1="8" y2="8" />
</svg>
`,uQ=`
<svg
  class="lucide lucide-square-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <circle cx="12" cy="12" r="1" />
</svg>
`,uR=`
<svg
  class="lucide lucide-square-equal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 10h10" />
  <path d="M7 14h10" />
</svg>
`,uS=`
<svg
  class="lucide lucide-square-function"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" />
  <path d="M9 11.2h5.7" />
</svg>
`,uT=`
<svg
  class="lucide lucide-square-kanban"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 7v7" />
  <path d="M12 7v4" />
  <path d="M16 7v9" />
</svg>
`,uU=`
<svg
  class="lucide lucide-square-library"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 7v10" />
  <path d="M11 7v10" />
  <path d="m15 7 2 10" />
</svg>
`,uV=`
<svg
  class="lucide lucide-square-m"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 16V8.5a.5.5 0 0 1 .9-.3l2.7 3.599a.5.5 0 0 0 .8 0l2.7-3.6a.5.5 0 0 1 .9.3V16" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,uW=`
<svg
  class="lucide lucide-square-menu"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 8h10" />
  <path d="M7 12h10" />
  <path d="M7 16h10" />
</svg>
`,uX=`
<svg
  class="lucide lucide-square-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 12h8" />
</svg>
`,uY=`
<svg
  class="lucide lucide-square-mouse-pointer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
  <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
</svg>
`,uZ=`
<svg
  class="lucide lucide-square-parking-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.6 3.6A2 2 0 0 1 5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-.59 1.41" />
  <path d="M3 8.7V19a2 2 0 0 0 2 2h10.3" />
  <path d="m2 2 20 20" />
  <path d="M13 13a3 3 0 1 0 0-6H9v2" />
  <path d="M9 17v-2.3" />
</svg>
`,u$=`
<svg
  class="lucide lucide-square-parking"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
</svg>
`,u_=`
<svg
  class="lucide lucide-square-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
  <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
</svg>
`,u0=`
<svg
  class="lucide lucide-square-pause"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <line x1="10" x2="10" y1="15" y2="9" />
  <line x1="14" x2="14" y1="15" y2="9" />
</svg>
`,u1=`
<svg
  class="lucide lucide-square-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="m15 9-6 6" />
  <path d="M9 9h.01" />
  <path d="M15 15h.01" />
</svg>
`,u2=`
<svg
  class="lucide lucide-square-pi"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M7 7h10" />
  <path d="M10 7v10" />
  <path d="M16 17a2 2 0 0 1-2-2V7" />
</svg>
`,u3=`
<svg
  class="lucide lucide-square-pilcrow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M12 12H9.5a2.5 2.5 0 0 1 0-5H17" />
  <path d="M12 7v10" />
  <path d="M16 7v10" />
</svg>
`,u4=`
<svg
  class="lucide lucide-square-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" />
</svg>
`,u5=`
<svg
  class="lucide lucide-square-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M8 12h8" />
  <path d="M12 8v8" />
</svg>
`,u6=`
<svg
  class="lucide lucide-square-power"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 7v4" />
  <path d="M7.998 9.003a5 5 0 1 0 8-.005" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,u7=`
<svg
  class="lucide lucide-square-radical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 12h2l2 5 2-10h4" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,u8=`
<svg
  class="lucide lucide-square-round-corner"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 11a8 8 0 0 0-8-8" />
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
</svg>
`,u9=`
<svg
  class="lucide lucide-square-scissors"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="20" x="2" y="2" rx="2" />
  <circle cx="8" cy="8" r="2" />
  <path d="M9.414 9.414 12 12" />
  <path d="M14.8 14.8 18 18" />
  <circle cx="8" cy="16" r="2" />
  <path d="m18 6-8.586 8.586" />
</svg>
`,va=`
<svg
  class="lucide lucide-square-sigma"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M16 8.9V7H8l4 5-4 5h8v-1.9" />
</svg>
`,vb=`
<svg
  class="lucide lucide-square-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <line x1="9" x2="15" y1="15" y2="9" />
</svg>
`,vc=`
<svg
  class="lucide lucide-square-split-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3" />
  <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3" />
  <line x1="12" x2="12" y1="4" y2="20" />
</svg>
`,vd=`
<svg
  class="lucide lucide-square-split-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3" />
  <path d="M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3" />
  <line x1="4" x2="20" y1="12" y2="12" />
</svg>
`,ve=`
<svg
  class="lucide lucide-square-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <rect x="8" y="8" width="8" height="8" rx="1" />
</svg>
`,vf=`
<svg
  class="lucide lucide-square-stack"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" />
  <path d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" />
  <rect width="8" height="8" x="14" y="14" rx="2" />
</svg>
`,vg=`
<svg
  class="lucide lucide-square-star"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.035 7.69a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.866l-1.156-1.153a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z" />
  <rect x="3" y="3" width="18" height="18" rx="2" />
</svg>
`,vh=`
<svg
  class="lucide lucide-square-stop"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <rect x="9" y="9" width="6" height="6" rx="1" />
</svg>
`,vi=`
<svg
  class="lucide lucide-square-user-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 21a6 6 0 0 0-12 0" />
  <circle cx="12" cy="11" r="4" />
  <rect width="18" height="18" x="3" y="3" rx="2" />
</svg>
`,vj=`
<svg
  class="lucide lucide-square-terminal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m7 11 2-2-2-2" />
  <path d="M11 13h4" />
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
</svg>
`,vk=`
<svg
  class="lucide lucide-square-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <circle cx="12" cy="10" r="3" />
  <path d="M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
</svg>
`,vl=`
<svg
  class="lucide lucide-square-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <path d="m15 9-6 6" />
  <path d="m9 9 6 6" />
</svg>
`,vm=`
<svg
  class="lucide lucide-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
</svg>
`,vn=`
<svg
  class="lucide lucide-squares-exclude"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 12v2a2 2 0 0 1-2 2H9a1 1 0 0 0-1 1v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h0" />
  <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 1-1 1h-5a2 2 0 0 0-2 2v2" />
</svg>`,vo=`
<svg
  class="lucide lucide-squares-intersect"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 22a2 2 0 0 1-2-2" />
  <path d="M14 2a2 2 0 0 1 2 2" />
  <path d="M16 22h-2" />
  <path d="M2 10V8" />
  <path d="M2 4a2 2 0 0 1 2-2" />
  <path d="M20 8a2 2 0 0 1 2 2" />
  <path d="M22 14v2" />
  <path d="M22 20a2 2 0 0 1-2 2" />
  <path d="M4 16a2 2 0 0 1-2-2" />
  <path d="M8 10a2 2 0 0 1 2-2h5a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H9a1 1 0 0 1-1-1z" />
  <path d="M8 2h2" />
</svg>`,vp=`
<svg
  class="lucide lucide-squares-subtract"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 22a2 2 0 0 1-2-2" />
  <path d="M16 22h-2" />
  <path d="M16 4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-5a2 2 0 0 1 2-2h5a1 1 0 0 0 1-1z" />
  <path d="M20 8a2 2 0 0 1 2 2" />
  <path d="M22 14v2" />
  <path d="M22 20a2 2 0 0 1-2 2" />
</svg>`,vq=`
<svg
  class="lucide lucide-squares-unite"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 0 1 1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-3a1 1 0 0 0-1-1z" />
</svg>`,vr=`
<svg
  class="lucide lucide-squircle-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.77 3.043a34 34 0 0 0-3.54 0" />
  <path d="M13.771 20.956a33 33 0 0 1-3.541.001" />
  <path d="M20.18 17.74c-.51 1.15-1.29 1.93-2.439 2.44" />
  <path d="M20.18 6.259c-.51-1.148-1.291-1.929-2.44-2.438" />
  <path d="M20.957 10.23a33 33 0 0 1 0 3.54" />
  <path d="M3.043 10.23a34 34 0 0 0 .001 3.541" />
  <path d="M6.26 20.179c-1.15-.508-1.93-1.29-2.44-2.438" />
  <path d="M6.26 3.82c-1.149.51-1.93 1.291-2.44 2.44" />
</svg>
`,vs=`
<svg
  class="lucide lucide-squircle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
</svg>
`,vt=`
<svg
  class="lucide lucide-squirrel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.236 22a3 3 0 0 0-2.2-5" />
  <path d="M16 20a3 3 0 0 1 3-3h1a2 2 0 0 0 2-2v-2a4 4 0 0 0-4-4V4" />
  <path d="M18 13h.01" />
  <path d="M18 6a4 4 0 0 0-4 4 7 7 0 0 0-7 7c0-5 4-5 4-10.5a4.5 4.5 0 1 0-9 0 2.5 2.5 0 0 0 5 0C7 10 3 11 3 17c0 2.8 2.2 5 5 5h10" />
</svg>
`,vu=`
<svg
  class="lucide lucide-stamp"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" />
  <path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z" />
  <path d="M5 22h14" />
</svg>
`,vv=`
<svg
  class="lucide lucide-star-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43" />
  <path d="M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,vw=`
<svg
  class="lucide lucide-star-half"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 18.338a2.1 2.1 0 0 0-.987.244L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16l2.309-4.679A.53.53 0 0 1 12 2" />
</svg>
`,vx=`
<svg
  class="lucide lucide-star"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
</svg>
`,vy=`
<svg
  class="lucide lucide-step-back"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.971 4.285A2 2 0 0 1 17 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" />
  <path d="M21 20V4" />
</svg>
`,vz=`
<svg
  class="lucide lucide-stethoscope"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 2v2" />
  <path d="M5 2v2" />
  <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
  <path d="M8 15a6 6 0 0 0 12 0v-3" />
  <circle cx="20" cy="10" r="2" />
</svg>
`,vA=`
<svg
  class="lucide lucide-sticker"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
  <path d="M15 3v5a1 1 0 0 0 1 1h5" />
  <path d="M8 13h.01" />
  <path d="M16 13h.01" />
  <path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1" />
</svg>
`,vB=`
<svg
  class="lucide lucide-step-forward"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.029 4.285A2 2 0 0 0 7 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />
  <path d="M3 4v16" />
</svg>
`,vC=`
<svg
  class="lucide lucide-sticky-note"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
  <path d="M15 3v5a1 1 0 0 0 1 1h5" />
</svg>
`,vD=`
<svg
  class="lucide lucide-store"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
  <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
  <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
</svg>
`,vE=`
<svg
  class="lucide lucide-stretch-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="6" height="20" x="4" y="2" rx="2" />
  <rect width="6" height="20" x="14" y="2" rx="2" />
</svg>
`,vF=`
<svg
  class="lucide lucide-stretch-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="6" x="2" y="4" rx="2" />
  <rect width="20" height="6" x="2" y="14" rx="2" />
</svg>
`,vG=`
<svg
  class="lucide lucide-strikethrough"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 4H9a3 3 0 0 0-2.83 4" />
  <path d="M14 12a4 4 0 0 1 0 8H6" />
  <line x1="4" x2="20" y1="12" y2="12" />
</svg>
`,vH=`
<svg
  class="lucide lucide-subscript"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m4 5 8 8" />
  <path d="m12 5-8 8" />
  <path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07" />
</svg>
`,vI=`
<svg
  class="lucide lucide-sun-medium"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 3v1" />
  <path d="M12 20v1" />
  <path d="M3 12h1" />
  <path d="M20 12h1" />
  <path d="m18.364 5.636-.707.707" />
  <path d="m6.343 17.657-.707.707" />
  <path d="m5.636 5.636.707.707" />
  <path d="m17.657 17.657.707.707" />
</svg>
`,vJ=`
<svg
  class="lucide lucide-sun-moon"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v2" />
  <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" />
  <path d="M16 12a4 4 0 0 0-4-4" />
  <path d="m19 5-1.256 1.256" />
  <path d="M20 12h2" />
</svg>
`,vK=`
<svg
  class="lucide lucide-sun-dim"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 4h.01" />
  <path d="M20 12h.01" />
  <path d="M12 20h.01" />
  <path d="M4 12h.01" />
  <path d="M17.657 6.343h.01" />
  <path d="M17.657 17.657h.01" />
  <path d="M6.343 17.657h.01" />
  <path d="M6.343 6.343h.01" />
</svg>
`,vL=`
<svg
  class="lucide lucide-sun-snow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 21v-1" />
  <path d="M10 4V3" />
  <path d="M10 9a3 3 0 0 0 0 6" />
  <path d="m14 20 1.25-2.5L18 18" />
  <path d="m14 4 1.25 2.5L18 6" />
  <path d="m17 21-3-6 1.5-3H22" />
  <path d="m17 3-3 6 1.5 3" />
  <path d="M2 12h1" />
  <path d="m20 10-1.5 2 1.5 2" />
  <path d="m3.64 18.36.7-.7" />
  <path d="m4.34 6.34-.7-.7" />
</svg>
`,vM=`
<svg
  class="lucide lucide-sun"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2" />
  <path d="M12 20v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="m17.66 17.66 1.41 1.41" />
  <path d="M2 12h2" />
  <path d="M20 12h2" />
  <path d="m6.34 17.66-1.41 1.41" />
  <path d="m19.07 4.93-1.41 1.41" />
</svg>
`,vN=`
<svg
  class="lucide lucide-sunrise"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v8" />
  <path d="m4.93 10.93 1.41 1.41" />
  <path d="M2 18h2" />
  <path d="M20 18h2" />
  <path d="m19.07 10.93-1.41 1.41" />
  <path d="M22 22H2" />
  <path d="m8 6 4-4 4 4" />
  <path d="M16 18a4 4 0 0 0-8 0" />
</svg>
`,vO=`
<svg
  class="lucide lucide-sunset"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10V2" />
  <path d="m4.93 10.93 1.41 1.41" />
  <path d="M2 18h2" />
  <path d="M20 18h2" />
  <path d="m19.07 10.93-1.41 1.41" />
  <path d="M22 22H2" />
  <path d="m16 6-4 4-4-4" />
  <path d="M16 18a4 4 0 0 0-8 0" />
</svg>
`,vP=`
<svg
  class="lucide lucide-superscript"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m4 19 8-8" />
  <path d="m12 19-8-8" />
  <path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06" />
</svg>
`,vQ=`
<svg
  class="lucide lucide-swatch-book"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2Z" />
  <path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7" />
  <path d="M 7 17h.01" />
  <path d="m11 8 2.3-2.3a2.4 2.4 0 0 1 3.404.004L18.6 7.6a2.4 2.4 0 0 1 .026 3.434L9.9 19.8" />
</svg>
`,vR=`
<svg
  class="lucide lucide-swiss-franc"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 21V3h8" />
  <path d="M6 16h9" />
  <path d="M10 9.5h7" />
</svg>
`,vS=`
<svg
  class="lucide lucide-sword"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m11 19-6-6" />
  <path d="m5 21-2-2" />
  <path d="m8 16-4 4" />
  <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
</svg>
`,vT=`
<svg
  class="lucide lucide-switch-camera"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
  <circle cx="12" cy="12" r="3" />
  <path d="m18 22-3-3 3-3" />
  <path d="m6 2 3 3-3 3" />
</svg>
`,vU=`
<svg
  class="lucide lucide-swords"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
  <line x1="13" x2="19" y1="19" y2="13" />
  <line x1="16" x2="20" y1="16" y2="20" />
  <line x1="19" x2="21" y1="21" y2="19" />
  <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
  <line x1="5" x2="9" y1="14" y2="18" />
  <line x1="7" x2="4" y1="17" y2="20" />
  <line x1="3" x2="5" y1="19" y2="21" />
</svg>
`,vV=`
<svg
  class="lucide lucide-syringe"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 2 4 4" />
  <path d="m17 7 3-3" />
  <path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" />
  <path d="m9 11 4 4" />
  <path d="m5 19-3 3" />
  <path d="m14 4 6 6" />
</svg>
`,vW=`
<svg
  class="lucide lucide-table-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
</svg>
`,vX=`
<svg
  class="lucide lucide-table-cells-merge"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 21v-6" />
  <path d="M12 9V3" />
  <path d="M3 15h18" />
  <path d="M3 9h18" />
  <rect width="18" height="18" x="3" y="3" rx="2" />
</svg>
`,vY=`
<svg
  class="lucide lucide-table-cells-split"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 15V9" />
  <path d="M3 15h18" />
  <path d="M3 9h18" />
  <rect width="18" height="18" x="3" y="3" rx="2" />
</svg>
`,vZ=`
<svg
  class="lucide lucide-table-columns-split"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 14v2" />
  <path d="M14 20v2" />
  <path d="M14 2v2" />
  <path d="M14 8v2" />
  <path d="M2 15h8" />
  <path d="M2 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H2" />
  <path d="M2 9h8" />
  <path d="M22 15h-4" />
  <path d="M22 3h-2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2" />
  <path d="M22 9h-4" />
  <path d="M5 3v18" />
</svg>
`,v$=`
<svg
  class="lucide lucide-table-of-contents"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 5H3" />
  <path d="M16 12H3" />
  <path d="M16 19H3" />
  <path d="M21 5h.01" />
  <path d="M21 12h.01" />
  <path d="M21 19h.01" />
</svg>
`,v_=`
<svg
  class="lucide lucide-table-properties"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 3v18" />
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M21 9H3" />
  <path d="M21 15H3" />
</svg>
`,v0=`
<svg
  class="lucide lucide-table-rows-split"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 10h2" />
  <path d="M15 22v-8" />
  <path d="M15 2v4" />
  <path d="M2 10h2" />
  <path d="M20 10h2" />
  <path d="M3 19h18" />
  <path d="M3 22v-6a2 2 135 0 1 2-2h14a2 2 45 0 1 2 2v6" />
  <path d="M3 2v2a2 2 45 0 0 2 2h14a2 2 135 0 0 2-2V2" />
  <path d="M8 10h2" />
  <path d="M9 22v-8" />
  <path d="M9 2v4" />
</svg>
`,v1=`
<svg
  class="lucide lucide-table"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v18" />
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="M3 15h18" />
</svg>
`,v2=`
<svg
  class="lucide lucide-tablet-smartphone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="10" height="14" x="3" y="8" rx="2" />
  <path d="M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4" />
  <path d="M8 18h.01" />
</svg>
`,v3=`
<svg
  class="lucide lucide-tablet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
  <line x1="12" x2="12.01" y1="18" y2="18" />
</svg>
`,v4=`
<svg
  class="lucide lucide-tablets"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="7" cy="7" r="5" />
  <circle cx="17" cy="17" r="5" />
  <path d="M12 17h10" />
  <path d="m3.46 10.54 7.08-7.08" />
</svg>
`,v5=`
<svg
  class="lucide lucide-tag"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
  <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
</svg>
`,v6=`
<svg
  class="lucide lucide-tags"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z" />
  <path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" />
  <circle cx="10.5" cy="6.5" r=".5" fill="currentColor" />
</svg>
`,v7=`
<svg
  class="lucide lucide-tally-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 4v16" />
  <path d="M9 4v16" />
</svg>
`,v8=`
<svg
  class="lucide lucide-tally-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 4v16" />
</svg>
`,v9=`
<svg
  class="lucide lucide-tally-3"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 4v16" />
  <path d="M9 4v16" />
  <path d="M14 4v16" />
</svg>
`,wa=`
<svg
  class="lucide lucide-tally-4"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 4v16" />
  <path d="M9 4v16" />
  <path d="M14 4v16" />
  <path d="M19 4v16" />
</svg>
`,wb=`
<svg
  class="lucide lucide-tally-5"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 4v16" />
  <path d="M9 4v16" />
  <path d="M14 4v16" />
  <path d="M19 4v16" />
  <path d="M22 6 2 18" />
</svg>
`,wc=`
<svg
  class="lucide lucide-tangent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="17" cy="4" r="2" />
  <path d="M15.59 5.41 5.41 15.59" />
  <circle cx="4" cy="17" r="2" />
  <path d="M12 22s-4-9-1.5-11.5S22 12 22 12" />
</svg>
`,wd=`
<svg
  class="lucide lucide-target"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="6" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,we=`
<svg
  class="lucide lucide-telescope"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44" />
  <path d="m13.56 11.747 4.332-.924" />
  <path d="m16 21-3.105-6.21" />
  <path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z" />
  <path d="m6.158 8.633 1.114 4.456" />
  <path d="m8 21 3.105-6.21" />
  <circle cx="12" cy="13" r="2" />
</svg>
`,wf=`
<svg
  class="lucide lucide-tent-tree"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="4" cy="4" r="2" />
  <path d="m14 5 3-3 3 3" />
  <path d="m14 10 3-3 3 3" />
  <path d="M17 14V2" />
  <path d="M17 14H7l-5 8h20Z" />
  <path d="M8 14v8" />
  <path d="m9 14 5 8" />
</svg>
`,wg=`
<svg
  class="lucide lucide-tent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3.5 21 14 3" />
  <path d="M20.5 21 10 3" />
  <path d="M15.5 21 12 15l-3.5 6" />
  <path d="M2 21h20" />
</svg>
`,wh=`
<svg
  class="lucide lucide-terminal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 19h8" />
  <path d="m4 17 6-6-6-6" />
</svg>
`,wi=`
<svg
  class="lucide lucide-test-tube-diagonal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3" />
  <path d="m16 2 6 6" />
  <path d="M12 16H4" />
</svg>
`,wj=`
<svg
  class="lucide lucide-test-tube"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2" />
  <path d="M8.5 2h7" />
  <path d="M14.5 16h-5" />
</svg>
`,wk=`
<svg
  class="lucide lucide-test-tubes"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 2v17.5A2.5 2.5 0 0 1 6.5 22A2.5 2.5 0 0 1 4 19.5V2" />
  <path d="M20 2v17.5a2.5 2.5 0 0 1-2.5 2.5a2.5 2.5 0 0 1-2.5-2.5V2" />
  <path d="M3 2h7" />
  <path d="M14 2h7" />
  <path d="M9 16H4" />
  <path d="M20 16h-5" />
</svg>
`,wl=`
<svg
  class="lucide lucide-text-align-center"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M17 12H7" />
  <path d="M19 19H5" />
</svg>
`,wm=`
<svg
  class="lucide lucide-text-align-end"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M21 12H9" />
  <path d="M21 19H7" />
</svg>
`,wn=`
<svg
  class="lucide lucide-text-align-justify"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 5h18" />
  <path d="M3 12h18" />
  <path d="M3 19h18" />
</svg>
`,wo=`
<svg
  class="lucide lucide-text-align-start"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M15 12H3" />
  <path d="M17 19H3" />
</svg>
`,wp=`
<svg
  class="lucide lucide-text-cursor-input"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6" />
  <path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" />
  <path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" />
  <path d="M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1" />
  <path d="M9 6v12" />
</svg>
`,wq=`
<svg
  class="lucide lucide-text-cursor"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1" />
  <path d="M7 22h1a4 4 0 0 0 4-4v-1" />
  <path d="M7 2h1a4 4 0 0 1 4 4v1" />
</svg>
`,wr=`
<svg
  class="lucide lucide-text-initial"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 5h6" />
  <path d="M15 12h6" />
  <path d="M3 19h18" />
  <path d="m3 12 3.553-7.724a.5.5 0 0 1 .894 0L11 12" />
  <path d="M3.92 10h6.16" />
</svg>
`,ws=`
<svg
  class="lucide lucide-text-quote"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 5H3" />
  <path d="M21 12H8" />
  <path d="M21 19H8" />
  <path d="M3 12v7" />
</svg>
`,wt=`
<svg
  class="lucide lucide-text-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 5H3" />
  <path d="M10 12H3" />
  <path d="M10 19H3" />
  <circle cx="17" cy="15" r="3" />
  <path d="m21 19-1.9-1.9" />
</svg>
`,wu=`
<svg
  class="lucide lucide-text-select"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 21h1" />
  <path d="M14 3h1" />
  <path d="M19 3a2 2 0 0 1 2 2" />
  <path d="M21 14v1" />
  <path d="M21 19a2 2 0 0 1-2 2" />
  <path d="M21 9v1" />
  <path d="M3 14v1" />
  <path d="M3 9v1" />
  <path d="M5 21a2 2 0 0 1-2-2" />
  <path d="M5 3a2 2 0 0 0-2 2" />
  <path d="M7 12h10" />
  <path d="M7 16h6" />
  <path d="M7 8h8" />
  <path d="M9 21h1" />
  <path d="M9 3h1" />
</svg>
`,wv=`
<svg
  class="lucide lucide-text-wrap"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 16-3 3 3 3" />
  <path d="M3 12h14.5a1 1 0 0 1 0 7H13" />
  <path d="M3 19h6" />
  <path d="M3 5h18" />
</svg>
`,ww=`
<svg
  class="lucide lucide-theater"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 10s3-3 3-8" />
  <path d="M22 10s-3-3-3-8" />
  <path d="M10 2c0 4.4-3.6 8-8 8" />
  <path d="M14 2c0 4.4 3.6 8 8 8" />
  <path d="M2 10s2 2 2 5" />
  <path d="M22 10s-2 2-2 5" />
  <path d="M8 15h8" />
  <path d="M2 22v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" />
  <path d="M14 22v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" />
</svg>
`,wx=`
<svg
  class="lucide lucide-thermometer-snowflake"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 20-1.25-2.5L6 18" />
  <path d="M10 4 8.75 6.5 6 6" />
  <path d="M10.585 15H10" />
  <path d="M2 12h6.5L10 9" />
  <path d="M20 14.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />
  <path d="m4 10 1.5 2L4 14" />
  <path d="m7 21 3-6-1.5-3" />
  <path d="m7 3 3 6h2" />
</svg>
`,wy=`
<svg
  class="lucide lucide-thermometer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
</svg>
`,wz=`
<svg
  class="lucide lucide-thermometer-sun"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 9a4 4 0 0 0-2 7.5" />
  <path d="M12 3v2" />
  <path d="m6.6 18.4-1.4 1.4" />
  <path d="M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
  <path d="M4 13H2" />
  <path d="M6.34 7.34 4.93 5.93" />
</svg>
`,wA=`
<svg
  class="lucide lucide-thumbs-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 14V2" />
  <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
</svg>
`,wB=`
<svg
  class="lucide lucide-ticket-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="m9 12 2 2 4-4" />
</svg>
`,wC=`
<svg
  class="lucide lucide-thumbs-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 10v12" />
  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
</svg>
`,wD=`
<svg
  class="lucide lucide-ticket-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="M9 12h6" />
</svg>
`,wE=`
<svg
  class="lucide lucide-ticket-percent"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="M9 9h.01" />
  <path d="m15 9-6 6" />
  <path d="M15 15h.01" />
</svg>
`,wF=`
<svg
  class="lucide lucide-ticket-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="M9 12h6" />
  <path d="M12 9v6" />
</svg>
`,wG=`
<svg
  class="lucide lucide-ticket-slash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="m9.5 14.5 5-5" />
</svg>
`,wH=`
<svg
  class="lucide lucide-ticket"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="M13 5v2" />
  <path d="M13 17v2" />
  <path d="M13 11v2" />
</svg>
`,wI=`
<svg
  class="lucide lucide-tickets-plane"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.5 17h1.227a2 2 0 0 0 1.345-.52L18 12" />
  <path d="m12 13.5 3.75.5" />
  <path d="m4.5 8 10.58-5.06a1 1 0 0 1 1.342.488L18.5 8" />
  <path d="M6 10V8" />
  <path d="M6 14v1" />
  <path d="M6 19v2" />
  <rect x="2" y="8" width="20" height="13" rx="2" />
</svg>
`,wJ=`
<svg
  class="lucide lucide-ticket-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
  <path d="m9.5 14.5 5-5" />
  <path d="m9.5 9.5 5 5" />
</svg>
`,wK=`
<svg
  class="lucide lucide-timer-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2h4" />
  <path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7" />
  <path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2" />
  <path d="m2 2 20 20" />
  <path d="M12 12v-2" />
</svg>
`,wL=`
<svg
  class="lucide lucide-tickets"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m4.5 8 10.58-5.06a1 1 0 0 1 1.342.488L18.5 8" />
  <path d="M6 10V8" />
  <path d="M6 14v1" />
  <path d="M6 19v2" />
  <rect x="2" y="8" width="20" height="13" rx="2" />
</svg>
`,wM=`
<svg
  class="lucide lucide-timer-reset"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2h4" />
  <path d="M12 14v-4" />
  <path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6" />
  <path d="M9 17H4v5" />
</svg>
`,wN=`
<svg
  class="lucide lucide-timer"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <line x1="10" x2="14" y1="2" y2="2" />
  <line x1="12" x2="15" y1="14" y2="11" />
  <circle cx="12" cy="14" r="8" />
</svg>
`,wO=`
<svg
  class="lucide lucide-toggle-left"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="9" cy="12" r="3" />
  <rect width="20" height="14" x="2" y="5" rx="7" />
</svg>
`,wP=`
<svg
  class="lucide lucide-toggle-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="15" cy="12" r="3" />
  <rect width="20" height="14" x="2" y="5" rx="7" />
</svg>
`,wQ=`
<svg
  class="lucide lucide-toilet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18" />
  <path d="M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />
</svg>`,wR=`
<svg
  class="lucide lucide-tool-case"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 15h4" />
  <path d="m14.817 10.995-.971-1.45 1.034-1.232a2 2 0 0 0-2.025-3.238l-1.82.364L9.91 3.885a2 2 0 0 0-3.625.748L6.141 6.55l-1.725.426a2 2 0 0 0-.19 3.756l.657.27" />
  <path d="m18.822 10.995 2.26-5.38a1 1 0 0 0-.557-1.318L16.954 2.9a1 1 0 0 0-1.281.533l-.924 2.122" />
  <path d="M4 12.006A1 1 0 0 1 4.994 11H19a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
</svg>
`,wS=`
<svg
  class="lucide lucide-tornado"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 4H3" />
  <path d="M18 8H6" />
  <path d="M19 12H9" />
  <path d="M16 16h-6" />
  <path d="M11 20H9" />
</svg>
`,wT=`
<svg
  class="lucide lucide-torus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <ellipse cx="12" cy="11" rx="3" ry="2" />
  <ellipse cx="12" cy="12.5" rx="10" ry="8.5" />
</svg>
`,wU=`
<svg
  class="lucide lucide-touchpad-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20v-6" />
  <path d="M19.656 14H22" />
  <path d="M2 14h12" />
  <path d="m2 2 20 20" />
  <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />
  <path d="M9.656 4H20a2 2 0 0 1 2 2v10.344" />
</svg>
`,wV=`
<svg
  class="lucide lucide-touchpad"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M2 14h20" />
  <path d="M12 20v-6" />
</svg>
`,wW=`
<svg
  class="lucide lucide-toy-brick"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="12" x="3" y="8" rx="1" />
  <path d="M10 8V5c0-.6-.4-1-1-1H6a1 1 0 0 0-1 1v3" />
  <path d="M19 8V5c0-.6-.4-1-1-1h-3a1 1 0 0 0-1 1v3" />
</svg>
`,wX=`
<svg
  class="lucide lucide-tower-control"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18.2 12.27 20 6H4l1.8 6.27a1 1 0 0 0 .95.73h10.5a1 1 0 0 0 .96-.73Z" />
  <path d="M8 13v9" />
  <path d="M16 22v-9" />
  <path d="m9 6 1 7" />
  <path d="m15 6-1 7" />
  <path d="M12 6V2" />
  <path d="M13 2h-2" />
</svg>
`,wY=`
<svg
  class="lucide lucide-tractor"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20" />
  <path d="M16 18h-5" />
  <path d="M18 5a1 1 0 0 0-1 1v5.573" />
  <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246" />
  <path d="M4 11V4" />
  <path d="M7 15h.01" />
  <path d="M8 10.1V4" />
  <circle cx="18" cy="18" r="2" />
  <circle cx="7" cy="15" r="5" />
</svg>
`,wZ=`
<svg
  class="lucide lucide-traffic-cone"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
  <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
  <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
  <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
</svg>
`,w$=`
<svg
  class="lucide lucide-train-front-tunnel"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 22V12a10 10 0 1 1 20 0v10" />
  <path d="M15 6.8v1.4a3 2.8 0 1 1-6 0V6.8" />
  <path d="M10 15h.01" />
  <path d="M14 15h.01" />
  <path d="M10 19a4 4 0 0 1-4-4v-3a6 6 0 1 1 12 0v3a4 4 0 0 1-4 4Z" />
  <path d="m9 19-2 3" />
  <path d="m15 19 2 3" />
</svg>
`,w_=`
<svg
  class="lucide lucide-train-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" />
  <path d="m9 15-1-1" />
  <path d="m15 15 1-1" />
  <path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" />
  <path d="m8 19-2 3" />
  <path d="m16 19 2 3" />
</svg>
`,w0=`
<svg
  class="lucide lucide-train-track"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 17 17 2" />
  <path d="m2 14 8 8" />
  <path d="m5 11 8 8" />
  <path d="m8 8 8 8" />
  <path d="m11 5 8 8" />
  <path d="m14 2 8 8" />
  <path d="M7 22 22 7" />
</svg>
`,w1=`
<svg
  class="lucide lucide-tram-front"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="16" height="16" x="4" y="3" rx="2" />
  <path d="M4 11h16" />
  <path d="M12 3v8" />
  <path d="m8 19-2 3" />
  <path d="m18 22-2-3" />
  <path d="M8 15h.01" />
  <path d="M16 15h.01" />
</svg>
`,w2=`
<svg
  class="lucide lucide-transgender"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 16v6" />
  <path d="M14 20h-4" />
  <path d="M18 2h4v4" />
  <path d="m2 2 7.17 7.17" />
  <path d="M2 5.355V2h3.357" />
  <path d="m22 2-7.17 7.17" />
  <path d="M8 5 5 8" />
  <circle cx="12" cy="12" r="4" />
</svg>
`,w3=`
<svg
  class="lucide lucide-trash-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 11v6" />
  <path d="M14 11v6" />
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  <path d="M3 6h18" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</svg>
`,w4=`
<svg
  class="lucide lucide-trash"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  <path d="M3 6h18" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</svg>
`,w5=`
<svg
  class="lucide lucide-tree-deciduous"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
  <path d="M12 19v3" />
</svg>
`,w6=`
<svg
  class="lucide lucide-tree-palm"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4" />
  <path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3" />
  <path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35" />
  <path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14" />
</svg>
`,w7=`
<svg
  class="lucide lucide-tree-pine"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" />
  <path d="M12 22v-3" />
</svg>
`,w8=`
<svg
  class="lucide lucide-trees"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z" />
  <path d="M7 16v6" />
  <path d="M13 19v3" />
  <path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5" />
</svg>
`,w9=`
<svg
  class="lucide lucide-trello"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  <rect width="3" height="9" x="7" y="7" />
  <rect width="3" height="5" x="14" y="7" />
</svg>
`,xa=`
<svg
  class="lucide lucide-trending-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 17h6v-6" />
  <path d="m22 17-8.5-8.5-5 5L2 7" />
</svg>
`,xb=`
<svg
  class="lucide lucide-trending-up-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.828 14.828 21 21" />
  <path d="M21 16v5h-5" />
  <path d="m21 3-9 9-4-4-6 6" />
  <path d="M21 8V3h-5" />
</svg>
`,xc=`
<svg
  class="lucide lucide-trending-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 7h6v6" />
  <path d="m22 7-8.5 8.5-5-5L2 17" />
</svg>
`,xd=`
<svg
  class="lucide lucide-triangle-alert"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</svg>
`,xe=`
<svg
  class="lucide lucide-triangle-dashed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.17 4.193a2 2 0 0 1 3.666.013" />
  <path d="M14 21h2" />
  <path d="m15.874 7.743 1 1.732" />
  <path d="m18.849 12.952 1 1.732" />
  <path d="M21.824 18.18a2 2 0 0 1-1.835 2.824" />
  <path d="M4.024 21a2 2 0 0 1-1.839-2.839" />
  <path d="m5.136 12.952-1 1.732" />
  <path d="M8 21h2" />
  <path d="m8.102 7.743-1 1.732" />
</svg>
`,xf=`
<svg
  class="lucide lucide-triangle-right"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 18a2 2 0 0 1-2 2H3c-1.1 0-1.3-.6-.4-1.3L20.4 4.3c.9-.7 1.6-.4 1.6.7Z" />
</svg>
`,xg=`
<svg
  class="lucide lucide-triangle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
</svg>
`,xh=`
<svg
  class="lucide lucide-trophy"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" />
  <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" />
  <path d="M18 9h1.5a1 1 0 0 0 0-5H18" />
  <path d="M4 22h16" />
  <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
  <path d="M6 9H4.5a1 1 0 0 1 0-5H6" />
</svg>
`,xi=`
<svg
  class="lucide lucide-truck-electric"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 19V7a2 2 0 0 0-2-2H9" />
  <path d="M15 19H9" />
  <path d="M19 19h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14" />
  <path d="M2 13v5a1 1 0 0 0 1 1h2" />
  <path d="M4 3 2.15 5.15a.495.495 0 0 0 .35.86h2.15a.47.47 0 0 1 .35.86L3 9.02" />
  <circle cx="17" cy="19" r="2" />
  <circle cx="7" cy="19" r="2" />
</svg>
`,xj=`
<svg
  class="lucide lucide-truck"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
  <path d="M15 18H9" />
  <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
  <circle cx="17" cy="18" r="2" />
  <circle cx="7" cy="18" r="2" />
</svg>`,xk=`
<svg
  class="lucide lucide-turkish-lira"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 4 5 9" />
  <path d="m15 8.5-10 5" />
  <path d="M18 12a9 9 0 0 1-9 9V3" />
</svg>
`,xl=`
<svg
  class="lucide lucide-turntable"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 12.01h.01" />
  <path d="M18 8v4a8 8 0 0 1-1.07 4" />
  <circle cx="10" cy="12" r="4" />
  <rect x="2" y="4" width="20" height="16" rx="2" />
</svg>
`,xm=`
<svg
  class="lucide lucide-turtle"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
  <path d="M4.82 7.9 8 10" />
  <path d="M15.18 7.9 12 10" />
  <path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
</svg>
`,xn=`
<svg
  class="lucide lucide-tv-minimal-play"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z" />
  <path d="M7 21h10" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
</svg>
`,xo=`
<svg
  class="lucide lucide-tv-minimal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M7 21h10" />
  <rect width="20" height="14" x="2" y="3" rx="2" />
</svg>
`,xp=`
<svg
  class="lucide lucide-tv"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m17 2-5 5-5-5" />
  <rect width="20" height="15" x="2" y="7" rx="2" />
</svg>
`,xq=`
<svg
  class="lucide lucide-twitch"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7" />
</svg>
`,xr=`
<svg
  class="lucide lucide-twitter"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
</svg>
`,xs=`
<svg
  class="lucide lucide-type-outline"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 16.5a.5.5 0 0 0 .5.5h.5a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4h.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V8a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z" />
</svg>
`,xt=`
<svg
  class="lucide lucide-type"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 4v16" />
  <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
  <path d="M9 20h6" />
</svg>
`,xu=`
<svg
  class="lucide lucide-umbrella-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v7a2 2 0 0 0 4 0" />
  <path d="M12 2v2" />
  <path d="M18.656 13h2.336a1 1 0 0 0 .97-1.274 10.284 10.284 0 0 0-12.07-7.51" />
  <path d="m2 2 20 20" />
  <path d="M5.961 5.957a10.28 10.28 0 0 0-3.922 5.769A1 1 0 0 0 3 13h10" />
</svg>
`,xv=`
<svg
  class="lucide lucide-umbrella"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 13v7a2 2 0 0 0 4 0" />
  <path d="M12 2v2" />
  <path d="M20.992 13a1 1 0 0 0 .97-1.274 10.284 10.284 0 0 0-19.923 0A1 1 0 0 0 3 13z" />
</svg>
`,xw=`
<svg
  class="lucide lucide-underline"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M6 4v6a6 6 0 0 0 12 0V4" />
  <line x1="4" x2="20" y1="20" y2="20" />
</svg>
`,xx=`
<svg
  class="lucide lucide-undo-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M9 14 4 9l5-5" />
  <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
</svg>
`,xy=`
<svg
  class="lucide lucide-undo"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 7v6h6" />
  <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
</svg>
`,xz=`
<svg
  class="lucide lucide-undo-dot"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
  <path d="M3 7v6h6" />
  <circle cx="12" cy="17" r="1" />
</svg>
`,xA=`
<svg
  class="lucide lucide-unfold-horizontal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 12h6" />
  <path d="M8 12H2" />
  <path d="M12 2v2" />
  <path d="M12 8v2" />
  <path d="M12 14v2" />
  <path d="M12 20v2" />
  <path d="m19 15 3-3-3-3" />
  <path d="m5 9-3 3 3 3" />
</svg>
`,xB=`
<svg
  class="lucide lucide-unfold-vertical"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 22v-6" />
  <path d="M12 8V2" />
  <path d="M4 12H2" />
  <path d="M10 12H8" />
  <path d="M16 12h-2" />
  <path d="M22 12h-2" />
  <path d="m15 19-3 3-3-3" />
  <path d="m15 5-3-3-3 3" />
</svg>
`,xC=`
<svg
  class="lucide lucide-ungroup"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="6" x="5" y="4" rx="1" />
  <rect width="8" height="6" x="11" y="14" rx="1" />
</svg>
`,xD=`
<svg
  class="lucide lucide-university"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
  <path d="M18 12h.01" />
  <path d="M18 16h.01" />
  <path d="M22 7a1 1 0 0 0-1-1h-2a2 2 0 0 1-1.143-.359L13.143 2.36a2 2 0 0 0-2.286-.001L6.143 5.64A2 2 0 0 1 5 6H3a1 1 0 0 0-1 1v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z" />
  <path d="M6 12h.01" />
  <path d="M6 16h.01" />
  <circle cx="12" cy="10" r="2" />
</svg>
`,xE=`
<svg
  class="lucide lucide-unlink-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2" />
</svg>
`,xF=`
<svg
  class="lucide lucide-unplug"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 5 3-3" />
  <path d="m2 22 3-3" />
  <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
  <path d="M7.5 13.5 10 11" />
  <path d="M10.5 16.5 13 14" />
  <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
</svg>
`,xG=`
<svg
  class="lucide lucide-unlink"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
  <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
  <line x1="8" x2="8" y1="2" y2="5" />
  <line x1="2" x2="5" y1="8" y2="8" />
  <line x1="16" x2="16" y1="19" y2="22" />
  <line x1="19" x2="22" y1="16" y2="16" />
</svg>
`,xH=`
<svg
  class="lucide lucide-upload"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 3v12" />
  <path d="m17 8-5-5-5 5" />
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
</svg>
`,xI=`
<svg
  class="lucide lucide-usb"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="10" cy="7" r="1" />
  <circle cx="4" cy="20" r="1" />
  <path d="M4.7 19.3 19 5" />
  <path d="m21 3-3 1 2 2Z" />
  <path d="M9.26 7.68 5 12l2 5" />
  <path d="m10 14 5 2 3.5-3.5" />
  <path d="m18 12 1-1 1 1-1 1Z" />
</svg>
`,xJ=`
<svg
  class="lucide lucide-user-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 15H6a4 4 0 0 0-4 4v2" />
  <path d="m14.305 16.53.923-.382" />
  <path d="m15.228 13.852-.923-.383" />
  <path d="m16.852 12.228-.383-.923" />
  <path d="m16.852 17.772-.383.924" />
  <path d="m19.148 12.228.383-.923" />
  <path d="m19.53 18.696-.382-.924" />
  <path d="m20.772 13.852.924-.383" />
  <path d="m20.772 16.148.924.383" />
  <circle cx="18" cy="15" r="3" />
  <circle cx="9" cy="7" r="4" />
</svg>
`,xK=`
<svg
  class="lucide lucide-user-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 11 2 2 4-4" />
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
</svg>
`,xL=`
<svg
  class="lucide lucide-user-lock"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="10" cy="7" r="4" />
  <path d="M10.3 15H7a4 4 0 0 0-4 4v2" />
  <path d="M15 15.5V14a2 2 0 0 1 4 0v1.5" />
  <rect width="8" height="5" x="13" y="16" rx=".899" />
</svg>
`,xM=`
<svg
  class="lucide lucide-user-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
  <line x1="22" x2="16" y1="11" y2="11" />
</svg>
`,xN=`
<svg
  class="lucide lucide-user-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.5 15H7a4 4 0 0 0-4 4v2" />
  <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  <circle cx="10" cy="7" r="4" />
</svg>
`,xO=`
<svg
  class="lucide lucide-user-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
  <line x1="19" x2="19" y1="8" y2="14" />
  <line x1="22" x2="16" y1="11" y2="11" />
</svg>
`,xP=`
<svg
  class="lucide lucide-user-round-check"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21a8 8 0 0 1 13.292-6" />
  <circle cx="10" cy="8" r="5" />
  <path d="m16 19 2 2 4-4" />
</svg>
`,xQ=`
<svg
  class="lucide lucide-user-round-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.305 19.53.923-.382" />
  <path d="m15.228 16.852-.923-.383" />
  <path d="m16.852 15.228-.383-.923" />
  <path d="m16.852 20.772-.383.924" />
  <path d="m19.148 15.228.383-.923" />
  <path d="m19.53 21.696-.382-.924" />
  <path d="M2 21a8 8 0 0 1 10.434-7.62" />
  <path d="m20.772 16.852.924-.383" />
  <path d="m20.772 19.148.924.383" />
  <circle cx="10" cy="8" r="5" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,xR=`
<svg
  class="lucide lucide-user-round-minus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21a8 8 0 0 1 13.292-6" />
  <circle cx="10" cy="8" r="5" />
  <path d="M22 19h-6" />
</svg>
`,xS=`
<svg
  class="lucide lucide-user-round-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21a8 8 0 0 1 10.821-7.487" />
  <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  <circle cx="10" cy="8" r="5" />
</svg>
`,xT=`
<svg
  class="lucide lucide-user-round-plus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21a8 8 0 0 1 13.292-6" />
  <circle cx="10" cy="8" r="5" />
  <path d="M19 16v6" />
  <path d="M22 19h-6" />
</svg>
`,xU=`
<svg
  class="lucide lucide-user-round-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="10" cy="8" r="5" />
  <path d="M2 21a8 8 0 0 1 10.434-7.62" />
  <circle cx="18" cy="18" r="3" />
  <path d="m22 22-1.9-1.9" />
</svg>
`,xV=`
<svg
  class="lucide lucide-user-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="8" r="5" />
  <path d="M20 21a8 8 0 0 0-16 0" />
</svg>
`,xW=`
<svg
  class="lucide lucide-user-round-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 21a8 8 0 0 1 11.873-7" />
  <circle cx="10" cy="8" r="5" />
  <path d="m17 17 5 5" />
  <path d="m22 17-5 5" />
</svg>
`,xX=`
<svg
  class="lucide lucide-user-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="10" cy="7" r="4" />
  <path d="M10.3 15H7a4 4 0 0 0-4 4v2" />
  <circle cx="17" cy="17" r="3" />
  <path d="m21 21-1.9-1.9" />
</svg>
`,xY=`
<svg
  class="lucide lucide-user-star"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16.051 12.616a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.866l-1.156-1.153a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z" />
  <path d="M8 15H7a4 4 0 0 0-4 4v2" />
  <circle cx="10" cy="7" r="4" />
</svg>
`,xZ=`
<svg
  class="lucide lucide-user-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
  <line x1="17" x2="22" y1="8" y2="13" />
  <line x1="22" x2="17" y1="8" y2="13" />
</svg>
`,x$=`
<svg
  class="lucide lucide-user"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
  <circle cx="12" cy="7" r="4" />
</svg>
`,x_=`
<svg
  class="lucide lucide-users-round"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 21a8 8 0 0 0-16 0" />
  <circle cx="10" cy="8" r="5" />
  <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
</svg>
`,x0=`
<svg
  class="lucide lucide-utensils-crossed"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
  <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" />
  <path d="m2.1 21.8 6.4-6.3" />
  <path d="m19 5-7 7" />
</svg>
`,x1=`
<svg
  class="lucide lucide-users"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <path d="M16 3.128a4 4 0 0 1 0 7.744" />
  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  <circle cx="9" cy="7" r="4" />
</svg>
`,x2=`
<svg
  class="lucide lucide-utensils"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
  <path d="M7 2v20" />
  <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
</svg>
`,x3=`
<svg
  class="lucide lucide-utility-pole"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 2v20" />
  <path d="M2 5h20" />
  <path d="M3 3v2" />
  <path d="M7 3v2" />
  <path d="M17 3v2" />
  <path d="M21 3v2" />
  <path d="m19 5-7 7-7-7" />
</svg>
`,x4=`
<svg
  class="lucide lucide-variable"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 21s-4-3-4-9 4-9 4-9" />
  <path d="M16 3s4 3 4 9-4 9-4 9" />
  <line x1="15" x2="9" y1="9" y2="15" />
  <line x1="9" x2="15" y1="9" y2="15" />
</svg>
`,x5=`
<svg
  class="lucide lucide-vault"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  <path d="m7.9 7.9 2.7 2.7" />
  <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  <path d="m13.4 10.6 2.7-2.7" />
  <circle cx="7.5" cy="16.5" r=".5" fill="currentColor" />
  <path d="m7.9 16.1 2.7-2.7" />
  <circle cx="16.5" cy="16.5" r=".5" fill="currentColor" />
  <path d="m13.4 13.4 2.7 2.7" />
  <circle cx="12" cy="12" r="2" />
</svg>
`,x6=`
<svg
  class="lucide lucide-vegan"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 8q6 0 6-6-6 0-6 6" />
  <path d="M17.41 3.59a10 10 0 1 0 3 3" />
  <path d="M2 2a26.6 26.6 0 0 1 10 20c.9-6.82 1.5-9.5 4-14" />
</svg>
`,x7=`
<svg
  class="lucide lucide-vector-square"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19.5 7a24 24 0 0 1 0 10" />
  <path d="M4.5 7a24 24 0 0 0 0 10" />
  <path d="M7 19.5a24 24 0 0 0 10 0" />
  <path d="M7 4.5a24 24 0 0 1 10 0" />
  <rect x="17" y="17" width="5" height="5" rx="1" />
  <rect x="17" y="2" width="5" height="5" rx="1" />
  <rect x="2" y="17" width="5" height="5" rx="1" />
  <rect x="2" y="2" width="5" height="5" rx="1" />
</svg>
`,x8=`
<svg
  class="lucide lucide-venetian-mask"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 11c-1.5 0-2.5.5-3 2" />
  <path d="M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z" />
  <path d="M6 11c1.5 0 2.5.5 3 2" />
</svg>
`,x9=`
<svg
  class="lucide lucide-venus-and-mars"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 20h4" />
  <path d="M12 16v6" />
  <path d="M17 2h4v4" />
  <path d="m21 2-5.46 5.46" />
  <circle cx="12" cy="11" r="5" />
</svg>
`,ya=`
<svg
  class="lucide lucide-venus"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 15v7" />
  <path d="M9 19h6" />
  <circle cx="12" cy="9" r="6" />
</svg>
`,yb=`
<svg
  class="lucide lucide-vibrate-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 8 2 2-2 2 2 2-2 2" />
  <path d="m22 8-2 2 2 2-2 2 2 2" />
  <path d="M8 8v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2" />
  <path d="M16 10.34V6c0-.55-.45-1-1-1h-4.34" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,yc=`
<svg
  class="lucide lucide-vibrate"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 8 2 2-2 2 2 2-2 2" />
  <path d="m22 8-2 2 2 2-2 2 2 2" />
  <rect width="8" height="14" x="8" y="5" rx="1" />
</svg>
`,yd=`
<svg
  class="lucide lucide-video-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
  <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
  <path d="m2 2 20 20" />
</svg>
`,ye=`
<svg
  class="lucide lucide-video"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
  <rect x="2" y="6" width="14" height="12" rx="2" />
</svg>
`,yf=`
<svg
  class="lucide lucide-videotape"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M2 8h20" />
  <circle cx="8" cy="14" r="2" />
  <path d="M8 12h8" />
  <circle cx="16" cy="14" r="2" />
</svg>
`,yg=`
<svg
  class="lucide lucide-view"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2" />
  <path d="M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2" />
  <circle cx="12" cy="12" r="1" />
  <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
</svg>
`,yh=`
<svg
  class="lucide lucide-voicemail"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="6" cy="12" r="4" />
  <circle cx="18" cy="12" r="4" />
  <line x1="6" x2="18" y1="16" y2="16" />
</svg>
`,yi=`
<svg
  class="lucide lucide-volleyball"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.1 7.1a16.55 16.55 0 0 1 10.9 4" />
  <path d="M12 12a12.6 12.6 0 0 1-8.7 5" />
  <path d="M16.8 13.6a16.55 16.55 0 0 1-9 7.5" />
  <path d="M20.7 17a12.8 12.8 0 0 0-8.7-5 13.3 13.3 0 0 1 0-10" />
  <path d="M6.3 3.8a16.55 16.55 0 0 0 1.9 11.5" />
  <circle cx="12" cy="12" r="10" />
</svg>
`,yj=`
<svg
  class="lucide lucide-volume-1"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
  <path d="M16 9a5 5 0 0 1 0 6" />
</svg>
`,yk=`
<svg
  class="lucide lucide-volume-2"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
  <path d="M16 9a5 5 0 0 1 0 6" />
  <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
</svg>
`,yl=`
<svg
  class="lucide lucide-volume-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 9a5 5 0 0 1 .95 2.293" />
  <path d="M19.364 5.636a9 9 0 0 1 1.889 9.96" />
  <path d="m2 2 20 20" />
  <path d="m7 7-.587.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298V11" />
  <path d="M9.828 4.172A.686.686 0 0 1 11 4.657v.686" />
</svg>
`,ym=`
<svg
  class="lucide lucide-volume-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
  <line x1="22" x2="16" y1="9" y2="15" />
  <line x1="16" x2="22" y1="9" y2="15" />
</svg>
`,yn=`
<svg
  class="lucide lucide-volume"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
</svg>
`,yo=`
<svg
  class="lucide lucide-vote"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m9 12 2 2 4-4" />
  <path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z" />
  <path d="M22 19H2" />
</svg>
`,yp=`
<svg
  class="lucide lucide-wallet-cards"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2" />
  <path d="M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21" />
</svg>
`,yq=`
<svg
  class="lucide lucide-wallet-minimal"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 14h.01" />
  <path d="M7 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14" />
</svg>
`,yr=`
<svg
  class="lucide lucide-wallet"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
  <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
</svg>
`,ys=`
<svg
  class="lucide lucide-wallpaper"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 17v4" />
  <path d="M8 21h8" />
  <path d="m9 17 6.1-6.1a2 2 0 0 1 2.81.01L22 15" />
  <circle cx="8" cy="9" r="2" />
  <rect x="2" y="3" width="20" height="14" rx="2" />
</svg>
`,yt=`
<svg
  class="lucide lucide-wand-sparkles"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
  <path d="m14 7 3 3" />
  <path d="M5 6v4" />
  <path d="M19 14v4" />
  <path d="M10 2v2" />
  <path d="M7 8H3" />
  <path d="M21 16h-4" />
  <path d="M11 3H9" />
</svg>
`,yu=`
<svg
  class="lucide lucide-warehouse"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11" />
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z" />
  <path d="M6 13h12" />
  <path d="M6 17h12" />
</svg>
`,yv=`
<svg
  class="lucide lucide-wand"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M15 4V2" />
  <path d="M15 16v-2" />
  <path d="M8 9h2" />
  <path d="M20 9h2" />
  <path d="M17.8 11.8 19 13" />
  <path d="M15 9h.01" />
  <path d="M17.8 6.2 19 5" />
  <path d="m3 21 9-9" />
  <path d="M12.2 6.2 11 5" />
</svg>
`,yw=`
<svg
  class="lucide lucide-washing-machine"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M3 6h3" />
  <path d="M17 6h.01" />
  <rect width="18" height="20" x="3" y="2" rx="2" />
  <circle cx="12" cy="13" r="5" />
  <path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5" />
</svg>
`,yx=`
<svg
  class="lucide lucide-watch"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 10v2.2l1.6 1" />
  <path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05" />
  <path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05" />
  <circle cx="12" cy="12" r="6" />
</svg>
`,yy=`
<svg
  class="lucide lucide-waves-ladder"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M19 5a2 2 0 0 0-2 2v11" />
  <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  <path d="M7 13h10" />
  <path d="M7 9h10" />
  <path d="M9 5a2 2 0 0 0-2 2v11" />
</svg>
`,yz=`
<svg
  class="lucide lucide-waves"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
</svg>
`,yA=`
<svg
  class="lucide lucide-waypoints"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="4.5" r="2.5" />
  <path d="m10.2 6.3-3.9 3.9" />
  <circle cx="4.5" cy="12" r="2.5" />
  <path d="M7 12h10" />
  <circle cx="19.5" cy="12" r="2.5" />
  <path d="m13.8 17.7 3.9-3.9" />
  <circle cx="12" cy="19.5" r="2.5" />
</svg>
`,yB=`
<svg
  class="lucide lucide-webcam"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="10" r="8" />
  <circle cx="12" cy="10" r="3" />
  <path d="M7 22h10" />
  <path d="M12 22v-4" />
</svg>
`,yC=`
<svg
  class="lucide lucide-webhook-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M17 17h-5c-1.09-.02-1.94.92-2.5 1.9A3 3 0 1 1 2.57 15" />
  <path d="M9 3.4a4 4 0 0 1 6.52.66" />
  <path d="m6 17 3.1-5.8a2.5 2.5 0 0 0 .057-2.05" />
  <path d="M20.3 20.3a4 4 0 0 1-2.3.7" />
  <path d="M18.6 13a4 4 0 0 1 3.357 3.414" />
  <path d="m12 6 .6 1" />
  <path d="m2 2 20 20" />
</svg>
`,yD=`
<svg
  class="lucide lucide-webhook"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
  <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
  <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
</svg>
`,yE=`
<svg
  class="lucide lucide-weight"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="5" r="3" />
  <path d="M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z" />
</svg>
`,yF=`
<svg
  class="lucide lucide-wheat-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m2 22 10-10" />
  <path d="m16 8-1.17 1.17" />
  <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
  <path d="m8 8-.53.53a3.5 3.5 0 0 0 0 4.94L9 15l1.53-1.53c.55-.55.88-1.25.98-1.97" />
  <path d="M10.91 5.26c.15-.26.34-.51.56-.73L13 3l1.53 1.53a3.5 3.5 0 0 1 .28 4.62" />
  <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" />
  <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />
  <path d="m16 16-.53.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.49 3.49 0 0 1 1.97-.98" />
  <path d="M18.74 13.09c.26-.15.51-.34.73-.56L21 11l-1.53-1.53a3.5 3.5 0 0 0-4.62-.28" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,yG=`
<svg
  class="lucide lucide-wheat"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 22 16 8" />
  <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
  <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
  <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
  <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" />
  <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />
  <path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />
  <path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />
</svg>
`,yH=`
<svg
  class="lucide lucide-whole-word"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="7" cy="12" r="3" />
  <path d="M10 9v6" />
  <circle cx="17" cy="12" r="3" />
  <path d="M14 7v8" />
  <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
</svg>
`,yI=`
<svg
  class="lucide lucide-wifi-cog"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m14.305 19.53.923-.382" />
  <path d="m15.228 16.852-.923-.383" />
  <path d="m16.852 15.228-.383-.923" />
  <path d="m16.852 20.772-.383.924" />
  <path d="m19.148 15.228.383-.923" />
  <path d="m19.53 21.696-.382-.924" />
  <path d="M2 7.82a15 15 0 0 1 20 0" />
  <path d="m20.772 16.852.924-.383" />
  <path d="m20.772 19.148.924.383" />
  <path d="M5 11.858a10 10 0 0 1 11.5-1.785" />
  <path d="M8.5 15.429a5 5 0 0 1 2.413-1.31" />
  <circle cx="18" cy="18" r="3" />
</svg>
`,yJ=`
<svg
  class="lucide lucide-wifi-high"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h.01" />
  <path d="M5 12.859a10 10 0 0 1 14 0" />
  <path d="M8.5 16.429a5 5 0 0 1 7 0" />
</svg>
`,yK=`
<svg
  class="lucide lucide-wifi-low"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h.01" />
  <path d="M8.5 16.429a5 5 0 0 1 7 0" />
</svg>
`,yL=`
<svg
  class="lucide lucide-wifi-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h.01" />
  <path d="M8.5 16.429a5 5 0 0 1 7 0" />
  <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
  <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
  <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
  <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
  <path d="m2 2 20 20" />
</svg>
`,yM=`
<svg
  class="lucide lucide-wifi-pen"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 8.82a15 15 0 0 1 20 0" />
  <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  <path d="M5 12.859a10 10 0 0 1 10.5-2.222" />
  <path d="M8.5 16.429a5 5 0 0 1 3-1.406" />
</svg>
`,yN=`
<svg
  class="lucide lucide-wifi-sync"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M11.965 10.105v4L13.5 12.5a5 5 0 0 1 8 1.5" />
  <path d="M11.965 14.105h4" />
  <path d="M17.965 18.105h4L20.43 19.71a5 5 0 0 1-8-1.5" />
  <path d="M2 8.82a15 15 0 0 1 20 0" />
  <path d="M21.965 22.105v-4" />
  <path d="M5 12.86a10 10 0 0 1 3-2.032" />
  <path d="M8.5 16.429h.01" />
</svg>
`,yO=`
<svg
  class="lucide lucide-wifi-zero"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h.01" />
</svg>
`,yP=`
<svg
  class="lucide lucide-wifi"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12 20h.01" />
  <path d="M2 8.82a15 15 0 0 1 20 0" />
  <path d="M5 12.859a10 10 0 0 1 14 0" />
  <path d="M8.5 16.429a5 5 0 0 1 7 0" />
</svg>
`,yQ=`
<svg
  class="lucide lucide-wind-arrow-down"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v8" />
  <path d="M12.8 21.6A2 2 0 1 0 14 18H2" />
  <path d="M17.5 10a2.5 2.5 0 1 1 2 4H2" />
  <path d="m6 6 4 4 4-4" />
</svg>
`,yR=`
<svg
  class="lucide lucide-wind"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
  <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
  <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
</svg>
`,yS=`
<svg
  class="lucide lucide-wine-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 22h8" />
  <path d="M7 10h3m7 0h-1.343" />
  <path d="M12 15v7" />
  <path d="M7.307 7.307A12.33 12.33 0 0 0 7 10a5 5 0 0 0 7.391 4.391M8.638 2.981C8.75 2.668 8.872 2.34 9 2h6c1.5 4 2 6 2 8 0 .407-.05.809-.145 1.198" />
  <line x1="2" x2="22" y1="2" y2="22" />
</svg>
`,yT=`
<svg
  class="lucide lucide-wine"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M8 22h8" />
  <path d="M7 10h10" />
  <path d="M12 15v7" />
  <path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z" />
</svg>
`,yU=`
<svg
  class="lucide lucide-workflow"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="8" height="8" x="3" y="3" rx="2" />
  <path d="M7 11v4a2 2 0 0 0 2 2h4" />
  <rect width="8" height="8" x="13" y="13" rx="2" />
</svg>
`,yV=`
<svg
  class="lucide lucide-worm"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m19 12-1.5 3" />
  <path d="M19.63 18.81 22 20" />
  <path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z" />
</svg>
`,yW=`
<svg
  class="lucide lucide-wrench"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
</svg>
`,yX=`
<svg
  class="lucide lucide-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</svg>
`,yY=`
<svg
  class="lucide lucide-youtube"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
  <path d="m10 15 5-3-5-3z" />
</svg>
`,yZ=`
<svg
  class="lucide lucide-zap-off"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10.513 4.856 13.12 2.17a.5.5 0 0 1 .86.46l-1.377 4.317" />
  <path d="M15.656 10H20a1 1 0 0 1 .78 1.63l-1.72 1.773" />
  <path d="M16.273 16.273 10.88 21.83a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14H4a1 1 0 0 1-.78-1.63l4.507-4.643" />
  <path d="m2 2 20 20" />
</svg>
`,y$=`
<svg
  class="lucide lucide-zap"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
</svg>
`,y_=`
<svg
  class="lucide lucide-zoom-in"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="11" r="8" />
  <line x1="21" x2="16.65" y1="21" y2="16.65" />
  <line x1="11" x2="11" y1="8" y2="14" />
  <line x1="8" x2="14" y1="11" y2="11" />
</svg>
`,y0=`
<svg
  class="lucide lucide-zoom-out"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="11" r="8" />
  <line x1="21" x2="16.65" y1="21" y2="16.65" />
  <line x1="8" x2="14" y1="11" y2="11" />
</svg>
`;a.s(["AArrowDown",()=>b,"AArrowUp",()=>c,"ALargeSmall",()=>d,"Accessibility",()=>e,"Activity",()=>f,"ActivitySquare",()=>um,"AirVent",()=>g,"Airplay",()=>h,"AlarmCheck",()=>i,"AlarmClock",()=>m,"AlarmClockCheck",()=>i,"AlarmClockMinus",()=>j,"AlarmClockOff",()=>k,"AlarmClockPlus",()=>l,"AlarmMinus",()=>j,"AlarmPlus",()=>l,"AlarmSmoke",()=>n,"Album",()=>o,"AlertCircle",()=>eF,"AlertOctagon",()=>pI,"AlertTriangle",()=>xd,"AlignCenter",()=>wl,"AlignCenterHorizontal",()=>p,"AlignCenterVertical",()=>q,"AlignEndHorizontal",()=>r,"AlignEndVertical",()=>s,"AlignHorizontalDistributeCenter",()=>t,"AlignHorizontalDistributeEnd",()=>u,"AlignHorizontalDistributeStart",()=>w,"AlignHorizontalJustifyCenter",()=>x,"AlignHorizontalJustifyEnd",()=>y,"AlignHorizontalJustifyStart",()=>z,"AlignHorizontalSpaceAround",()=>A,"AlignHorizontalSpaceBetween",()=>B,"AlignJustify",()=>wn,"AlignLeft",()=>wo,"AlignRight",()=>wm,"AlignStartHorizontal",()=>C,"AlignStartVertical",()=>D,"AlignVerticalDistributeCenter",()=>E,"AlignVerticalDistributeEnd",()=>F,"AlignVerticalDistributeStart",()=>G,"AlignVerticalJustifyCenter",()=>H,"AlignVerticalJustifyEnd",()=>I,"AlignVerticalJustifyStart",()=>J,"AlignVerticalSpaceAround",()=>K,"AlignVerticalSpaceBetween",()=>M,"Ambulance",()=>L,"Ampersand",()=>N,"Ampersands",()=>O,"Amphora",()=>P,"Anchor",()=>Q,"Angry",()=>R,"Annoyed",()=>T,"Antenna",()=>S,"Anvil",()=>U,"Aperture",()=>W,"AppWindow",()=>X,"AppWindowMac",()=>V,"Apple",()=>Y,"Archive",()=>_,"ArchiveRestore",()=>Z,"ArchiveX",()=>$,"AreaChart",()=>dW,"Armchair",()=>aa,"ArrowBigDown",()=>ac,"ArrowBigDownDash",()=>ab,"ArrowBigLeft",()=>ae,"ArrowBigLeftDash",()=>ad,"ArrowBigRight",()=>ag,"ArrowBigRightDash",()=>af,"ArrowBigUp",()=>ai,"ArrowBigUpDash",()=>ah,"ArrowDown",()=>aw,"ArrowDown01",()=>aj,"ArrowDown10",()=>ak,"ArrowDownAZ",()=>al,"ArrowDownAz",()=>al,"ArrowDownCircle",()=>eG,"ArrowDownFromLine",()=>am,"ArrowDownLeft",()=>an,"ArrowDownLeftFromCircle",()=>eJ,"ArrowDownLeftFromSquare",()=>ur,"ArrowDownLeftSquare",()=>un,"ArrowDownNarrowWide",()=>ao,"ArrowDownRight",()=>ap,"ArrowDownRightFromCircle",()=>eI,"ArrowDownRightFromSquare",()=>us,"ArrowDownRightSquare",()=>uo,"ArrowDownSquare",()=>up,"ArrowDownToDot",()=>aq,"ArrowDownToLine",()=>ar,"ArrowDownUp",()=>as,"ArrowDownWideNarrow",()=>at,"ArrowDownZA",()=>au,"ArrowDownZa",()=>au,"ArrowLeft",()=>az,"ArrowLeftCircle",()=>eH,"ArrowLeftFromLine",()=>av,"ArrowLeftRight",()=>ax,"ArrowLeftSquare",()=>uq,"ArrowLeftToLine",()=>ay,"ArrowRight",()=>aD,"ArrowRightCircle",()=>eM,"ArrowRightFromLine",()=>aA,"ArrowRightLeft",()=>aB,"ArrowRightSquare",()=>uv,"ArrowRightToLine",()=>aC,"ArrowUp",()=>aQ,"ArrowUp01",()=>aE,"ArrowUp10",()=>aF,"ArrowUpAZ",()=>aH,"ArrowUpAz",()=>aH,"ArrowUpCircle",()=>eN,"ArrowUpDown",()=>aG,"ArrowUpFromDot",()=>aI,"ArrowUpFromLine",()=>aJ,"ArrowUpLeft",()=>aK,"ArrowUpLeftFromCircle",()=>eK,"ArrowUpLeftFromSquare",()=>ut,"ArrowUpLeftSquare",()=>uw,"ArrowUpNarrowWide",()=>aL,"ArrowUpRight",()=>aM,"ArrowUpRightFromCircle",()=>eL,"ArrowUpRightFromSquare",()=>uu,"ArrowUpRightSquare",()=>uy,"ArrowUpSquare",()=>ux,"ArrowUpToLine",()=>aN,"ArrowUpWideNarrow",()=>aO,"ArrowUpZA",()=>aP,"ArrowUpZa",()=>aP,"ArrowsUpFromLine",()=>aR,"Asterisk",()=>aS,"AsteriskSquare",()=>uz,"AtSign",()=>aT,"Atom",()=>aU,"AudioLines",()=>aV,"AudioWaveform",()=>aW,"Award",()=>aX,"Axe",()=>aY,"Axis3D",()=>a$,"Axis3d",()=>a$,"Baby",()=>aZ,"Backpack",()=>a_,"Badge",()=>bh,"BadgeAlert",()=>a0,"BadgeCent",()=>a1,"BadgeCheck",()=>a2,"BadgeDollarSign",()=>a3,"BadgeEuro",()=>a4,"BadgeHelp",()=>bc,"BadgeIndianRupee",()=>a5,"BadgeInfo",()=>a6,"BadgeJapaneseYen",()=>a7,"BadgeMinus",()=>a8,"BadgePercent",()=>a9,"BadgePlus",()=>ba,"BadgePoundSterling",()=>bb,"BadgeQuestionMark",()=>bc,"BadgeRussianRuble",()=>bd,"BadgeSwissFranc",()=>be,"BadgeTurkishLira",()=>bg,"BadgeX",()=>bf,"BaggageClaim",()=>bi,"Ban",()=>bk,"Banana",()=>bj,"Bandage",()=>bl,"Banknote",()=>bp,"BanknoteArrowDown",()=>bn,"BanknoteArrowUp",()=>bm,"BanknoteX",()=>bo,"BarChart",()=>ea,"BarChart2",()=>eb,"BarChart3",()=>d5,"BarChart4",()=>d3,"BarChartBig",()=>d1,"BarChartHorizontal",()=>d_,"BarChartHorizontalBig",()=>dX,"Barcode",()=>br,"Barrel",()=>bq,"Baseline",()=>bs,"Bath",()=>bt,"Battery",()=>bA,"BatteryCharging",()=>bu,"BatteryFull",()=>bv,"BatteryLow",()=>bw,"BatteryMedium",()=>bx,"BatteryPlus",()=>by,"BatteryWarning",()=>bz,"Beaker",()=>bB,"Bean",()=>bD,"BeanOff",()=>bC,"Bed",()=>bH,"BedDouble",()=>bE,"BedSingle",()=>bF,"Beef",()=>bG,"Beer",()=>bJ,"BeerOff",()=>bI,"Bell",()=>bR,"BellDot",()=>bK,"BellElectric",()=>bM,"BellMinus",()=>bL,"BellOff",()=>bN,"BellPlus",()=>bO,"BellRing",()=>bP,"BetweenHorizonalEnd",()=>bQ,"BetweenHorizonalStart",()=>bS,"BetweenHorizontalEnd",()=>bQ,"BetweenHorizontalStart",()=>bS,"BetweenVerticalEnd",()=>bT,"BetweenVerticalStart",()=>bU,"BicepsFlexed",()=>bV,"Bike",()=>bW,"Binary",()=>bX,"Binoculars",()=>bY,"Biohazard",()=>bZ,"Bird",()=>b$,"Birdhouse",()=>b_,"Bitcoin",()=>b0,"Blend",()=>b1,"Blinds",()=>b2,"Blocks",()=>b3,"Bluetooth",()=>b7,"BluetoothConnected",()=>b5,"BluetoothOff",()=>b4,"BluetoothSearching",()=>b6,"Bold",()=>b8,"Bolt",()=>b9,"Bomb",()=>ca,"Bone",()=>cb,"Book",()=>cA,"BookA",()=>cc,"BookAlert",()=>cd,"BookAudio",()=>ce,"BookCheck",()=>cf,"BookCopy",()=>ch,"BookDashed",()=>cg,"BookDown",()=>ci,"BookHeadphones",()=>cj,"BookHeart",()=>ck,"BookImage",()=>cl,"BookKey",()=>cm,"BookLock",()=>cn,"BookMarked",()=>co,"BookMinus",()=>cp,"BookOpen",()=>cs,"BookOpenCheck",()=>cq,"BookOpenText",()=>cr,"BookPlus",()=>ct,"BookTemplate",()=>cg,"BookText",()=>cu,"BookType",()=>cv,"BookUp",()=>cy,"BookUp2",()=>cw,"BookUser",()=>cx,"BookX",()=>cz,"Bookmark",()=>cE,"BookmarkCheck",()=>cC,"BookmarkMinus",()=>cB,"BookmarkPlus",()=>cD,"BookmarkX",()=>cF,"BoomBox",()=>cH,"Bot",()=>cJ,"BotMessageSquare",()=>cG,"BotOff",()=>cI,"BottleWine",()=>cK,"BowArrow",()=>cL,"Box",()=>cM,"BoxSelect",()=>uO,"Boxes",()=>cN,"Braces",()=>cO,"Brackets",()=>cP,"Brain",()=>cS,"BrainCircuit",()=>cR,"BrainCog",()=>cQ,"BrickWall",()=>cV,"BrickWallFire",()=>cU,"BrickWallShield",()=>cT,"Briefcase",()=>cZ,"BriefcaseBusiness",()=>cW,"BriefcaseConveyorBelt",()=>cX,"BriefcaseMedical",()=>cY,"BringToFront",()=>c$,"Brush",()=>c0,"BrushCleaning",()=>c_,"Bubbles",()=>c1,"Bug",()=>c4,"BugOff",()=>c2,"BugPlay",()=>c3,"Building",()=>c6,"Building2",()=>c5,"Bus",()=>c8,"BusFront",()=>c7,"Cable",()=>da,"CableCar",()=>c9,"Cake",()=>dc,"CakeSlice",()=>db,"Calculator",()=>dd,"Calendar",()=>dz,"Calendar1",()=>de,"CalendarArrowDown",()=>df,"CalendarArrowUp",()=>dg,"CalendarCheck",()=>di,"CalendarCheck2",()=>dh,"CalendarClock",()=>dj,"CalendarCog",()=>dk,"CalendarDays",()=>dl,"CalendarFold",()=>dn,"CalendarHeart",()=>dm,"CalendarMinus",()=>dq,"CalendarMinus2",()=>dp,"CalendarOff",()=>dr,"CalendarPlus",()=>dt,"CalendarPlus2",()=>ds,"CalendarRange",()=>du,"CalendarSearch",()=>dv,"CalendarSync",()=>dw,"CalendarX",()=>dy,"CalendarX2",()=>dx,"Camera",()=>dB,"CameraOff",()=>dA,"CandlestickChart",()=>d0,"Candy",()=>dE,"CandyCane",()=>dD,"CandyOff",()=>dC,"Cannabis",()=>dF,"Captions",()=>dH,"CaptionsOff",()=>dG,"Car",()=>dK,"CarFront",()=>dI,"CarTaxiFront",()=>dJ,"Caravan",()=>dL,"CardSim",()=>dM,"Carrot",()=>dN,"CaseLower",()=>dO,"CaseSensitive",()=>dP,"CaseUpper",()=>dQ,"CassetteTape",()=>dR,"Cast",()=>dS,"Castle",()=>dT,"Cat",()=>dU,"Cctv",()=>dV,"ChartArea",()=>dW,"ChartBar",()=>d_,"ChartBarBig",()=>dX,"ChartBarDecreasing",()=>dY,"ChartBarIncreasing",()=>dZ,"ChartBarStacked",()=>d$,"ChartCandlestick",()=>d0,"ChartColumn",()=>d5,"ChartColumnBig",()=>d1,"ChartColumnDecreasing",()=>d2,"ChartColumnIncreasing",()=>d3,"ChartColumnStacked",()=>d4,"ChartGantt",()=>d6,"ChartLine",()=>d8,"ChartNetwork",()=>d9,"ChartNoAxesColumn",()=>eb,"ChartNoAxesColumnDecreasing",()=>d7,"ChartNoAxesColumnIncreasing",()=>ea,"ChartNoAxesCombined",()=>ec,"ChartNoAxesGantt",()=>ed,"ChartPie",()=>ee,"ChartScatter",()=>ef,"ChartSpline",()=>eg,"Check",()=>ej,"CheckCheck",()=>eh,"CheckCircle",()=>eO,"CheckCircle2",()=>eP,"CheckLine",()=>ei,"CheckSquare",()=>uB,"CheckSquare2",()=>uD,"ChefHat",()=>ek,"Cherry",()=>el,"ChevronDown",()=>em,"ChevronDownCircle",()=>eQ,"ChevronDownSquare",()=>uE,"ChevronFirst",()=>en,"ChevronLast",()=>eo,"ChevronLeft",()=>ep,"ChevronLeftCircle",()=>eR,"ChevronLeftSquare",()=>uF,"ChevronRight",()=>eq,"ChevronRightCircle",()=>eS,"ChevronRightSquare",()=>uG,"ChevronUp",()=>er,"ChevronUpCircle",()=>eT,"ChevronUpSquare",()=>uH,"ChevronsDown",()=>et,"ChevronsDownUp",()=>es,"ChevronsLeft",()=>ex,"ChevronsLeftRight",()=>eu,"ChevronsLeftRightEllipsis",()=>ev,"ChevronsRight",()=>ew,"ChevronsRightLeft",()=>ey,"ChevronsUp",()=>eB,"ChevronsUpDown",()=>ez,"Chrome",()=>eA,"Chromium",()=>eA,"Church",()=>eC,"Cigarette",()=>eE,"CigaretteOff",()=>eD,"Circle",()=>fl,"CircleAlert",()=>eF,"CircleArrowDown",()=>eG,"CircleArrowLeft",()=>eH,"CircleArrowOutDownLeft",()=>eJ,"CircleArrowOutDownRight",()=>eI,"CircleArrowOutUpLeft",()=>eK,"CircleArrowOutUpRight",()=>eL,"CircleArrowRight",()=>eM,"CircleArrowUp",()=>eN,"CircleCheck",()=>eP,"CircleCheckBig",()=>eO,"CircleChevronDown",()=>eQ,"CircleChevronLeft",()=>eR,"CircleChevronRight",()=>eS,"CircleChevronUp",()=>eT,"CircleDashed",()=>eU,"CircleDivide",()=>eV,"CircleDollarSign",()=>eX,"CircleDot",()=>eY,"CircleDotDashed",()=>eW,"CircleEllipsis",()=>eZ,"CircleEqual",()=>e$,"CircleFadingArrowUp",()=>e_,"CircleFadingPlus",()=>e0,"CircleGauge",()=>e1,"CircleHelp",()=>fc,"CircleMinus",()=>e2,"CircleOff",()=>e3,"CircleParking",()=>e5,"CircleParkingOff",()=>e4,"CirclePause",()=>e7,"CirclePercent",()=>e6,"CirclePlay",()=>e8,"CirclePlus",()=>e9,"CirclePoundSterling",()=>fa,"CirclePower",()=>fb,"CircleQuestionMark",()=>fc,"CircleSlash",()=>fd,"CircleSlash2",()=>fe,"CircleSlashed",()=>fe,"CircleSmall",()=>ff,"CircleStar",()=>fh,"CircleStop",()=>fg,"CircleUser",()=>fk,"CircleUserRound",()=>fi,"CircleX",()=>fj,"CircuitBoard",()=>fm,"Citrus",()=>fn,"Clapperboard",()=>fo,"Clipboard",()=>fA,"ClipboardCheck",()=>fp,"ClipboardClock",()=>fq,"ClipboardCopy",()=>fr,"ClipboardEdit",()=>fw,"ClipboardList",()=>fs,"ClipboardMinus",()=>ft,"ClipboardPaste",()=>fu,"ClipboardPen",()=>fw,"ClipboardPenLine",()=>fv,"ClipboardPlus",()=>fx,"ClipboardSignature",()=>fv,"ClipboardType",()=>fy,"ClipboardX",()=>fz,"Clock",()=>fT,"Clock1",()=>fB,"Clock10",()=>fC,"Clock11",()=>fD,"Clock12",()=>fE,"Clock2",()=>fF,"Clock3",()=>fG,"Clock4",()=>fH,"Clock5",()=>fI,"Clock6",()=>fJ,"Clock7",()=>fK,"Clock8",()=>fL,"Clock9",()=>fM,"ClockAlert",()=>fN,"ClockArrowDown",()=>fO,"ClockArrowUp",()=>fP,"ClockCheck",()=>fQ,"ClockFading",()=>fS,"ClockPlus",()=>fR,"ClosedCaption",()=>fU,"Cloud",()=>ga,"CloudAlert",()=>fV,"CloudCheck",()=>fW,"CloudCog",()=>fX,"CloudDownload",()=>fY,"CloudDrizzle",()=>fZ,"CloudFog",()=>f$,"CloudHail",()=>f_,"CloudLightning",()=>f0,"CloudMoon",()=>f3,"CloudMoonRain",()=>f1,"CloudOff",()=>f2,"CloudRain",()=>f5,"CloudRainWind",()=>f4,"CloudSnow",()=>f6,"CloudSun",()=>f8,"CloudSunRain",()=>f7,"CloudUpload",()=>f9,"Cloudy",()=>gb,"Clover",()=>gc,"Club",()=>gd,"Code",()=>gf,"Code2",()=>ge,"CodeSquare",()=>uI,"CodeXml",()=>ge,"Codepen",()=>gg,"Codesandbox",()=>gh,"Coffee",()=>gj,"Cog",()=>gi,"Coins",()=>gk,"Columns",()=>gl,"Columns2",()=>gl,"Columns3",()=>gn,"Columns3Cog",()=>gm,"Columns4",()=>go,"ColumnsSettings",()=>gm,"Combine",()=>gp,"Command",()=>gq,"Compass",()=>gr,"Component",()=>gt,"Computer",()=>gs,"ConciergeBell",()=>gu,"Cone",()=>gv,"Construction",()=>gw,"Contact",()=>gy,"Contact2",()=>gx,"ContactRound",()=>gx,"Container",()=>gz,"Contrast",()=>gA,"Cookie",()=>gB,"CookingPot",()=>gC,"Copy",()=>gI,"CopyCheck",()=>gE,"CopyMinus",()=>gD,"CopyPlus",()=>gF,"CopySlash",()=>gG,"CopyX",()=>gH,"Copyleft",()=>gJ,"Copyright",()=>gK,"CornerDownLeft",()=>gL,"CornerDownRight",()=>gM,"CornerLeftDown",()=>gN,"CornerLeftUp",()=>gO,"CornerRightDown",()=>gQ,"CornerRightUp",()=>gP,"CornerUpLeft",()=>gR,"CornerUpRight",()=>gS,"Cpu",()=>gT,"CreativeCommons",()=>gU,"CreditCard",()=>gW,"Croissant",()=>gV,"Crop",()=>gX,"Cross",()=>gY,"Crosshair",()=>gZ,"Crown",()=>g$,"Cuboid",()=>g_,"CupSoda",()=>g0,"CurlyBraces",()=>cO,"Currency",()=>g1,"Cylinder",()=>g2,"Dam",()=>g3,"Database",()=>g6,"DatabaseBackup",()=>g5,"DatabaseZap",()=>g4,"DecimalsArrowLeft",()=>g7,"DecimalsArrowRight",()=>g8,"Delete",()=>ha,"Dessert",()=>g9,"Diameter",()=>hb,"Diamond",()=>hf,"DiamondMinus",()=>hc,"DiamondPercent",()=>hd,"DiamondPlus",()=>he,"Dice1",()=>hh,"Dice2",()=>hg,"Dice3",()=>hi,"Dice4",()=>hj,"Dice5",()=>hk,"Dice6",()=>hl,"Dices",()=>hn,"Diff",()=>hm,"Disc",()=>hr,"Disc2",()=>ho,"Disc3",()=>hp,"DiscAlbum",()=>hq,"Divide",()=>hs,"DivideCircle",()=>eV,"DivideSquare",()=>uP,"Dna",()=>hu,"DnaOff",()=>ht,"Dock",()=>hv,"Dog",()=>hw,"DollarSign",()=>hx,"Donut",()=>hy,"DoorClosed",()=>hA,"DoorClosedLocked",()=>hz,"DoorOpen",()=>hB,"Dot",()=>hC,"DotSquare",()=>uQ,"Download",()=>hD,"DownloadCloud",()=>fY,"DraftingCompass",()=>hE,"Drama",()=>hF,"Dribbble",()=>hH,"Drill",()=>hG,"Drone",()=>hI,"Droplet",()=>hK,"DropletOff",()=>hJ,"Droplets",()=>hL,"Drum",()=>hM,"Drumstick",()=>hN,"Dumbbell",()=>hO,"Ear",()=>hQ,"EarOff",()=>hP,"Earth",()=>hS,"EarthLock",()=>hR,"Eclipse",()=>hT,"Edit",()=>u_,"Edit2",()=>qy,"Edit3",()=>qv,"Egg",()=>hW,"EggFried",()=>hV,"EggOff",()=>hU,"Ellipsis",()=>hY,"EllipsisVertical",()=>hX,"Equal",()=>h_,"EqualApproximately",()=>hZ,"EqualNot",()=>h$,"EqualSquare",()=>uR,"Eraser",()=>h1,"EthernetPort",()=>h0,"Euro",()=>h2,"EvCharger",()=>h4,"Expand",()=>h3,"ExternalLink",()=>h5,"Eye",()=>h8,"EyeClosed",()=>h6,"EyeOff",()=>h7,"Facebook",()=>h9,"Factory",()=>ia,"Fan",()=>ib,"FastForward",()=>ic,"Feather",()=>id,"Fence",()=>ie,"FerrisWheel",()=>ig,"Figma",()=>ih,"File",()=>i9,"FileArchive",()=>ii,"FileAudio",()=>iC,"FileAudio2",()=>iC,"FileAxis3D",()=>ik,"FileAxis3d",()=>ik,"FileBadge",()=>ij,"FileBadge2",()=>ij,"FileBarChart",()=>ip,"FileBarChart2",()=>iq,"FileBox",()=>il,"FileBraces",()=>io,"FileBracesCorner",()=>im,"FileChartColumn",()=>iq,"FileChartColumnIncreasing",()=>ip,"FileChartLine",()=>ir,"FileChartPie",()=>is,"FileCheck",()=>iu,"FileCheck2",()=>it,"FileCheckCorner",()=>it,"FileClock",()=>iv,"FileCode",()=>ix,"FileCode2",()=>iw,"FileCodeCorner",()=>iw,"FileCog",()=>iy,"FileCog2",()=>iy,"FileDiff",()=>iz,"FileDigit",()=>iA,"FileDown",()=>iB,"FileEdit",()=>iO,"FileExclamationPoint",()=>iD,"FileHeadphone",()=>iC,"FileHeart",()=>iE,"FileImage",()=>iF,"FileInput",()=>iG,"FileJson",()=>io,"FileJson2",()=>im,"FileKey",()=>iH,"FileKey2",()=>iH,"FileLineChart",()=>ir,"FileLock",()=>iI,"FileLock2",()=>iI,"FileMinus",()=>iK,"FileMinus2",()=>iJ,"FileMinusCorner",()=>iJ,"FileMusic",()=>iL,"FileOutput",()=>iM,"FilePen",()=>iO,"FilePenLine",()=>iN,"FilePieChart",()=>is,"FilePlay",()=>iP,"FilePlus",()=>iR,"FilePlus2",()=>iQ,"FilePlusCorner",()=>iQ,"FileQuestion",()=>iT,"FileQuestionMark",()=>iT,"FileScan",()=>iS,"FileSearch",()=>iV,"FileSearch2",()=>iU,"FileSearchCorner",()=>iU,"FileSignal",()=>iW,"FileSignature",()=>iN,"FileSliders",()=>iY,"FileSpreadsheet",()=>iX,"FileStack",()=>iZ,"FileSymlink",()=>i$,"FileTerminal",()=>i0,"FileText",()=>i_,"FileType",()=>i2,"FileType2",()=>i1,"FileTypeCorner",()=>i1,"FileUp",()=>i3,"FileUser",()=>i4,"FileVideo",()=>iP,"FileVideo2",()=>i5,"FileVideoCamera",()=>i5,"FileVolume",()=>i6,"FileVolume2",()=>iW,"FileWarning",()=>iD,"FileX",()=>i8,"FileX2",()=>i7,"FileXCorner",()=>i7,"Files",()=>ja,"Film",()=>jb,"Filter",()=>ke,"FilterX",()=>kd,"Fingerprint",()=>jc,"FireExtinguisher",()=>jd,"Fish",()=>jg,"FishOff",()=>je,"FishSymbol",()=>jf,"Flag",()=>jk,"FlagOff",()=>ji,"FlagTriangleLeft",()=>jh,"FlagTriangleRight",()=>jj,"Flame",()=>jm,"FlameKindling",()=>jl,"Flashlight",()=>jp,"FlashlightOff",()=>jn,"FlaskConical",()=>jr,"FlaskConicalOff",()=>jo,"FlaskRound",()=>jq,"FlipHorizontal",()=>jt,"FlipHorizontal2",()=>js,"FlipVertical",()=>jv,"FlipVertical2",()=>ju,"Flower",()=>jw,"Flower2",()=>jx,"Focus",()=>jy,"FoldHorizontal",()=>jA,"FoldVertical",()=>jz,"Folder",()=>j2,"FolderArchive",()=>jB,"FolderCheck",()=>jC,"FolderClock",()=>jD,"FolderClosed",()=>jE,"FolderCode",()=>jF,"FolderCog",()=>jG,"FolderCog2",()=>jG,"FolderDot",()=>jH,"FolderDown",()=>jJ,"FolderEdit",()=>jU,"FolderGit",()=>jK,"FolderGit2",()=>jI,"FolderHeart",()=>jL,"FolderInput",()=>jM,"FolderKanban",()=>jO,"FolderKey",()=>jN,"FolderLock",()=>jQ,"FolderMinus",()=>jP,"FolderOpen",()=>jS,"FolderOpenDot",()=>jR,"FolderOutput",()=>jT,"FolderPen",()=>jU,"FolderPlus",()=>jV,"FolderRoot",()=>jW,"FolderSearch",()=>jZ,"FolderSearch2",()=>jX,"FolderSymlink",()=>jY,"FolderSync",()=>j$,"FolderTree",()=>j_,"FolderUp",()=>j0,"FolderX",()=>j1,"Folders",()=>j3,"Footprints",()=>j4,"ForkKnife",()=>x2,"ForkKnifeCrossed",()=>x0,"Forklift",()=>j5,"FormInput",()=>rP,"Forward",()=>j7,"Frame",()=>j6,"Framer",()=>j8,"Frown",()=>ka,"Fuel",()=>kb,"Fullscreen",()=>j9,"FunctionSquare",()=>uS,"Funnel",()=>ke,"FunnelPlus",()=>kc,"FunnelX",()=>kd,"GalleryHorizontal",()=>kg,"GalleryHorizontalEnd",()=>kf,"GalleryThumbnails",()=>ki,"GalleryVertical",()=>kj,"GalleryVerticalEnd",()=>kh,"Gamepad",()=>km,"Gamepad2",()=>kk,"GamepadDirectional",()=>kl,"GanttChart",()=>ed,"GanttChartSquare",()=>uC,"Gauge",()=>kn,"GaugeCircle",()=>e1,"Gavel",()=>ko,"Gem",()=>kp,"GeorgianLari",()=>kq,"Ghost",()=>kr,"Gift",()=>ks,"GitBranch",()=>kv,"GitBranchMinus",()=>kt,"GitBranchPlus",()=>ku,"GitCommit",()=>kz,"GitCommitHorizontal",()=>kz,"GitCommitVertical",()=>kw,"GitCompare",()=>ky,"GitCompareArrows",()=>kx,"GitFork",()=>kC,"GitGraph",()=>kA,"GitMerge",()=>kB,"GitPullRequest",()=>kH,"GitPullRequestArrow",()=>kD,"GitPullRequestClosed",()=>kE,"GitPullRequestCreate",()=>kI,"GitPullRequestCreateArrow",()=>kF,"GitPullRequestDraft",()=>kG,"Github",()=>kJ,"Gitlab",()=>kK,"GlassWater",()=>kL,"Glasses",()=>kN,"Globe",()=>kO,"Globe2",()=>hS,"GlobeLock",()=>kM,"Goal",()=>kQ,"Gpu",()=>kP,"Grab",()=>k7,"GraduationCap",()=>kR,"Grape",()=>kS,"Grid",()=>kY,"Grid2X2",()=>kW,"Grid2X2Check",()=>kT,"Grid2X2Plus",()=>kU,"Grid2X2X",()=>kV,"Grid2x2",()=>kW,"Grid2x2Check",()=>kT,"Grid2x2Plus",()=>kU,"Grid2x2X",()=>kV,"Grid3X3",()=>kY,"Grid3x2",()=>kX,"Grid3x3",()=>kY,"Grip",()=>k_,"GripHorizontal",()=>kZ,"GripVertical",()=>k$,"Group",()=>k0,"Guitar",()=>k1,"Ham",()=>k2,"Hamburger",()=>k3,"Hammer",()=>k4,"Hand",()=>lc,"HandCoins",()=>k5,"HandFist",()=>k6,"HandGrab",()=>k7,"HandHeart",()=>k8,"HandHelping",()=>k9,"HandMetal",()=>la,"HandPlatter",()=>lb,"Handbag",()=>le,"Handshake",()=>ld,"HardDrive",()=>lh,"HardDriveDownload",()=>lf,"HardDriveUpload",()=>lg,"HardHat",()=>li,"Hash",()=>lj,"HatGlasses",()=>lk,"Haze",()=>ll,"HdmiPort",()=>ln,"Heading",()=>lt,"Heading1",()=>lm,"Heading2",()=>lo,"Heading3",()=>lp,"Heading4",()=>lq,"Heading5",()=>lr,"Heading6",()=>ls,"HeadphoneOff",()=>lu,"Headphones",()=>lv,"Headset",()=>lw,"Heart",()=>lD,"HeartCrack",()=>lx,"HeartHandshake",()=>ly,"HeartMinus",()=>lz,"HeartOff",()=>lA,"HeartPlus",()=>lB,"HeartPulse",()=>lC,"Heater",()=>lE,"Helicopter",()=>lF,"HelpCircle",()=>fc,"HelpingHand",()=>k9,"Hexagon",()=>lG,"Highlighter",()=>lH,"History",()=>lI,"Home",()=>lS,"Hop",()=>lJ,"HopOff",()=>lK,"Hospital",()=>lL,"Hotel",()=>lM,"Hourglass",()=>lO,"House",()=>lS,"HouseHeart",()=>lN,"HousePlug",()=>lP,"HousePlus",()=>lQ,"HouseWifi",()=>lR,"IceCream",()=>lU,"IceCream2",()=>lT,"IceCreamBowl",()=>lT,"IceCreamCone",()=>lU,"IdCard",()=>lV,"IdCardLanyard",()=>lX,"Image",()=>l2,"ImageDown",()=>lW,"ImageMinus",()=>lZ,"ImageOff",()=>lY,"ImagePlay",()=>l$,"ImagePlus",()=>l_,"ImageUp",()=>l0,"ImageUpscale",()=>l1,"Images",()=>l3,"Import",()=>l4,"Inbox",()=>l6,"Indent",()=>m6,"IndentDecrease",()=>m5,"IndentIncrease",()=>m6,"IndianRupee",()=>l5,"Infinity",()=>l7,"Info",()=>l8,"Inspect",()=>uY,"InspectionPanel",()=>l9,"Instagram",()=>ma,"Italic",()=>mb,"IterationCcw",()=>mc,"IterationCw",()=>md,"JapaneseYen",()=>me,"Joystick",()=>mf,"Kanban",()=>mg,"KanbanSquare",()=>uT,"KanbanSquareDashed",()=>uL,"Kayak",()=>mh,"Key",()=>mk,"KeyRound",()=>mi,"KeySquare",()=>mj,"Keyboard",()=>mo,"KeyboardMusic",()=>ml,"KeyboardOff",()=>mm,"Lamp",()=>mt,"LampCeiling",()=>mn,"LampDesk",()=>mp,"LampFloor",()=>mq,"LampWallDown",()=>mr,"LampWallUp",()=>ms,"LandPlot",()=>mu,"Landmark",()=>mv,"Languages",()=>mw,"Laptop",()=>mz,"Laptop2",()=>my,"LaptopMinimal",()=>my,"LaptopMinimalCheck",()=>mx,"Lasso",()=>mB,"LassoSelect",()=>mA,"Laugh",()=>mC,"Layers",()=>mE,"Layers2",()=>mD,"Layers3",()=>mE,"Layout",()=>qm,"LayoutDashboard",()=>mF,"LayoutGrid",()=>mG,"LayoutList",()=>mH,"LayoutPanelLeft",()=>mI,"LayoutPanelTop",()=>mJ,"LayoutTemplate",()=>mL,"Leaf",()=>mK,"LeafyGreen",()=>mM,"Lectern",()=>mN,"LetterText",()=>wr,"Library",()=>mP,"LibraryBig",()=>mO,"LibrarySquare",()=>uU,"LifeBuoy",()=>mQ,"Ligature",()=>mR,"Lightbulb",()=>mT,"LightbulbOff",()=>mS,"LineChart",()=>d8,"LineSquiggle",()=>mU,"Link",()=>mY,"Link2",()=>mW,"Link2Off",()=>mV,"Linkedin",()=>mX,"List",()=>nh,"ListCheck",()=>mZ,"ListChecks",()=>m$,"ListChevronsDownUp",()=>m_,"ListChevronsUpDown",()=>m0,"ListCollapse",()=>m1,"ListEnd",()=>m2,"ListFilter",()=>m4,"ListFilterPlus",()=>m3,"ListIndentDecrease",()=>m5,"ListIndentIncrease",()=>m6,"ListMinus",()=>m7,"ListMusic",()=>m8,"ListOrdered",()=>m9,"ListPlus",()=>na,"ListRestart",()=>nb,"ListStart",()=>nc,"ListTodo",()=>nd,"ListTree",()=>ne,"ListVideo",()=>nf,"ListX",()=>ng,"Loader",()=>nj,"Loader2",()=>ni,"LoaderCircle",()=>ni,"LoaderPinwheel",()=>nk,"Locate",()=>nn,"LocateFixed",()=>nl,"LocateOff",()=>nm,"LocationEdit",()=>nQ,"Lock",()=>nr,"LockKeyhole",()=>np,"LockKeyholeOpen",()=>no,"LockOpen",()=>nq,"LogIn",()=>ns,"LogOut",()=>nu,"Logs",()=>nt,"Lollipop",()=>nv,"Luggage",()=>nw,"MSquare",()=>uV,"Magnet",()=>nx,"Mail",()=>nG,"MailCheck",()=>ny,"MailMinus",()=>nz,"MailOpen",()=>nA,"MailPlus",()=>nB,"MailQuestion",()=>nD,"MailQuestionMark",()=>nD,"MailSearch",()=>nC,"MailWarning",()=>nE,"MailX",()=>nF,"Mailbox",()=>nH,"Mails",()=>nI,"Map",()=>nY,"MapMinus",()=>nJ,"MapPin",()=>nU,"MapPinCheck",()=>nL,"MapPinCheckInside",()=>nK,"MapPinHouse",()=>nM,"MapPinMinus",()=>nP,"MapPinMinusInside",()=>nN,"MapPinOff",()=>nO,"MapPinPen",()=>nQ,"MapPinPlus",()=>nS,"MapPinPlusInside",()=>nR,"MapPinX",()=>nV,"MapPinXInside",()=>nT,"MapPinned",()=>nW,"MapPlus",()=>nX,"Mars",()=>n$,"MarsStroke",()=>nZ,"Martini",()=>n_,"Maximize",()=>n1,"Maximize2",()=>n0,"Medal",()=>n2,"Megaphone",()=>n4,"MegaphoneOff",()=>n3,"Meh",()=>n5,"MemoryStick",()=>n6,"Menu",()=>n7,"MenuSquare",()=>uW,"Merge",()=>n8,"MessageCircle",()=>oj,"MessageCircleCode",()=>n9,"MessageCircleDashed",()=>oa,"MessageCircleHeart",()=>ob,"MessageCircleMore",()=>oc,"MessageCircleOff",()=>od,"MessageCirclePlus",()=>of,"MessageCircleQuestion",()=>oe,"MessageCircleQuestionMark",()=>oe,"MessageCircleReply",()=>og,"MessageCircleWarning",()=>oi,"MessageCircleX",()=>oh,"MessageSquare",()=>oz,"MessageSquareCode",()=>ol,"MessageSquareDashed",()=>ok,"MessageSquareDiff",()=>om,"MessageSquareDot",()=>on,"MessageSquareHeart",()=>oo,"MessageSquareLock",()=>op,"MessageSquareMore",()=>oq,"MessageSquareOff",()=>or,"MessageSquarePlus",()=>os,"MessageSquareQuote",()=>ou,"MessageSquareReply",()=>ot,"MessageSquareShare",()=>ow,"MessageSquareText",()=>ov,"MessageSquareWarning",()=>ox,"MessageSquareX",()=>oy,"MessagesSquare",()=>oA,"Mic",()=>oD,"Mic2",()=>oC,"MicOff",()=>oB,"MicVocal",()=>oC,"Microchip",()=>oF,"Microscope",()=>oE,"Microwave",()=>oG,"Milestone",()=>oI,"Milk",()=>oJ,"MilkOff",()=>oH,"Minimize",()=>oL,"Minimize2",()=>oK,"Minus",()=>oM,"MinusCircle",()=>e2,"MinusSquare",()=>uX,"Monitor",()=>o$,"MonitorCheck",()=>oN,"MonitorCloud",()=>oO,"MonitorCog",()=>oP,"MonitorDot",()=>oQ,"MonitorDown",()=>oS,"MonitorOff",()=>oR,"MonitorPause",()=>oU,"MonitorPlay",()=>oT,"MonitorSmartphone",()=>oV,"MonitorSpeaker",()=>oW,"MonitorStop",()=>oX,"MonitorUp",()=>oY,"MonitorX",()=>oZ,"Moon",()=>o0,"MoonStar",()=>o_,"MoreHorizontal",()=>hY,"MoreVertical",()=>hX,"Motorbike",()=>o1,"Mountain",()=>o3,"MountainSnow",()=>o2,"Mouse",()=>o8,"MouseOff",()=>o4,"MousePointer",()=>o9,"MousePointer2",()=>o5,"MousePointerBan",()=>o6,"MousePointerClick",()=>o7,"MousePointerSquareDashed",()=>uM,"Move",()=>po,"Move3D",()=>pa,"Move3d",()=>pa,"MoveDiagonal",()=>pb,"MoveDiagonal2",()=>pd,"MoveDown",()=>pf,"MoveDownLeft",()=>pc,"MoveDownRight",()=>pe,"MoveHorizontal",()=>pg,"MoveLeft",()=>ph,"MoveRight",()=>pi,"MoveUp",()=>pl,"MoveUpLeft",()=>pj,"MoveUpRight",()=>pk,"MoveVertical",()=>pm,"Music",()=>pr,"Music2",()=>pn,"Music3",()=>pp,"Music4",()=>pq,"Navigation",()=>pv,"Navigation2",()=>pt,"Navigation2Off",()=>ps,"NavigationOff",()=>pu,"Network",()=>pw,"Newspaper",()=>px,"Nfc",()=>py,"NonBinary",()=>pz,"Notebook",()=>pD,"NotebookPen",()=>pA,"NotebookTabs",()=>pB,"NotebookText",()=>pC,"NotepadText",()=>pF,"NotepadTextDashed",()=>pE,"Nut",()=>pH,"NutOff",()=>pG,"Octagon",()=>pM,"OctagonAlert",()=>pI,"OctagonMinus",()=>pJ,"OctagonPause",()=>pL,"OctagonX",()=>pK,"Omega",()=>pN,"Option",()=>pO,"Orbit",()=>pP,"Origami",()=>pQ,"Outdent",()=>m5,"Package",()=>pX,"Package2",()=>pR,"PackageCheck",()=>pS,"PackageMinus",()=>pT,"PackageOpen",()=>pU,"PackagePlus",()=>pW,"PackageSearch",()=>pV,"PackageX",()=>pZ,"PaintBucket",()=>pY,"PaintRoller",()=>p_,"Paintbrush",()=>p0,"Paintbrush2",()=>p$,"PaintbrushVertical",()=>p$,"Palette",()=>p1,"Palmtree",()=>w6,"Panda",()=>p2,"PanelBottom",()=>p6,"PanelBottomClose",()=>p3,"PanelBottomDashed",()=>p4,"PanelBottomInactive",()=>p4,"PanelBottomOpen",()=>p5,"PanelLeft",()=>qb,"PanelLeftClose",()=>p8,"PanelLeftDashed",()=>p7,"PanelLeftInactive",()=>p7,"PanelLeftOpen",()=>p9,"PanelLeftRightDashed",()=>qa,"PanelRight",()=>qf,"PanelRightClose",()=>qc,"PanelRightDashed",()=>qd,"PanelRightInactive",()=>qd,"PanelRightOpen",()=>qe,"PanelTop",()=>qk,"PanelTopBottomDashed",()=>qg,"PanelTopClose",()=>qh,"PanelTopDashed",()=>qi,"PanelTopInactive",()=>qi,"PanelTopOpen",()=>qj,"PanelsLeftBottom",()=>ql,"PanelsLeftRight",()=>gn,"PanelsRightBottom",()=>qn,"PanelsTopBottom",()=>sp,"PanelsTopLeft",()=>qm,"Paperclip",()=>qo,"Parentheses",()=>qp,"ParkingCircle",()=>e5,"ParkingCircleOff",()=>e4,"ParkingMeter",()=>qr,"ParkingSquare",()=>u$,"ParkingSquareOff",()=>uZ,"PartyPopper",()=>qq,"Pause",()=>qs,"PauseCircle",()=>e7,"PauseOctagon",()=>pL,"PawPrint",()=>qt,"PcCase",()=>qu,"Pen",()=>qy,"PenBox",()=>u_,"PenLine",()=>qv,"PenOff",()=>qw,"PenSquare",()=>u_,"PenTool",()=>qx,"Pencil",()=>qC,"PencilLine",()=>qA,"PencilOff",()=>qz,"PencilRuler",()=>qB,"Pentagon",()=>qD,"Percent",()=>qE,"PercentCircle",()=>e6,"PercentDiamond",()=>hd,"PercentSquare",()=>u1,"PersonStanding",()=>qF,"PhilippinePeso",()=>qH,"Phone",()=>qN,"PhoneCall",()=>qG,"PhoneForwarded",()=>qI,"PhoneIncoming",()=>qJ,"PhoneMissed",()=>qK,"PhoneOff",()=>qL,"PhoneOutgoing",()=>qM,"Pi",()=>qP,"PiSquare",()=>u2,"Piano",()=>qO,"Pickaxe",()=>qQ,"PictureInPicture",()=>qS,"PictureInPicture2",()=>qR,"PieChart",()=>ee,"PiggyBank",()=>qT,"Pilcrow",()=>qW,"PilcrowLeft",()=>qU,"PilcrowRight",()=>qV,"PilcrowSquare",()=>u3,"Pill",()=>qY,"PillBottle",()=>qX,"Pin",()=>q$,"PinOff",()=>qZ,"Pipette",()=>q_,"Pizza",()=>q0,"Plane",()=>q3,"PlaneLanding",()=>q1,"PlaneTakeoff",()=>q2,"Play",()=>q4,"PlayCircle",()=>e8,"PlaySquare",()=>u4,"Plug",()=>q7,"Plug2",()=>q5,"PlugZap",()=>q6,"PlugZap2",()=>q6,"Plus",()=>q8,"PlusCircle",()=>e9,"PlusSquare",()=>u5,"Pocket",()=>q9,"PocketKnife",()=>rb,"Podcast",()=>ra,"Pointer",()=>rd,"PointerOff",()=>rc,"Popcorn",()=>re,"Popsicle",()=>rf,"PoundSterling",()=>rg,"Power",()=>ri,"PowerCircle",()=>fb,"PowerOff",()=>rh,"PowerSquare",()=>u6,"Presentation",()=>rj,"Printer",()=>rl,"PrinterCheck",()=>rk,"Projector",()=>rm,"Proportions",()=>rn,"Puzzle",()=>ro,"Pyramid",()=>rp,"QrCode",()=>rq,"Quote",()=>rr,"Rabbit",()=>rs,"Radar",()=>rt,"Radiation",()=>rv,"Radical",()=>ru,"Radio",()=>ry,"RadioReceiver",()=>rw,"RadioTower",()=>rx,"Radius",()=>rz,"RailSymbol",()=>rA,"Rainbow",()=>rC,"Rat",()=>rB,"Ratio",()=>rD,"Receipt",()=>rN,"ReceiptCent",()=>rE,"ReceiptEuro",()=>rF,"ReceiptIndianRupee",()=>rG,"ReceiptJapaneseYen",()=>rH,"ReceiptPoundSterling",()=>rI,"ReceiptRussianRuble",()=>rJ,"ReceiptSwissFranc",()=>rK,"ReceiptText",()=>rL,"ReceiptTurkishLira",()=>rM,"RectangleCircle",()=>rO,"RectangleEllipsis",()=>rP,"RectangleGoggles",()=>rQ,"RectangleHorizontal",()=>rR,"RectangleVertical",()=>rS,"Recycle",()=>rT,"Redo",()=>rW,"Redo2",()=>rU,"RedoDot",()=>rV,"RefreshCcw",()=>rY,"RefreshCcwDot",()=>rX,"RefreshCw",()=>r$,"RefreshCwOff",()=>rZ,"Refrigerator",()=>r_,"Regex",()=>r0,"RemoveFormatting",()=>r1,"Repeat",()=>r4,"Repeat1",()=>r2,"Repeat2",()=>r3,"Replace",()=>r6,"ReplaceAll",()=>r5,"Reply",()=>r8,"ReplyAll",()=>r7,"Rewind",()=>r9,"Ribbon",()=>sa,"Rocket",()=>sb,"RockingChair",()=>sd,"RollerCoaster",()=>sc,"Rose",()=>se,"Rotate3D",()=>sf,"Rotate3d",()=>sf,"RotateCcw",()=>sh,"RotateCcwKey",()=>sg,"RotateCcwSquare",()=>si,"RotateCw",()=>sk,"RotateCwSquare",()=>sj,"Route",()=>sm,"RouteOff",()=>sl,"Router",()=>sn,"Rows",()=>so,"Rows2",()=>so,"Rows3",()=>sp,"Rows4",()=>sq,"Rss",()=>sr,"Ruler",()=>st,"RulerDimensionLine",()=>ss,"RussianRuble",()=>su,"Sailboat",()=>sv,"Salad",()=>sw,"Sandwich",()=>sx,"Satellite",()=>sz,"SatelliteDish",()=>sy,"SaudiRiyal",()=>sB,"Save",()=>sD,"SaveAll",()=>sA,"SaveOff",()=>sC,"Scale",()=>sF,"Scale3D",()=>sE,"Scale3d",()=>sE,"Scaling",()=>sG,"Scan",()=>sO,"ScanBarcode",()=>sH,"ScanEye",()=>sI,"ScanFace",()=>sJ,"ScanHeart",()=>sK,"ScanLine",()=>sM,"ScanQrCode",()=>sL,"ScanSearch",()=>sN,"ScanText",()=>sP,"ScatterChart",()=>ef,"School",()=>sQ,"School2",()=>xD,"Scissors",()=>sS,"ScissorsLineDashed",()=>sR,"ScissorsSquare",()=>u9,"ScissorsSquareDashedBottom",()=>uA,"ScreenShare",()=>sU,"ScreenShareOff",()=>sT,"Scroll",()=>sW,"ScrollText",()=>sV,"Search",()=>s_,"SearchCheck",()=>sX,"SearchCode",()=>sY,"SearchSlash",()=>sZ,"SearchX",()=>s$,"Section",()=>s0,"Send",()=>s3,"SendHorizonal",()=>s1,"SendHorizontal",()=>s1,"SendToBack",()=>s2,"SeparatorHorizontal",()=>s4,"SeparatorVertical",()=>s5,"Server",()=>s9,"ServerCog",()=>s6,"ServerCrash",()=>s7,"ServerOff",()=>s8,"Settings",()=>tb,"Settings2",()=>ta,"Shapes",()=>tc,"Share",()=>te,"Share2",()=>td,"Sheet",()=>tf,"Shell",()=>tg,"Shield",()=>ts,"ShieldAlert",()=>th,"ShieldBan",()=>ti,"ShieldCheck",()=>tj,"ShieldClose",()=>tr,"ShieldEllipsis",()=>tk,"ShieldHalf",()=>tl,"ShieldMinus",()=>tm,"ShieldOff",()=>tn,"ShieldPlus",()=>to,"ShieldQuestion",()=>tq,"ShieldQuestionMark",()=>tq,"ShieldUser",()=>tp,"ShieldX",()=>tr,"Ship",()=>tw,"ShipWheel",()=>tt,"Shirt",()=>tu,"ShoppingBag",()=>tv,"ShoppingBasket",()=>tx,"ShoppingCart",()=>tz,"Shovel",()=>ty,"ShowerHead",()=>tA,"Shredder",()=>tB,"Shrimp",()=>tC,"Shrink",()=>tD,"Shrub",()=>tE,"Shuffle",()=>tF,"Sidebar",()=>qb,"SidebarClose",()=>p8,"SidebarOpen",()=>p9,"Sigma",()=>tG,"SigmaSquare",()=>va,"Signal",()=>tL,"SignalHigh",()=>tH,"SignalLow",()=>tI,"SignalMedium",()=>tJ,"SignalZero",()=>tK,"Signature",()=>tM,"Signpost",()=>tO,"SignpostBig",()=>tN,"Siren",()=>tP,"SkipBack",()=>tQ,"SkipForward",()=>tR,"Skull",()=>tS,"Slack",()=>tT,"Slash",()=>tU,"SlashSquare",()=>vb,"Slice",()=>tW,"Sliders",()=>tX,"SlidersHorizontal",()=>tV,"SlidersVertical",()=>tX,"Smartphone",()=>t$,"SmartphoneCharging",()=>tY,"SmartphoneNfc",()=>tZ,"Smile",()=>t1,"SmilePlus",()=>t_,"Snail",()=>t0,"Snowflake",()=>t2,"SoapDispenserDroplet",()=>t3,"Sofa",()=>t4,"SolarPanel",()=>t5,"SortAsc",()=>aL,"SortDesc",()=>at,"Soup",()=>t6,"Space",()=>t7,"Spade",()=>t8,"Sparkle",()=>t9,"Sparkles",()=>ua,"Speaker",()=>ub,"Speech",()=>uc,"SpellCheck",()=>uf,"SpellCheck2",()=>ud,"Spline",()=>uh,"SplinePointer",()=>ue,"Split",()=>ug,"SplitSquareHorizontal",()=>vc,"SplitSquareVertical",()=>vd,"Spool",()=>ui,"Spotlight",()=>uj,"SprayCan",()=>uk,"Sprout",()=>ul,"Square",()=>vm,"SquareActivity",()=>um,"SquareArrowDown",()=>up,"SquareArrowDownLeft",()=>un,"SquareArrowDownRight",()=>uo,"SquareArrowLeft",()=>uq,"SquareArrowOutDownLeft",()=>ur,"SquareArrowOutDownRight",()=>us,"SquareArrowOutUpLeft",()=>ut,"SquareArrowOutUpRight",()=>uu,"SquareArrowRight",()=>uv,"SquareArrowUp",()=>ux,"SquareArrowUpLeft",()=>uw,"SquareArrowUpRight",()=>uy,"SquareAsterisk",()=>uz,"SquareBottomDashedScissors",()=>uA,"SquareChartGantt",()=>uC,"SquareCheck",()=>uD,"SquareCheckBig",()=>uB,"SquareChevronDown",()=>uE,"SquareChevronLeft",()=>uF,"SquareChevronRight",()=>uG,"SquareChevronUp",()=>uH,"SquareCode",()=>uI,"SquareDashed",()=>uO,"SquareDashedBottom",()=>uK,"SquareDashedBottomCode",()=>uJ,"SquareDashedKanban",()=>uL,"SquareDashedMousePointer",()=>uM,"SquareDashedTopSolid",()=>uN,"SquareDivide",()=>uP,"SquareDot",()=>uQ,"SquareEqual",()=>uR,"SquareFunction",()=>uS,"SquareGanttChart",()=>uC,"SquareKanban",()=>uT,"SquareLibrary",()=>uU,"SquareM",()=>uV,"SquareMenu",()=>uW,"SquareMinus",()=>uX,"SquareMousePointer",()=>uY,"SquareParking",()=>u$,"SquareParkingOff",()=>uZ,"SquarePause",()=>u0,"SquarePen",()=>u_,"SquarePercent",()=>u1,"SquarePi",()=>u2,"SquarePilcrow",()=>u3,"SquarePlay",()=>u4,"SquarePlus",()=>u5,"SquarePower",()=>u6,"SquareRadical",()=>u7,"SquareRoundCorner",()=>u8,"SquareScissors",()=>u9,"SquareSigma",()=>va,"SquareSlash",()=>vb,"SquareSplitHorizontal",()=>vc,"SquareSplitVertical",()=>vd,"SquareSquare",()=>ve,"SquareStack",()=>vf,"SquareStar",()=>vg,"SquareStop",()=>vh,"SquareTerminal",()=>vj,"SquareUser",()=>vk,"SquareUserRound",()=>vi,"SquareX",()=>vl,"SquaresExclude",()=>vn,"SquaresIntersect",()=>vo,"SquaresSubtract",()=>vp,"SquaresUnite",()=>vq,"Squircle",()=>vs,"SquircleDashed",()=>vr,"Squirrel",()=>vt,"Stamp",()=>vu,"Star",()=>vx,"StarHalf",()=>vw,"StarOff",()=>vv,"Stars",()=>ua,"StepBack",()=>vy,"StepForward",()=>vB,"Stethoscope",()=>vz,"Sticker",()=>vA,"StickyNote",()=>vC,"StopCircle",()=>fg,"Store",()=>vD,"StretchHorizontal",()=>vF,"StretchVertical",()=>vE,"Strikethrough",()=>vG,"Subscript",()=>vH,"Subtitles",()=>dH,"Sun",()=>vM,"SunDim",()=>vK,"SunMedium",()=>vI,"SunMoon",()=>vJ,"SunSnow",()=>vL,"Sunrise",()=>vN,"Sunset",()=>vO,"Superscript",()=>vP,"SwatchBook",()=>vQ,"SwissFranc",()=>vR,"SwitchCamera",()=>vT,"Sword",()=>vS,"Swords",()=>vU,"Syringe",()=>vV,"Table",()=>v1,"Table2",()=>vW,"TableCellsMerge",()=>vX,"TableCellsSplit",()=>vY,"TableColumnsSplit",()=>vZ,"TableConfig",()=>gm,"TableOfContents",()=>v$,"TableProperties",()=>v_,"TableRowsSplit",()=>v0,"Tablet",()=>v3,"TabletSmartphone",()=>v2,"Tablets",()=>v4,"Tag",()=>v5,"Tags",()=>v6,"Tally1",()=>v8,"Tally2",()=>v7,"Tally3",()=>v9,"Tally4",()=>wa,"Tally5",()=>wb,"Tangent",()=>wc,"Target",()=>wd,"Telescope",()=>we,"Tent",()=>wg,"TentTree",()=>wf,"Terminal",()=>wh,"TerminalSquare",()=>vj,"TestTube",()=>wj,"TestTube2",()=>wi,"TestTubeDiagonal",()=>wi,"TestTubes",()=>wk,"Text",()=>wo,"TextAlignCenter",()=>wl,"TextAlignEnd",()=>wm,"TextAlignJustify",()=>wn,"TextAlignStart",()=>wo,"TextCursor",()=>wq,"TextCursorInput",()=>wp,"TextInitial",()=>wr,"TextQuote",()=>ws,"TextSearch",()=>wt,"TextSelect",()=>wu,"TextSelection",()=>wu,"TextWrap",()=>wv,"Theater",()=>ww,"Thermometer",()=>wy,"ThermometerSnowflake",()=>wx,"ThermometerSun",()=>wz,"ThumbsDown",()=>wA,"ThumbsUp",()=>wC,"Ticket",()=>wH,"TicketCheck",()=>wB,"TicketMinus",()=>wD,"TicketPercent",()=>wE,"TicketPlus",()=>wF,"TicketSlash",()=>wG,"TicketX",()=>wJ,"Tickets",()=>wL,"TicketsPlane",()=>wI,"Timer",()=>wN,"TimerOff",()=>wK,"TimerReset",()=>wM,"ToggleLeft",()=>wO,"ToggleRight",()=>wP,"Toilet",()=>wQ,"ToolCase",()=>wR,"Tornado",()=>wS,"Torus",()=>wT,"Touchpad",()=>wV,"TouchpadOff",()=>wU,"TowerControl",()=>wX,"ToyBrick",()=>wW,"Tractor",()=>wY,"TrafficCone",()=>wZ,"Train",()=>w1,"TrainFront",()=>w_,"TrainFrontTunnel",()=>w$,"TrainTrack",()=>w0,"TramFront",()=>w1,"Transgender",()=>w2,"Trash",()=>w4,"Trash2",()=>w3,"TreeDeciduous",()=>w5,"TreePalm",()=>w6,"TreePine",()=>w7,"Trees",()=>w8,"Trello",()=>w9,"TrendingDown",()=>xa,"TrendingUp",()=>xc,"TrendingUpDown",()=>xb,"Triangle",()=>xg,"TriangleAlert",()=>xd,"TriangleDashed",()=>xe,"TriangleRight",()=>xf,"Trophy",()=>xh,"Truck",()=>xj,"TruckElectric",()=>xi,"TurkishLira",()=>xk,"Turntable",()=>xl,"Turtle",()=>xm,"Tv",()=>xp,"Tv2",()=>xo,"TvMinimal",()=>xo,"TvMinimalPlay",()=>xn,"Twitch",()=>xq,"Twitter",()=>xr,"Type",()=>xt,"TypeOutline",()=>xs,"Umbrella",()=>xv,"UmbrellaOff",()=>xu,"Underline",()=>xw,"Undo",()=>xy,"Undo2",()=>xx,"UndoDot",()=>xz,"UnfoldHorizontal",()=>xA,"UnfoldVertical",()=>xB,"Ungroup",()=>xC,"University",()=>xD,"Unlink",()=>xG,"Unlink2",()=>xE,"Unlock",()=>nq,"UnlockKeyhole",()=>no,"Unplug",()=>xF,"Upload",()=>xH,"UploadCloud",()=>f9,"Usb",()=>xI,"User",()=>x$,"User2",()=>xV,"UserCheck",()=>xK,"UserCheck2",()=>xP,"UserCircle",()=>fk,"UserCircle2",()=>fi,"UserCog",()=>xJ,"UserCog2",()=>xQ,"UserLock",()=>xL,"UserMinus",()=>xM,"UserMinus2",()=>xR,"UserPen",()=>xN,"UserPlus",()=>xO,"UserPlus2",()=>xT,"UserRound",()=>xV,"UserRoundCheck",()=>xP,"UserRoundCog",()=>xQ,"UserRoundMinus",()=>xR,"UserRoundPen",()=>xS,"UserRoundPlus",()=>xT,"UserRoundSearch",()=>xU,"UserRoundX",()=>xW,"UserSearch",()=>xX,"UserSquare",()=>vk,"UserSquare2",()=>vi,"UserStar",()=>xY,"UserX",()=>xZ,"UserX2",()=>xW,"Users",()=>x1,"Users2",()=>x_,"UsersRound",()=>x_,"Utensils",()=>x2,"UtensilsCrossed",()=>x0,"UtilityPole",()=>x3,"Variable",()=>x4,"Vault",()=>x5,"VectorSquare",()=>x7,"Vegan",()=>x6,"VenetianMask",()=>x8,"Venus",()=>ya,"VenusAndMars",()=>x9,"Verified",()=>a2,"Vibrate",()=>yc,"VibrateOff",()=>yb,"Video",()=>ye,"VideoOff",()=>yd,"Videotape",()=>yf,"View",()=>yg,"Voicemail",()=>yh,"Volleyball",()=>yi,"Volume",()=>yn,"Volume1",()=>yj,"Volume2",()=>yk,"VolumeOff",()=>yl,"VolumeX",()=>ym,"Vote",()=>yo,"Wallet",()=>yr,"Wallet2",()=>yq,"WalletCards",()=>yp,"WalletMinimal",()=>yq,"Wallpaper",()=>ys,"Wand",()=>yv,"Wand2",()=>yt,"WandSparkles",()=>yt,"Warehouse",()=>yu,"WashingMachine",()=>yw,"Watch",()=>yx,"Waves",()=>yz,"WavesLadder",()=>yy,"Waypoints",()=>yA,"Webcam",()=>yB,"Webhook",()=>yD,"WebhookOff",()=>yC,"Weight",()=>yE,"Wheat",()=>yG,"WheatOff",()=>yF,"WholeWord",()=>yH,"Wifi",()=>yP,"WifiCog",()=>yI,"WifiHigh",()=>yJ,"WifiLow",()=>yK,"WifiOff",()=>yL,"WifiPen",()=>yM,"WifiSync",()=>yN,"WifiZero",()=>yO,"Wind",()=>yR,"WindArrowDown",()=>yQ,"Wine",()=>yT,"WineOff",()=>yS,"Workflow",()=>yU,"Worm",()=>yV,"WrapText",()=>wv,"Wrench",()=>yW,"X",()=>yX,"XCircle",()=>fj,"XOctagon",()=>pK,"XSquare",()=>vl,"Youtube",()=>yY,"Zap",()=>y$,"ZapOff",()=>yZ,"ZoomIn",()=>y_,"ZoomOut",()=>y0],45321)},89514,a=>{a.v("/_next/static/media/disabletelemetry.b4b155e3.png")},9334,a=>{"use strict";var b=a.i(78918);let c={src:a.i(89514).default,width:1746,height:1120,blurWidth:8,blurHeight:5,blurDataURL:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAeElEQVR42lWOOQrFIABEc/+DpAukSxEFD+AhrBQFFwQXXJiPFh9SDNO8WY7ruiCEgFIKUkpYa+Gc2/48D473fdFaQ+8dxhiEEFBrRSkFlFIchBDMOTHGgPd+AznnHWKMfYEYI1JKu+EP3PcNrfXWmlhaXzjnOM8TPxAVkcaygx+UAAAAAElFTkSuQmCC"},d={title:"Telemetry",description:"What data Emdash collects, what it doesn't, and how to opt out"},e={contents:[{heading:void 0,content:"Emdash respects your privacy. This page explains our telemetry practices in detail."},{heading:"overview",content:"Emdash collects anonymous usage telemetry to improve the app"},{heading:"overview",content:"Telemetry is enabled by default but can be easily disabled"},{heading:"overview",content:"Data is sent to PostHog using explicit, allowlisted events only"},{heading:"overview",content:"No autocapture or session recording is enabled in the app"},{heading:"in-app-settings",content:"Open Emdash Settings"},{heading:"in-app-settings",content:"Navigate to General → Privacy & Telemetry"},{heading:"in-app-settings",content:"Toggle telemetry off"},{heading:"environment-variable",content:"Set the environment variable before launching the app:"},{heading:"environment-variable",content:"This completely disables telemetry at the application level."},{heading:"what-we-collect",content:"We only collect anonymous, aggregated usage data to understand how Emdash is used and improve the product."},{heading:"app-lifecycle-events",content:"app_started (automatically on app launch)"},{heading:"app-lifecycle-events",content:"app_version - Emdash version number"},{heading:"app-lifecycle-events",content:"electron_version - Electron runtime version"},{heading:"app-lifecycle-events",content:"platform - Operating system (macOS, Windows, Linux)"},{heading:"app-lifecycle-events",content:"arch - CPU architecture (x64, arm64)"},{heading:"app-lifecycle-events",content:"is_dev - Whether running in development mode"},{heading:"app-lifecycle-events",content:"install_source - Distribution channel (dmg, dev, etc.)"},{heading:"app-lifecycle-events",content:"app_closed (automatically on app quit)"},{heading:"app-lifecycle-events",content:"Same properties as app_started"},{heading:"app-lifecycle-events",content:"app_session (on quit; duration only)"},{heading:"app-lifecycle-events",content:"session_duration_ms - How long the app was open"},{heading:"usage-events",content:"workspace_snapshot (early in app lifecycle)"},{heading:"usage-events",content:"project_count - Total number of projects"},{heading:"usage-events",content:'project_count_bucket - Coarse bucket (e.g., "1-5", "6-10")'},{heading:"usage-events",content:"workspace_count - Total number of workspaces"},{heading:"usage-events",content:"workspace_count_bucket - Coarse bucket"},{heading:"usage-events",content:"feature_used"},{heading:"usage-events",content:"feature - Name of the feature (string)"},{heading:"usage-events",content:"error"},{heading:"usage-events",content:"type - Error category (string, no stack traces or details)"},{heading:"agent-events",content:"agent_run_start"},{heading:"agent-events",content:'provider - CLI provider ID (e.g., "claude-code", "codex")'},{heading:"agent-events",content:"agent_run_finish"},{heading:"agent-events",content:"provider - CLI provider ID"},{heading:"agent-events",content:"outcome - Result: ok or error (no details)"},{heading:"agent-events",content:"duration_ms - How long the agent ran (clamped, no content)"},{heading:"what-we-dont-collect",content:"We take privacy seriously. The following data is never collected:"},{heading:"what-we-dont-collect",content:"❌ No code or file contents"},{heading:"what-we-dont-collect",content:"❌ No file paths or repository names"},{heading:"what-we-dont-collect",content:"❌ No prompts or messages sent to agents"},{heading:"what-we-dont-collect",content:"❌ No environment variables"},{heading:"what-we-dont-collect",content:"❌ No personally identifiable information (PII)"},{heading:"what-we-dont-collect",content:"❌ No user text input or command contents"},{heading:"what-we-dont-collect",content:"❌ No IP-derived location data"},{heading:"what-we-dont-collect",content:"❌ No session recordings or screen captures"},{heading:"what-we-dont-collect",content:"❌ No autocapture of user interactions"},{heading:"agent-usage-privacy",content:"When tracking agent usage, we only collect:"},{heading:"agent-usage-privacy",content:'Provider name (e.g., "claude-code")'},{heading:"agent-usage-privacy",content:"Start/finish timestamps"},{heading:"agent-usage-privacy",content:"Success or failure outcome"},{heading:"agent-usage-privacy",content:"Duration"},{heading:"agent-usage-privacy",content:"We do not collect:"},{heading:"agent-usage-privacy",content:"Prompts or messages"},{heading:"agent-usage-privacy",content:"Code changes"},{heading:"agent-usage-privacy",content:"File paths"},{heading:"agent-usage-privacy",content:"Workspace names or IDs"},{heading:"agent-usage-privacy",content:"Any content from terminal streams"},{heading:"anonymous-identification",content:"A random anonymous instanceId is generated on first launch"},{heading:"anonymous-identification",content:"Stored locally in ${appData}/telemetry.json"},{heading:"anonymous-identification",content:"Used as distinct_id for telemetry events"},{heading:"anonymous-identification",content:"Not linked to any personal information"},{heading:"data-sanitization",content:"All telemetry data passes through a sanitizer that:"},{heading:"data-sanitization",content:"Only allows explicitly allowlisted properties"},{heading:"data-sanitization",content:"Drops any unexpected or sensitive data"},{heading:"data-sanitization",content:"Enforces data types and formats"},{heading:"data-sanitization",content:"Prevents accidental leakage"},{heading:"local-development",content:"Official builds include PostHog credentials via CI"},{heading:"local-development",content:"Local development builds do not send telemetry unless credentials are explicitly added for testing"},{heading:"local-development",content:"Development mode is clearly marked in events"},{heading:"environment-variables",content:"For Users:"},{heading:"environment-variables",content:"TELEMETRY_ENABLED (default: true) - Set to false to disable"},{heading:"environment-variables",content:"For Maintainers:"},{heading:"environment-variables",content:"INSTALL_SOURCE - Labels distribution channel (e.g., dmg, dev)"},{heading:"environment-variables",content:"PostHog credentials are injected via CI for official builds"},{heading:"renderer-process-events",content:"The renderer may request sending feature_used or error events via IPC:"},{heading:"renderer-process-events",content:"Constrained IPC channel handled in main process"},{heading:"renderer-process-events",content:"Only allowlisted properties are forwarded"},{heading:"renderer-process-events",content:"Everything else is dropped by the sanitizer"},{heading:"adding-new-events",content:"If you're contributing and want to add telemetry events:"},{heading:"adding-new-events",content:"Only track coarse, anonymous metrics"},{heading:"adding-new-events",content:"Add event to allowlist in telemetry service"},{heading:"adding-new-events",content:"Document in this file"},{heading:"adding-new-events",content:"Ensure no PII or sensitive data is included"},{heading:"transparency",content:"We believe in transparency about data collection:"},{heading:"transparency",content:"This documentation is version-controlled and public"},{heading:"transparency",content:"Telemetry code is open source in our GitHub repository"},{heading:"transparency",content:"Event definitions are hardcoded (no dynamic tracking)"},{heading:"transparency",content:"You can audit exactly what is collected"},{heading:"questions",content:"If you have questions or concerns about privacy:"},{heading:"questions",content:"Read the code: Check src/main/services/telemetryService.ts"},{heading:"questions",content:"Open an issue: GitHub Issues"},{heading:"questions",content:"Start a discussion: GitHub Discussions"},{heading:"questions",content:"We're happy to answer any privacy-related questions!"}],headings:[{id:"overview",content:"Overview"},{id:"how-to-opt-out",content:"How to Opt Out"},{id:"in-app-settings",content:"In-App Settings"},{id:"environment-variable",content:"Environment Variable"},{id:"what-we-collect",content:"What We Collect"},{id:"events-tracked",content:"Events Tracked"},{id:"app-lifecycle-events",content:"App Lifecycle Events"},{id:"usage-events",content:"Usage Events"},{id:"agent-events",content:"Agent Events"},{id:"what-we-dont-collect",content:"What We DON'T Collect"},{id:"agent-usage-privacy",content:"Agent Usage Privacy"},{id:"how-it-works",content:"How It Works"},{id:"anonymous-identification",content:"Anonymous Identification"},{id:"data-sanitization",content:"Data Sanitization"},{id:"local-development",content:"Local Development"},{id:"for-developers",content:"For Developers"},{id:"environment-variables",content:"Environment Variables"},{id:"renderer-process-events",content:"Renderer Process Events"},{id:"adding-new-events",content:"Adding New Events"},{id:"transparency",content:"Transparency"},{id:"questions",content:"Questions?"}]},f=[{depth:2,url:"#overview",title:(0,b.jsx)(b.Fragment,{children:"Overview"})},{depth:2,url:"#how-to-opt-out",title:(0,b.jsx)(b.Fragment,{children:"How to Opt Out"})},{depth:3,url:"#in-app-settings",title:(0,b.jsx)(b.Fragment,{children:"In-App Settings"})},{depth:3,url:"#environment-variable",title:(0,b.jsx)(b.Fragment,{children:"Environment Variable"})},{depth:2,url:"#what-we-collect",title:(0,b.jsx)(b.Fragment,{children:"What We Collect"})},{depth:3,url:"#events-tracked",title:(0,b.jsx)(b.Fragment,{children:"Events Tracked"})},{depth:4,url:"#app-lifecycle-events",title:(0,b.jsx)(b.Fragment,{children:"App Lifecycle Events"})},{depth:4,url:"#usage-events",title:(0,b.jsx)(b.Fragment,{children:"Usage Events"})},{depth:4,url:"#agent-events",title:(0,b.jsx)(b.Fragment,{children:"Agent Events"})},{depth:2,url:"#what-we-dont-collect",title:(0,b.jsx)(b.Fragment,{children:"What We DON'T Collect"})},{depth:3,url:"#agent-usage-privacy",title:(0,b.jsx)(b.Fragment,{children:"Agent Usage Privacy"})},{depth:2,url:"#how-it-works",title:(0,b.jsx)(b.Fragment,{children:"How It Works"})},{depth:3,url:"#anonymous-identification",title:(0,b.jsx)(b.Fragment,{children:"Anonymous Identification"})},{depth:3,url:"#data-sanitization",title:(0,b.jsx)(b.Fragment,{children:"Data Sanitization"})},{depth:3,url:"#local-development",title:(0,b.jsx)(b.Fragment,{children:"Local Development"})},{depth:2,url:"#for-developers",title:(0,b.jsx)(b.Fragment,{children:"For Developers"})},{depth:3,url:"#environment-variables",title:(0,b.jsx)(b.Fragment,{children:"Environment Variables"})},{depth:3,url:"#renderer-process-events",title:(0,b.jsx)(b.Fragment,{children:"Renderer Process Events"})},{depth:3,url:"#adding-new-events",title:(0,b.jsx)(b.Fragment,{children:"Adding New Events"})},{depth:2,url:"#transparency",title:(0,b.jsx)(b.Fragment,{children:"Transparency"})},{depth:2,url:"#questions",title:(0,b.jsx)(b.Fragment,{children:"Questions?"})}];function g(a){let d={a:"a",code:"code",h2:"h2",h3:"h3",h4:"h4",img:"img",li:"li",ol:"ol",p:"p",pre:"pre",span:"span",strong:"strong",ul:"ul",...a.components};return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(d.p,{children:"Emdash respects your privacy. This page explains our telemetry practices in detail."}),"\n",(0,b.jsx)(d.h2,{id:"overview",children:"Overview"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:["Emdash collects ",(0,b.jsx)(d.strong,{children:"anonymous usage telemetry"})," to improve the app"]}),"\n",(0,b.jsxs)(d.li,{children:["Telemetry is ",(0,b.jsx)(d.strong,{children:"enabled by default"})," but can be easily disabled"]}),"\n",(0,b.jsxs)(d.li,{children:["Data is sent to PostHog using ",(0,b.jsx)(d.strong,{children:"explicit, allowlisted events only"})]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.strong,{children:"No autocapture or session recording"})," is enabled in the app"]}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"how-to-opt-out",children:"How to Opt Out"}),"\n",(0,b.jsx)(d.h3,{id:"in-app-settings",children:"In-App Settings"}),"\n",(0,b.jsxs)(d.ol,{children:["\n",(0,b.jsx)(d.li,{children:"Open Emdash Settings"}),"\n",(0,b.jsxs)(d.li,{children:["Navigate to ",(0,b.jsx)(d.strong,{children:"General → Privacy & Telemetry"})]}),"\n",(0,b.jsxs)(d.li,{children:["Toggle telemetry ",(0,b.jsx)(d.strong,{children:"off"})]}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.img,{alt:"Disable Telemetry",src:c,placeholder:"blur"})}),"\n",(0,b.jsx)(d.h3,{id:"environment-variable",children:"Environment Variable"}),"\n",(0,b.jsx)(d.p,{children:"Set the environment variable before launching the app:"}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(d.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" fill="currentColor" /></svg>',children:(0,b.jsx)(d.code,{children:(0,b.jsxs)(d.span,{className:"line",children:[(0,b.jsx)(d.span,{style:{"--shiki-light":"#24292E","--shiki-dark":"#E1E4E8"},children:"TELEMETRY_ENABLED"}),(0,b.jsx)(d.span,{style:{"--shiki-light":"#D73A49","--shiki-dark":"#F97583"},children:"="}),(0,b.jsx)(d.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:"false"})]})})})}),"\n",(0,b.jsx)(d.p,{children:"This completely disables telemetry at the application level."}),"\n",(0,b.jsx)(d.h2,{id:"what-we-collect",children:"What We Collect"}),"\n",(0,b.jsxs)(d.p,{children:["We only collect ",(0,b.jsx)(d.strong,{children:"anonymous, aggregated usage data"})," to understand how Emdash is used and improve the product."]}),"\n",(0,b.jsx)(d.h3,{id:"events-tracked",children:"Events Tracked"}),"\n",(0,b.jsx)(d.h4,{id:"app-lifecycle-events",children:"App Lifecycle Events"}),"\n",(0,b.jsxs)(d.p,{children:[(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"app_started"})})," (automatically on app launch)"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"app_version"})," - Emdash version number"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"electron_version"})," - Electron runtime version"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"platform"})," - Operating system (macOS, Windows, Linux)"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"arch"})," - CPU architecture (x64, arm64)"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"is_dev"})," - Whether running in development mode"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"install_source"})," - Distribution channel (dmg, dev, etc.)"]}),"\n"]}),"\n",(0,b.jsxs)(d.p,{children:[(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"app_closed"})})," (automatically on app quit)"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:["Same properties as ",(0,b.jsx)(d.code,{children:"app_started"})]}),"\n"]}),"\n",(0,b.jsxs)(d.p,{children:[(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"app_session"})})," (on quit; duration only)"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"session_duration_ms"})," - How long the app was open"]}),"\n"]}),"\n",(0,b.jsx)(d.h4,{id:"usage-events",children:"Usage Events"}),"\n",(0,b.jsxs)(d.p,{children:[(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"workspace_snapshot"})})," (early in app lifecycle)"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"project_count"})," - Total number of projects"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"project_count_bucket"}),' - Coarse bucket (e.g., "1-5", "6-10")']}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"workspace_count"})," - Total number of workspaces"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"workspace_count_bucket"})," - Coarse bucket"]}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"feature_used"})})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"feature"})," - Name of the feature (string)"]}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"error"})})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"type"})," - Error category (string, no stack traces or details)"]}),"\n"]}),"\n",(0,b.jsx)(d.h4,{id:"agent-events",children:"Agent Events"}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"agent_run_start"})})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"provider"}),' - CLI provider ID (e.g., "claude-code", "codex")']}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:(0,b.jsx)(d.code,{children:"agent_run_finish"})})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"provider"})," - CLI provider ID"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"outcome"})," - Result: ",(0,b.jsx)(d.code,{children:"ok"})," or ",(0,b.jsx)(d.code,{children:"error"})," (no details)"]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"duration_ms"})," - How long the agent ran (clamped, no content)"]}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"what-we-dont-collect",children:"What We DON'T Collect"}),"\n",(0,b.jsxs)(d.p,{children:["We take privacy seriously. The following data is ",(0,b.jsx)(d.strong,{children:"never"})," collected:"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No code or file contents"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No file paths or repository names"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No prompts or messages sent to agents"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No environment variables"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No personally identifiable information (PII)"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No user text input or command contents"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No IP-derived location data"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No session recordings or screen captures"})]}),"\n",(0,b.jsxs)(d.li,{children:["❌ ",(0,b.jsx)(d.strong,{children:"No autocapture of user interactions"})]}),"\n"]}),"\n",(0,b.jsx)(d.h3,{id:"agent-usage-privacy",children:"Agent Usage Privacy"}),"\n",(0,b.jsx)(d.p,{children:"When tracking agent usage, we only collect:"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:'Provider name (e.g., "claude-code")'}),"\n",(0,b.jsx)(d.li,{children:"Start/finish timestamps"}),"\n",(0,b.jsx)(d.li,{children:"Success or failure outcome"}),"\n",(0,b.jsx)(d.li,{children:"Duration"}),"\n"]}),"\n",(0,b.jsxs)(d.p,{children:["We ",(0,b.jsx)(d.strong,{children:"do not"})," collect:"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:"Prompts or messages"}),"\n",(0,b.jsx)(d.li,{children:"Code changes"}),"\n",(0,b.jsx)(d.li,{children:"File paths"}),"\n",(0,b.jsx)(d.li,{children:"Workspace names or IDs"}),"\n",(0,b.jsx)(d.li,{children:"Any content from terminal streams"}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"how-it-works",children:"How It Works"}),"\n",(0,b.jsx)(d.h3,{id:"anonymous-identification",children:"Anonymous Identification"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:["A random ",(0,b.jsxs)(d.strong,{children:["anonymous ",(0,b.jsx)(d.code,{children:"instanceId"})]})," is generated on first launch"]}),"\n",(0,b.jsxs)(d.li,{children:["Stored locally in ",(0,b.jsx)(d.code,{children:"${appData}/telemetry.json"})]}),"\n",(0,b.jsxs)(d.li,{children:["Used as ",(0,b.jsx)(d.code,{children:"distinct_id"})," for telemetry events"]}),"\n",(0,b.jsx)(d.li,{children:"Not linked to any personal information"}),"\n"]}),"\n",(0,b.jsx)(d.h3,{id:"data-sanitization",children:"Data Sanitization"}),"\n",(0,b.jsxs)(d.p,{children:["All telemetry data passes through a ",(0,b.jsx)(d.strong,{children:"sanitizer"})," that:"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:"Only allows explicitly allowlisted properties"}),"\n",(0,b.jsx)(d.li,{children:"Drops any unexpected or sensitive data"}),"\n",(0,b.jsx)(d.li,{children:"Enforces data types and formats"}),"\n",(0,b.jsx)(d.li,{children:"Prevents accidental leakage"}),"\n"]}),"\n",(0,b.jsx)(d.h3,{id:"local-development",children:"Local Development"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:"Official builds include PostHog credentials via CI"}),"\n",(0,b.jsxs)(d.li,{children:["Local development builds ",(0,b.jsx)(d.strong,{children:"do not send telemetry"})," unless credentials are explicitly added for testing"]}),"\n",(0,b.jsx)(d.li,{children:"Development mode is clearly marked in events"}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"for-developers",children:"For Developers"}),"\n",(0,b.jsx)(d.h3,{id:"environment-variables",children:"Environment Variables"}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:"For Users:"})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"TELEMETRY_ENABLED"})," (default: ",(0,b.jsx)(d.code,{children:"true"}),") - Set to ",(0,b.jsx)(d.code,{children:"false"})," to disable"]}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:(0,b.jsx)(d.strong,{children:"For Maintainers:"})}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.code,{children:"INSTALL_SOURCE"})," - Labels distribution channel (e.g., ",(0,b.jsx)(d.code,{children:"dmg"}),", ",(0,b.jsx)(d.code,{children:"dev"}),")"]}),"\n",(0,b.jsx)(d.li,{children:"PostHog credentials are injected via CI for official builds"}),"\n"]}),"\n",(0,b.jsx)(d.h3,{id:"renderer-process-events",children:"Renderer Process Events"}),"\n",(0,b.jsxs)(d.p,{children:["The renderer may request sending ",(0,b.jsx)(d.code,{children:"feature_used"})," or ",(0,b.jsx)(d.code,{children:"error"})," events via IPC:"]}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:"Constrained IPC channel handled in main process"}),"\n",(0,b.jsx)(d.li,{children:"Only allowlisted properties are forwarded"}),"\n",(0,b.jsx)(d.li,{children:"Everything else is dropped by the sanitizer"}),"\n"]}),"\n",(0,b.jsx)(d.h3,{id:"adding-new-events",children:"Adding New Events"}),"\n",(0,b.jsx)(d.p,{children:"If you're contributing and want to add telemetry events:"}),"\n",(0,b.jsxs)(d.ol,{children:["\n",(0,b.jsx)(d.li,{children:"Only track coarse, anonymous metrics"}),"\n",(0,b.jsx)(d.li,{children:"Add event to allowlist in telemetry service"}),"\n",(0,b.jsx)(d.li,{children:"Document in this file"}),"\n",(0,b.jsx)(d.li,{children:"Ensure no PII or sensitive data is included"}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"transparency",children:"Transparency"}),"\n",(0,b.jsx)(d.p,{children:"We believe in transparency about data collection:"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsx)(d.li,{children:"This documentation is version-controlled and public"}),"\n",(0,b.jsxs)(d.li,{children:["Telemetry code is open source in our ",(0,b.jsx)(d.a,{href:"https://github.com/generalaction/emdash",children:"GitHub repository"})]}),"\n",(0,b.jsx)(d.li,{children:"Event definitions are hardcoded (no dynamic tracking)"}),"\n",(0,b.jsx)(d.li,{children:"You can audit exactly what is collected"}),"\n"]}),"\n",(0,b.jsx)(d.h2,{id:"questions",children:"Questions?"}),"\n",(0,b.jsx)(d.p,{children:"If you have questions or concerns about privacy:"}),"\n",(0,b.jsxs)(d.ul,{children:["\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.strong,{children:"Read the code"}),": Check ",(0,b.jsx)(d.code,{children:"src/main/services/telemetryService.ts"})]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.strong,{children:"Open an issue"}),": ",(0,b.jsx)(d.a,{href:"https://github.com/generalaction/emdash/issues",children:"GitHub Issues"})]}),"\n",(0,b.jsxs)(d.li,{children:[(0,b.jsx)(d.strong,{children:"Start a discussion"}),": ",(0,b.jsx)(d.a,{href:"https://github.com/generalaction/emdash/discussions",children:"GitHub Discussions"})]}),"\n"]}),"\n",(0,b.jsx)(d.p,{children:"We're happy to answer any privacy-related questions!"})]})}function h(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(g,{...a})}):g(a)}a.s(["default",()=>h,"frontmatter",()=>d,"structuredData",()=>e,"toc",0,f],9334)},83884,a=>{"use strict";var b=a.i(78918);let c={title:"Add a Task",description:"How to add a task in Emdash"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},59790,a=>{"use strict";var b=a.i(78918);let c={title:"Pass an Issue",description:"Pass an issue to Emdash agents"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},40197,a=>{"use strict";var b=a.i(78918);let c={title:"Installation",description:"Install Emdash on your system"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},2591,a=>{"use strict";var b=a.i(78918);let c={title:"Introduction",description:"Get started with Emdash"},d={contents:[{heading:void 0,content:"Emdash lets you run multiple coding agents in parallel—each isolated in its own Git worktree. It's provider-agnostic (supporting 15+ CLI providers like Claude Code, Codex, and GitHub Copilot), local-first, and designed for testing multiple approaches to the same problem or tackling multiple features simultaneously."},{heading:void 0,content:"Pass tickets directly from Linear, Jira, or GitHub Issues, review diffs side-by-side, and when the environment matters, run agents in isolated Docker containers. Everything stays on your machine—no code leaves your local environment except through the CLI providers you choose to use."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(c.p,{children:"Emdash lets you run multiple coding agents in parallel—each isolated in its own Git worktree. It's provider-agnostic (supporting 15+ CLI providers like Claude Code, Codex, and GitHub Copilot), local-first, and designed for testing multiple approaches to the same problem or tackling multiple features simultaneously."}),"\n",(0,b.jsx)(c.p,{children:"Pass tickets directly from Linear, Jira, or GitHub Issues, review diffs side-by-side, and when the environment matters, run agents in isolated Docker containers. Everything stays on your machine—no code leaves your local environment except through the CLI providers you choose to use."})]})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},15515,a=>{"use strict";var b=a.i(78918);let c={title:"Provider Agnostic",description:"Work with any AI provider"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},53313,a=>{"use strict";var b=a.i(78918);let c={title:"Parallel Agents",description:"Run multiple AI agents simultaneously"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},29497,a=>{"use strict";var b=a.i(78918);let c={title:"Kanban View",description:"Visualize your tasks"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},81836,a=>{"use strict";var b=a.i(78918);let c={title:"Diff View",description:"Review code changes"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},56465,a=>{"use strict";var b=a.i(78918);let c={title:"Containerization",description:"Isolated development environments"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},48563,a=>{"use strict";var b=a.i(78918);let c={title:"Best of N",description:"Compare multiple agent solutions"},d={contents:[{heading:void 0,content:"Coming soon..."}],headings:[]};function e(a){let c={p:"p",...a.components};return(0,b.jsx)(c.p,{children:"Coming soon..."})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},56584,a=>{"use strict";var b=a.i(78918);let c={title:"How to Contribute",description:"Help improve Emdash - contribution guidelines and development setup"},d={contents:[{heading:void 0,content:"Thanks for your interest in contributing! We favor small, focused PRs and clear intent over big bangs. This guide explains how to get set up, the workflow we use, and a few project‑specific conventions."},{heading:"prerequisites",content:"Node.js 20.0.0+ (recommended: 22.20.0) and Git"},{heading:"prerequisites",content:"Optional (recommended for end‑to‑end):"},{heading:"prerequisites",content:"Codex CLI (npm install -g @openai/codex or brew install codex; then run codex to authenticate)"},{heading:"prerequisites",content:"GitHub CLI (brew install gh; then gh auth login)"},{heading:"setup",content:"Tip: During development, the renderer hot‑reloads. Changes to the Electron main process (files in src/main) require a restart of the dev app."},{heading:"project-overview",content:"src/main/ – Electron main process, IPC handlers, services (Git, worktrees, Codex process manager, DB, etc.)"},{heading:"project-overview",content:"src/renderer/ – React UI (Vite), hooks, components"},{heading:"project-overview",content:'Local database – SQLite file created under the OS userData folder (see "Local DB" below)'},{heading:"project-overview",content:"Worktrees – Git worktrees are created outside your repo root in a sibling worktrees/ folder"},{heading:"project-overview",content:"Logs – Agent stream logs are written to the OS userData folder (not inside repos)"},{heading:"2-make-changes-and-keep-prs-small-and-focused",content:"Prefer a series of small PRs over one large one."},{heading:"2-make-changes-and-keep-prs-small-and-focused",content:"Include UI screenshots/GIFs when modifying the interface."},{heading:"2-make-changes-and-keep-prs-small-and-focused",content:"Update docs (README or inline help) when behavior changes."},{heading:"4-commit-using-conventional-commits",content:"feat: – new user‑facing capability"},{heading:"4-commit-using-conventional-commits",content:"fix: – bug fix"},{heading:"4-commit-using-conventional-commits",content:"chore:, refactor:, docs:, perf:, test: etc."},{heading:"4-commit-using-conventional-commits",content:"Examples:"},{heading:"5-open-a-pull-request",content:"Describe the change, rationale, and testing steps."},{heading:"5-open-a-pull-request",content:"Link related Issues."},{heading:"5-open-a-pull-request",content:"Keep the PR title in Conventional Commit format if possible."},{heading:"typescript--eslint",content:"Keep code type‑safe. Run npm run type-check before pushing."},{heading:"typescript--eslint",content:"Run npm run lint and address warnings where reasonable."},{heading:"electron-main-node-side",content:"Prefer execFile over exec to avoid shell quoting issues."},{heading:"electron-main-node-side",content:"Never write logs into Git worktrees. Stream logs belong in the Electron userData folder."},{heading:"electron-main-node-side",content:"Be conservative with console logging; noisy logs reduce signal. Use clear prefixes."},{heading:"git-and-worktrees",content:"The app creates worktrees in a sibling ../worktrees/ folder."},{heading:"git-and-worktrees",content:"Do not delete worktree folders from Finder/Explorer; if you need cleanup, use:"},{heading:"git-and-worktrees",content:"git worktree prune (from the main repo)"},{heading:"git-and-worktrees",content:"or the in‑app workspace removal"},{heading:"git-and-worktrees",content:"The file codex-stream.log is intentionally excluded from Git status and auto‑ignored in new worktrees."},{heading:"renderer-react",content:"Components live under src/renderer/components; hooks under src/renderer/hooks."},{heading:"renderer-react",content:"Streaming UI conventions:"},{heading:"renderer-react",content:'"Reasoning" content renders inside a collapsible.'},{heading:"renderer-react",content:"Response content is shown only after a codex marker."},{heading:"renderer-react",content:'While waiting for the first marker, show the minimal "loading/working" indicator.'},{heading:"renderer-react",content:"Use existing UI primitives and Tailwind utility classes for consistency."},{heading:"renderer-react",content:"Aim for accessible elements (labels, aria-* where appropriate)."},{heading:"local-db-sqlite",content:"Location (Electron app.getPath('userData')):"},{heading:"local-db-sqlite",content:"macOS: ~/Library/Application Support/emdash/emdash.db"},{heading:"local-db-sqlite",content:"Linux: ~/.config/emdash/emdash.db"},{heading:"local-db-sqlite",content:"Windows: %APPDATA%\\emdash\\emdash.db"},{heading:"local-db-sqlite",content:"Reset: quit the app, delete the file, relaunch (the schema is recreated)."},{heading:"issue-reports-and-feature-requests",content:"Use GitHub Issues. Include:"},{heading:"issue-reports-and-feature-requests",content:"OS, Node version"},{heading:"issue-reports-and-feature-requests",content:"Steps to reproduce"},{heading:"issue-reports-and-feature-requests",content:"Relevant logs (renderer console, terminal output)"},{heading:"issue-reports-and-feature-requests",content:"Screenshots/GIFs for UI issues"},{heading:"release-process-maintainers",content:"Use npm's built-in versioning to ensure consistency:"},{heading:"release-process-maintainers",content:"This automatically:"},{heading:"release-process-maintainers",content:"Updates package.json and package-lock.json"},{heading:"release-process-maintainers",content:'Creates a git commit with the version number (e.g., "0.2.10")'},{heading:"release-process-maintainers",content:"Creates a git tag (e.g., v0.2.10)"},{heading:"release-process-maintainers",content:"Then push to trigger the CI/CD pipeline."},{heading:"what-happens-next",content:"The GitHub Actions workflow (.github/workflows/release.yml) automatically:"},{heading:"what-happens-next",content:"Triggers when it detects the v* tag"},{heading:"what-happens-next",content:"Builds the TypeScript and Vite bundles"},{heading:"what-happens-next",content:"Signs the app with Apple Developer ID"},{heading:"what-happens-next",content:"Notarizes via Apple's notary service"},{heading:"what-happens-next",content:"Creates a GitHub Release with the DMG artifacts"},{heading:"what-happens-next",content:"Uploads signed DMGs for both arm64 and x64 architectures"}],headings:[{id:"quick-start",content:"Quick Start"},{id:"prerequisites",content:"Prerequisites"},{id:"setup",content:"Setup"},{id:"project-overview",content:"Project Overview"},{id:"development-workflow",content:"Development Workflow"},{id:"1-create-a-feature-branch",content:"1. Create a feature branch"},{id:"2-make-changes-and-keep-prs-small-and-focused",content:"2. Make changes and keep PRs small and focused"},{id:"3-run-checks-locally",content:"3. Run checks locally"},{id:"4-commit-using-conventional-commits",content:"4. Commit using Conventional Commits"},{id:"5-open-a-pull-request",content:"5. Open a Pull Request"},{id:"code-style-and-patterns",content:"Code Style and Patterns"},{id:"typescript--eslint",content:"TypeScript + ESLint"},{id:"electron-main-node-side",content:"Electron main (Node side)"},{id:"git-and-worktrees",content:"Git and worktrees"},{id:"renderer-react",content:"Renderer (React)"},{id:"local-db-sqlite",content:"Local DB (SQLite)"},{id:"issue-reports-and-feature-requests",content:"Issue Reports and Feature Requests"},{id:"release-process-maintainers",content:"Release Process (maintainers)"},{id:"what-happens-next",content:"What happens next"}]},e=[{depth:2,url:"#quick-start",title:(0,b.jsx)(b.Fragment,{children:"Quick Start"})},{depth:3,url:"#prerequisites",title:(0,b.jsx)(b.Fragment,{children:"Prerequisites"})},{depth:3,url:"#setup",title:(0,b.jsx)(b.Fragment,{children:"Setup"})},{depth:2,url:"#project-overview",title:(0,b.jsx)(b.Fragment,{children:"Project Overview"})},{depth:2,url:"#development-workflow",title:(0,b.jsx)(b.Fragment,{children:"Development Workflow"})},{depth:3,url:"#1-create-a-feature-branch",title:(0,b.jsx)(b.Fragment,{children:"1. Create a feature branch"})},{depth:3,url:"#2-make-changes-and-keep-prs-small-and-focused",title:(0,b.jsx)(b.Fragment,{children:"2. Make changes and keep PRs small and focused"})},{depth:3,url:"#3-run-checks-locally",title:(0,b.jsx)(b.Fragment,{children:"3. Run checks locally"})},{depth:3,url:"#4-commit-using-conventional-commits",title:(0,b.jsx)(b.Fragment,{children:"4. Commit using Conventional Commits"})},{depth:3,url:"#5-open-a-pull-request",title:(0,b.jsx)(b.Fragment,{children:"5. Open a Pull Request"})},{depth:2,url:"#code-style-and-patterns",title:(0,b.jsx)(b.Fragment,{children:"Code Style and Patterns"})},{depth:3,url:"#typescript--eslint",title:(0,b.jsx)(b.Fragment,{children:"TypeScript + ESLint"})},{depth:3,url:"#electron-main-node-side",title:(0,b.jsx)(b.Fragment,{children:"Electron main (Node side)"})},{depth:3,url:"#git-and-worktrees",title:(0,b.jsx)(b.Fragment,{children:"Git and worktrees"})},{depth:3,url:"#renderer-react",title:(0,b.jsx)(b.Fragment,{children:"Renderer (React)"})},{depth:3,url:"#local-db-sqlite",title:(0,b.jsx)(b.Fragment,{children:"Local DB (SQLite)"})},{depth:2,url:"#issue-reports-and-feature-requests",title:(0,b.jsx)(b.Fragment,{children:"Issue Reports and Feature Requests"})},{depth:2,url:"#release-process-maintainers",title:(0,b.jsx)(b.Fragment,{children:"Release Process (maintainers)"})},{depth:3,url:"#what-happens-next",title:(0,b.jsx)(b.Fragment,{children:"What happens next"})}];function f(a){let c={code:"code",h2:"h2",h3:"h3",li:"li",ol:"ol",p:"p",pre:"pre",span:"span",strong:"strong",ul:"ul",...a.components};return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(c.p,{children:"Thanks for your interest in contributing! We favor small, focused PRs and clear intent over big bangs. This guide explains how to get set up, the workflow we use, and a few project‑specific conventions."}),"\n",(0,b.jsx)(c.h2,{id:"quick-start",children:"Quick Start"}),"\n",(0,b.jsx)(c.h3,{id:"prerequisites",children:"Prerequisites"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Node.js 20.0.0+ (recommended: 22.20.0)"})," and Git"]}),"\n",(0,b.jsxs)(c.li,{children:["Optional (recommended for end‑to‑end):","\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["Codex CLI (",(0,b.jsx)(c.code,{children:"npm install -g @openai/codex"})," or ",(0,b.jsx)(c.code,{children:"brew install codex"}),"; then run ",(0,b.jsx)(c.code,{children:"codex"})," to authenticate)"]}),"\n",(0,b.jsxs)(c.li,{children:["GitHub CLI (",(0,b.jsx)(c.code,{children:"brew install gh"}),"; then ",(0,b.jsx)(c.code,{children:"gh auth login"}),")"]}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"setup",children:"Setup"}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(c.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" fill="currentColor" /></svg>',children:(0,b.jsxs)(c.code,{children:[(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# Fork this repo, then clone your fork"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"git"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" clone"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" https://github.com/"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#D73A49","--shiki-dark":"#F97583"},children:"<"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:"yo"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#24292E","--shiki-dark":"#E1E4E8"},children:"u"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#D73A49","--shiki-dark":"#F97583"},children:">"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:"/emdash.git"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#005CC5","--shiki-dark":"#79B8FF"},children:"cd"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" emdash"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# Use the correct Node.js version (if using nvm)"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"nvm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" use"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# Quick start: install dependencies and run dev server"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" d"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# Or run separately:"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" install"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" dev"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# Type checking, lint, build"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" type-check"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" lint"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" build"})]})]})})}),"\n",(0,b.jsxs)(c.p,{children:[(0,b.jsx)(c.strong,{children:"Tip:"})," During development, the renderer hot‑reloads. Changes to the Electron main process (files in ",(0,b.jsx)(c.code,{children:"src/main"}),") require a restart of the dev app."]}),"\n",(0,b.jsx)(c.h2,{id:"project-overview",children:"Project Overview"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"src/main/"})," – Electron main process, IPC handlers, services (Git, worktrees, Codex process manager, DB, etc.)"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"src/renderer/"})," – React UI (Vite), hooks, components"]}),"\n",(0,b.jsx)(c.li,{children:'Local database – SQLite file created under the OS userData folder (see "Local DB" below)'}),"\n",(0,b.jsxs)(c.li,{children:["Worktrees – Git worktrees are created outside your repo root in a sibling ",(0,b.jsx)(c.code,{children:"worktrees/"})," folder"]}),"\n",(0,b.jsx)(c.li,{children:"Logs – Agent stream logs are written to the OS userData folder (not inside repos)"}),"\n"]}),"\n",(0,b.jsx)(c.h2,{id:"development-workflow",children:"Development Workflow"}),"\n",(0,b.jsx)(c.h3,{id:"1-create-a-feature-branch",children:"1. Create a feature branch"}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(c.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" fill="currentColor" /></svg>',children:(0,b.jsx)(c.code,{children:(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"git"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" checkout"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#005CC5","--shiki-dark":"#79B8FF"},children:" -b"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" feat/"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#D73A49","--shiki-dark":"#F97583"},children:"<"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:"short-slu"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#24292E","--shiki-dark":"#E1E4E8"},children:"g"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#D73A49","--shiki-dark":"#F97583"},children:">"})]})})})}),"\n",(0,b.jsx)(c.h3,{id:"2-make-changes-and-keep-prs-small-and-focused",children:"2. Make changes and keep PRs small and focused"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsx)(c.li,{children:"Prefer a series of small PRs over one large one."}),"\n",(0,b.jsx)(c.li,{children:"Include UI screenshots/GIFs when modifying the interface."}),"\n",(0,b.jsx)(c.li,{children:"Update docs (README or inline help) when behavior changes."}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"3-run-checks-locally",children:"3. Run checks locally"}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(c.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" fill="currentColor" /></svg>',children:(0,b.jsxs)(c.code,{children:[(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" type-check"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" lint"})]}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" run"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" build"})]})]})})}),"\n",(0,b.jsx)(c.h3,{id:"4-commit-using-conventional-commits",children:"4. Commit using Conventional Commits"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"feat:"})," – new user‑facing capability"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"fix:"})," – bug fix"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"chore:"}),", ",(0,b.jsx)(c.code,{children:"refactor:"}),", ",(0,b.jsx)(c.code,{children:"docs:"}),", ",(0,b.jsx)(c.code,{children:"perf:"}),", ",(0,b.jsx)(c.code,{children:"test:"})," etc."]}),"\n"]}),"\n",(0,b.jsx)(c.p,{children:(0,b.jsx)(c.strong,{children:"Examples:"})}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(c.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="M 6,1 C 4.354992,1 3,2.354992 3,4 v 16 c 0,1.645008 1.354992,3 3,3 h 12 c 1.645008,0 3,-1.354992 3,-3 V 8 7 A 1.0001,1.0001 0 0 0 20.707031,6.2929687 l -5,-5 A 1.0001,1.0001 0 0 0 15,1 h -1 z m 0,2 h 7 v 3 c 0,1.645008 1.354992,3 3,3 h 3 v 11 c 0,0.564129 -0.435871,1 -1,1 H 6 C 5.4358712,21 5,20.564129 5,20 V 4 C 5,3.4358712 5.4358712,3 6,3 Z M 15,3.4140625 18.585937,7 H 16 C 15.435871,7 15,6.5641288 15,6 Z" fill="currentColor" /></svg>',children:(0,b.jsxs)(c.code,{children:[(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{children:"fix(chat): preserve stream state across workspace switches"})}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{})}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{children:"feat(ci): add type-check + build workflow for PRs"})})]})})}),"\n",(0,b.jsx)(c.h3,{id:"5-open-a-pull-request",children:"5. Open a Pull Request"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsx)(c.li,{children:"Describe the change, rationale, and testing steps."}),"\n",(0,b.jsx)(c.li,{children:"Link related Issues."}),"\n",(0,b.jsx)(c.li,{children:"Keep the PR title in Conventional Commit format if possible."}),"\n"]}),"\n",(0,b.jsx)(c.h2,{id:"code-style-and-patterns",children:"Code Style and Patterns"}),"\n",(0,b.jsx)(c.h3,{id:"typescript--eslint",children:"TypeScript + ESLint"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["Keep code type‑safe. Run ",(0,b.jsx)(c.code,{children:"npm run type-check"})," before pushing."]}),"\n",(0,b.jsxs)(c.li,{children:["Run ",(0,b.jsx)(c.code,{children:"npm run lint"})," and address warnings where reasonable."]}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"electron-main-node-side",children:"Electron main (Node side)"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["Prefer ",(0,b.jsx)(c.code,{children:"execFile"})," over ",(0,b.jsx)(c.code,{children:"exec"})," to avoid shell quoting issues."]}),"\n",(0,b.jsxs)(c.li,{children:["Never write logs into Git worktrees. Stream logs belong in the Electron ",(0,b.jsx)(c.code,{children:"userData"})," folder."]}),"\n",(0,b.jsx)(c.li,{children:"Be conservative with console logging; noisy logs reduce signal. Use clear prefixes."}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"git-and-worktrees",children:"Git and worktrees"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["The app creates worktrees in a sibling ",(0,b.jsx)(c.code,{children:"../worktrees/"})," folder."]}),"\n",(0,b.jsxs)(c.li,{children:["Do not delete worktree folders from Finder/Explorer; if you need cleanup, use:","\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.code,{children:"git worktree prune"})," (from the main repo)"]}),"\n",(0,b.jsx)(c.li,{children:"or the in‑app workspace removal"}),"\n"]}),"\n"]}),"\n",(0,b.jsxs)(c.li,{children:["The file ",(0,b.jsx)(c.code,{children:"codex-stream.log"})," is intentionally excluded from Git status and auto‑ignored in new worktrees."]}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"renderer-react",children:"Renderer (React)"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["Components live under ",(0,b.jsx)(c.code,{children:"src/renderer/components"}),"; hooks under ",(0,b.jsx)(c.code,{children:"src/renderer/hooks"}),"."]}),"\n",(0,b.jsxs)(c.li,{children:["Streaming UI conventions:","\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsx)(c.li,{children:'"Reasoning" content renders inside a collapsible.'}),"\n",(0,b.jsxs)(c.li,{children:["Response content is shown only after a ",(0,b.jsx)(c.code,{children:"codex"})," marker."]}),"\n",(0,b.jsx)(c.li,{children:'While waiting for the first marker, show the minimal "loading/working" indicator.'}),"\n"]}),"\n"]}),"\n",(0,b.jsx)(c.li,{children:"Use existing UI primitives and Tailwind utility classes for consistency."}),"\n",(0,b.jsxs)(c.li,{children:["Aim for accessible elements (labels, ",(0,b.jsx)(c.code,{children:"aria-*"})," where appropriate)."]}),"\n"]}),"\n",(0,b.jsx)(c.h3,{id:"local-db-sqlite",children:"Local DB (SQLite)"}),"\n",(0,b.jsxs)(c.p,{children:[(0,b.jsx)(c.strong,{children:"Location"})," (Electron ",(0,b.jsx)(c.code,{children:"app.getPath('userData')"}),"):"]}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsxs)(c.li,{children:["macOS: ",(0,b.jsx)(c.code,{children:"~/Library/Application Support/emdash/emdash.db"})]}),"\n",(0,b.jsxs)(c.li,{children:["Linux: ",(0,b.jsx)(c.code,{children:"~/.config/emdash/emdash.db"})]}),"\n",(0,b.jsxs)(c.li,{children:["Windows: ",(0,b.jsx)(c.code,{children:"%APPDATA%\\emdash\\emdash.db"})]}),"\n"]}),"\n",(0,b.jsxs)(c.p,{children:[(0,b.jsx)(c.strong,{children:"Reset:"})," quit the app, delete the file, relaunch (the schema is recreated)."]}),"\n",(0,b.jsx)(c.h2,{id:"issue-reports-and-feature-requests",children:"Issue Reports and Feature Requests"}),"\n",(0,b.jsx)(c.p,{children:"Use GitHub Issues. Include:"}),"\n",(0,b.jsxs)(c.ul,{children:["\n",(0,b.jsx)(c.li,{children:"OS, Node version"}),"\n",(0,b.jsx)(c.li,{children:"Steps to reproduce"}),"\n",(0,b.jsx)(c.li,{children:"Relevant logs (renderer console, terminal output)"}),"\n",(0,b.jsx)(c.li,{children:"Screenshots/GIFs for UI issues"}),"\n"]}),"\n",(0,b.jsx)(c.h2,{id:"release-process-maintainers",children:"Release Process (maintainers)"}),"\n",(0,b.jsx)(c.p,{children:"Use npm's built-in versioning to ensure consistency:"}),"\n",(0,b.jsx)(b.Fragment,{children:(0,b.jsx)(c.pre,{className:"shiki shiki-themes github-light github-dark",style:{"--shiki-light":"#24292e","--shiki-dark":"#e1e4e8","--shiki-light-bg":"#fff","--shiki-dark-bg":"#24292e"},tabIndex:"0",icon:'<svg viewBox="0 0 24 24"><path d="m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" fill="currentColor" /></svg>',children:(0,b.jsxs)(c.code,{children:[(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# For bug fixes (0.2.9 → 0.2.10)"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" version"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" patch"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# For new features (0.2.9 → 0.3.0)"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" version"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" minor"})]}),"\n",(0,b.jsx)(c.span,{className:"line"}),"\n",(0,b.jsx)(c.span,{className:"line",children:(0,b.jsx)(c.span,{style:{"--shiki-light":"#6A737D","--shiki-dark":"#6A737D"},children:"# For breaking changes (0.2.9 → 1.0.0)"})}),"\n",(0,b.jsxs)(c.span,{className:"line",children:[(0,b.jsx)(c.span,{style:{"--shiki-light":"#6F42C1","--shiki-dark":"#B392F0"},children:"npm"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" version"}),(0,b.jsx)(c.span,{style:{"--shiki-light":"#032F62","--shiki-dark":"#9ECBFF"},children:" major"})]})]})})}),"\n",(0,b.jsx)(c.p,{children:"This automatically:"}),"\n",(0,b.jsxs)(c.ol,{children:["\n",(0,b.jsxs)(c.li,{children:["Updates ",(0,b.jsx)(c.code,{children:"package.json"})," and ",(0,b.jsx)(c.code,{children:"package-lock.json"})]}),"\n",(0,b.jsxs)(c.li,{children:["Creates a git commit with the version number (e.g., ",(0,b.jsx)(c.code,{children:'"0.2.10"'}),")"]}),"\n",(0,b.jsxs)(c.li,{children:["Creates a git tag (e.g., ",(0,b.jsx)(c.code,{children:"v0.2.10"}),")"]}),"\n"]}),"\n",(0,b.jsx)(c.p,{children:"Then push to trigger the CI/CD pipeline."}),"\n",(0,b.jsx)(c.h3,{id:"what-happens-next",children:"What happens next"}),"\n",(0,b.jsxs)(c.p,{children:["The GitHub Actions workflow (",(0,b.jsx)(c.code,{children:".github/workflows/release.yml"}),") automatically:"]}),"\n",(0,b.jsxs)(c.ol,{children:["\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Triggers"})," when it detects the ",(0,b.jsx)(c.code,{children:"v*"})," tag"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Builds"})," the TypeScript and Vite bundles"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Signs"})," the app with Apple Developer ID"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Notarizes"})," via Apple's notary service"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Creates"})," a GitHub Release with the DMG artifacts"]}),"\n",(0,b.jsxs)(c.li,{children:[(0,b.jsx)(c.strong,{children:"Uploads"})," signed DMGs for both arm64 and x64 architectures"]}),"\n"]})]})}function g(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(f,{...a})}):f(a)}a.s(["default",()=>g,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,e])},67112,a=>{"use strict";var b=a.i(78918);let c={title:"Welcome to Emdash",description:"An open source orchestration layer for coding agents"},d={contents:[{heading:void 0,content:"Welcome to Emdash, an open source orchestration layer for coding agents."},{heading:void 0,content:"These docs are a work in progress."},{heading:void 0,content:"November 24th, 2025"}],headings:[]};function e(a){let c={em:"em",p:"p",...a.components};return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(c.p,{children:"Welcome to Emdash, an open source orchestration layer for coding agents."}),"\n",(0,b.jsx)(c.p,{children:"These docs are a work in progress."}),"\n",(0,b.jsx)(c.p,{children:(0,b.jsx)(c.em,{children:"November 24th, 2025"})})]})}function f(a={}){let{wrapper:c}=a.components||{};return c?(0,b.jsx)(c,{...a,children:(0,b.jsx)(e,{...a})}):e(a)}a.s(["default",()=>f,"frontmatter",()=>c,"structuredData",()=>d,"toc",0,[]])},84014,a=>{a.v({title:"Security",pages:["telemetry"]})},38699,a=>{a.v({title:"Get Started",pages:["index","installation","tasks"]})},24788,a=>{a.v({title:"Features",pages:["parallel-agents","containerization","provider-agnostic","best-of-n","kanban-view","diff-view"]})},52413,a=>{a.v({title:"Documentation",pages:["---Get Started---","get-started/index","get-started/installation","get-started/tasks","get-started/pass-an-issue","---Features---","features/parallel-agents","features/containerization","features/provider-agnostic","features/best-of-n","features/kanban-view","features/diff-view","---Contributing---","contributing/how-to-contribute","---Security---","security/telemetry"]})},58147,a=>{"use strict";var b=a.i(14747);function c(a={}){let{doc:{passthroughs:f=[]}={}}=a;function g(a,c){return a.startsWith("./")&&(a=a.slice(2)),{path:a,fullPath:b.join(c,a)}}function h(a){let b={body:a.default,toc:a.toc,structuredData:a.structuredData,_exports:a};for(let c of f)b[c]=a[c];return b}return{doc:async(a,b,c)=>await Promise.all(Object.entries(c).map(async([a,c])=>{let d="function"==typeof c?await c():c;return{...h(d),...d.frontmatter,...e(g(a,b),()=>d)}})),docLazy:async(a,b,c,d)=>await Promise.all(Object.entries(c).map(async([a,c])=>{let f="function"==typeof c?await c():c,i=d[a];return{...f,...e(g(a,b),i),load:async()=>h(await i())}})),meta:async(a,b,c)=>await Promise.all(Object.entries(c).map(async([a,c])=>{let d="function"==typeof c?await c():c;return{info:g(a,b),...d}})),async docs(a,b,c,e){return{docs:await this.doc(a,b,e),meta:await this.meta(a,b,c),toFumadocsSource(){return d(this.docs,this.meta)}}},async docsLazy(a,b,c,e,f){return{docs:await this.docLazy(a,b,e,f),meta:await this.meta(a,b,c),toFumadocsSource(){return d(this.docs,this.meta)}}}}}function d(a,b){let c=[];for(let b of a)c.push({type:"page",path:b.info.path,absolutePath:b.info.fullPath,data:b});for(let a of b)c.push({type:"meta",path:a.info.path,absolutePath:a.info.fullPath,data:a});return{files:c}}function e(b,c){return{info:b,async getText(d){if("raw"===d){let c=await a.A(60815);return(await c.readFile(b.fullPath)).toString()}let e=await c();if("string"!=typeof e._markdown)throw Error("getText('processed') requires `includeProcessedMarkdown` to be enabled in your collection config.");return e._markdown},async getMDAST(){let a=await c();if(!a._mdast)throw Error("getMDAST() requires `includeMDAST` to be enabled in your collection config.");return JSON.parse(a._mdast)}}}a.s(["server",()=>c,"toFumadocsSource",()=>d])},50182,a=>{"use strict";a.i(58147),a.s([])},52534,a=>a.a(async(b,c)=>{try{var d=a.i(9334),e=a.i(83884),f=a.i(59790),g=a.i(40197),h=a.i(2591),i=a.i(15515),j=a.i(53313),k=a.i(29497),l=a.i(81836),m=a.i(56465),n=a.i(48563),o=a.i(56584),p=a.i(67112),q=a.i(84014),r=a.i(38699),s=a.i(24788),t=a.i(52413);a.i(50182);var u=a.i(58147);let b=(0,u.server)({doc:{passthroughs:["extractedReferences"]}}),w=await b.docs("docs","content/docs",{"meta.json":t.default,"features/meta.json":s.default,"get-started/meta.json":r.default,"security/meta.json":q.default},{"index.mdx":p,"contributing/how-to-contribute.mdx":o,"features/best-of-n.mdx":n,"features/containerization.mdx":m,"features/diff-view.mdx":l,"features/kanban-view.mdx":k,"features/parallel-agents.mdx":j,"features/provider-agnostic.mdx":i,"get-started/index.mdx":h,"get-started/installation.mdx":g,"get-started/pass-an-issue.mdx":f,"get-started/tasks.mdx":e,"security/telemetry.mdx":d});a.s(["docs",0,w]),c()}catch(a){c(a)}},!0),62851,a=>a.a(async(b,c)=>{try{var d=a.i(63489),e=a.i(45321),f=a.i(52534),g=b([f]);[f]=g.then?(await g)():g;let h=(0,d.loader)({source:f.docs.toFumadocsSource(),baseUrl:"/",icon(a){if(a&&a in e)return e[a]}});a.s(["source",0,h]),c()}catch(a){c(a)}},!1),13842,81735,95972,a=>{"use strict";var b=a.i(78918),c=a.i(87938);a.s([],81735);let d=(a=new Map,b=null,c)=>({nextPart:a,validators:b,classGroupId:c}),e=[],f=(a,b,c)=>{if(0==a.length-b)return c.classGroupId;let d=a[b],e=c.nextPart.get(d);if(e){let c=f(a,b+1,e);if(c)return c}let g=c.validators;if(null===g)return;let h=0===b?a.join("-"):a.slice(b).join("-"),i=g.length;for(let a=0;a<i;a++){let b=g[a];if(b.validator(h))return b.classGroupId}},g=(a,b)=>{let c=d();for(let d in a)h(a[d],c,d,b);return c},h=(a,b,c,d)=>{let e=a.length;for(let f=0;f<e;f++)i(a[f],b,c,d)},i=(a,b,c,d)=>{"string"==typeof a?j(a,b,c):"function"==typeof a?k(a,b,c,d):l(a,b,c,d)},j=(a,b,c)=>{(""===a?b:m(b,a)).classGroupId=c},k=(a,b,c,d)=>{n(a)?h(a(d),b,c,d):(null===b.validators&&(b.validators=[]),b.validators.push({classGroupId:c,validator:a}))},l=(a,b,c,d)=>{let e=Object.entries(a),f=e.length;for(let a=0;a<f;a++){let[f,g]=e[a];h(g,m(b,f),c,d)}},m=(a,b)=>{let c=a,e=b.split("-"),f=e.length;for(let a=0;a<f;a++){let b=e[a],f=c.nextPart.get(b);f||(f=d(),c.nextPart.set(b,f)),c=f}return c},n=a=>"isThemeGetter"in a&&!0===a.isThemeGetter,o=[],p=(a,b,c,d,e)=>({modifiers:a,hasImportantModifier:b,baseClassName:c,maybePostfixModifierPosition:d,isExternal:e}),q=/\s+/,r=a=>{let b;if("string"==typeof a)return a;let c="";for(let d=0;d<a.length;d++)a[d]&&(b=r(a[d]))&&(c&&(c+=" "),c+=b);return c},s=[],t=a=>{let b=b=>b[a]||s;return b.isThemeGetter=!0,b},u=/^\[(?:(\w[\w-]*):)?(.+)\]$/i,w=/^\((?:(\w[\w-]*):)?(.+)\)$/i,x=/^\d+\/\d+$/,y=/^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,z=/\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,A=/^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,B=/^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,C=/^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,D=a=>x.test(a),E=a=>!!a&&!Number.isNaN(Number(a)),F=a=>!!a&&Number.isInteger(Number(a)),G=a=>a.endsWith("%")&&E(a.slice(0,-1)),H=a=>y.test(a),I=()=>!0,J=a=>z.test(a)&&!A.test(a),K=()=>!1,L=a=>B.test(a),M=a=>C.test(a),N=a=>!P(a)&&!V(a),O=a=>aa(a,ae,K),P=a=>u.test(a),Q=a=>aa(a,af,J),R=a=>aa(a,ag,E),S=a=>aa(a,ac,K),T=a=>aa(a,ad,M),U=a=>aa(a,ai,L),V=a=>w.test(a),W=a=>ab(a,af),X=a=>ab(a,ah),Y=a=>ab(a,ac),Z=a=>ab(a,ae),$=a=>ab(a,ad),_=a=>ab(a,ai,!0),aa=(a,b,c)=>{let d=u.exec(a);return!!d&&(d[1]?b(d[1]):c(d[2]))},ab=(a,b,c=!1)=>{let d=w.exec(a);return!!d&&(d[1]?b(d[1]):c)},ac=a=>"position"===a||"percentage"===a,ad=a=>"image"===a||"url"===a,ae=a=>"length"===a||"size"===a||"bg-size"===a,af=a=>"length"===a,ag=a=>"number"===a,ah=a=>"family-name"===a,ai=a=>"shadow"===a,aj=((a,...b)=>{let c,d,h,i,j=a=>{let b=d(a);if(b)return b;let e=((a,b)=>{let{parseClassName:c,getClassGroupId:d,getConflictingClassGroupIds:e,sortModifiers:f}=b,g=[],h=a.trim().split(q),i="";for(let a=h.length-1;a>=0;a-=1){let b=h[a],{isExternal:j,modifiers:k,hasImportantModifier:l,baseClassName:m,maybePostfixModifierPosition:n}=c(b);if(j){i=b+(i.length>0?" "+i:i);continue}let o=!!n,p=d(o?m.substring(0,n):m);if(!p){if(!o||!(p=d(m))){i=b+(i.length>0?" "+i:i);continue}o=!1}let q=0===k.length?"":1===k.length?k[0]:f(k).join(":"),r=l?q+"!":q,s=r+p;if(g.indexOf(s)>-1)continue;g.push(s);let t=e(p,o);for(let a=0;a<t.length;++a){let b=t[a];g.push(r+b)}i=b+(i.length>0?" "+i:i)}return i})(a,c);return h(a,e),e};return i=k=>{var l;let m;return d=(c={cache:(a=>{if(a<1)return{get:()=>void 0,set:()=>{}};let b=0,c=Object.create(null),d=Object.create(null),e=(e,f)=>{c[e]=f,++b>a&&(b=0,d=c,c=Object.create(null))};return{get(a){let b=c[a];return void 0!==b?b:void 0!==(b=d[a])?(e(a,b),b):void 0},set(a,b){a in c?c[a]=b:e(a,b)}}})((l=b.reduce((a,b)=>b(a),a())).cacheSize),parseClassName:(a=>{let{prefix:b,experimentalParseClassName:c}=a,d=a=>{let b,c=[],d=0,e=0,f=0,g=a.length;for(let h=0;h<g;h++){let g=a[h];if(0===d&&0===e){if(":"===g){c.push(a.slice(f,h)),f=h+1;continue}if("/"===g){b=h;continue}}"["===g?d++:"]"===g?d--:"("===g?e++:")"===g&&e--}let h=0===c.length?a:a.slice(f),i=h,j=!1;return h.endsWith("!")?(i=h.slice(0,-1),j=!0):h.startsWith("!")&&(i=h.slice(1),j=!0),p(c,j,i,b&&b>f?b-f:void 0)};if(b){let a=b+":",c=d;d=b=>b.startsWith(a)?c(b.slice(a.length)):p(o,!1,b,void 0,!0)}if(c){let a=d;d=b=>c({className:b,parseClassName:a})}return d})(l),sortModifiers:(m=new Map,l.orderSensitiveModifiers.forEach((a,b)=>{m.set(a,1e6+b)}),a=>{let b=[],c=[];for(let d=0;d<a.length;d++){let e=a[d],f="["===e[0],g=m.has(e);f||g?(c.length>0&&(c.sort(),b.push(...c),c=[]),b.push(e)):c.push(e)}return c.length>0&&(c.sort(),b.push(...c)),b}),...(a=>{let b=(a=>{let{theme:b,classGroups:c}=a;return g(c,b)})(a),{conflictingClassGroups:c,conflictingClassGroupModifiers:d}=a;return{getClassGroupId:a=>{if(a.startsWith("[")&&a.endsWith("]")){var c;let b,d,e;return -1===(c=a).slice(1,-1).indexOf(":")?void 0:(d=(b=c.slice(1,-1)).indexOf(":"),(e=b.slice(0,d))?"arbitrary.."+e:void 0)}let d=a.split("-"),e=+(""===d[0]&&d.length>1);return f(d,e,b)},getConflictingClassGroupIds:(a,b)=>{if(b){let b=d[a],f=c[a];if(b){if(f){let a=Array(f.length+b.length);for(let b=0;b<f.length;b++)a[b]=f[b];for(let c=0;c<b.length;c++)a[f.length+c]=b[c];return a}return b}return f||e}return c[a]||e}}})(l)}).cache.get,h=c.cache.set,i=j,j(k)},(...a)=>i(((...a)=>{let b,c,d=0,e="";for(;d<a.length;)(b=a[d++])&&(c=r(b))&&(e&&(e+=" "),e+=c);return e})(...a))})(()=>{let a=t("color"),b=t("font"),c=t("text"),d=t("font-weight"),e=t("tracking"),f=t("leading"),g=t("breakpoint"),h=t("container"),i=t("spacing"),j=t("radius"),k=t("shadow"),l=t("inset-shadow"),m=t("text-shadow"),n=t("drop-shadow"),o=t("blur"),p=t("perspective"),q=t("aspect"),r=t("ease"),s=t("animate"),u=()=>["auto","avoid","all","avoid-page","page","left","right","column"],w=()=>["center","top","bottom","left","right","top-left","left-top","top-right","right-top","bottom-right","right-bottom","bottom-left","left-bottom"],x=()=>[...w(),V,P],y=()=>["auto","hidden","clip","visible","scroll"],z=()=>["auto","contain","none"],A=()=>[V,P,i],B=()=>[D,"full","auto",...A()],C=()=>[F,"none","subgrid",V,P],J=()=>["auto",{span:["full",F,V,P]},F,V,P],K=()=>[F,"auto",V,P],L=()=>["auto","min","max","fr",V,P],M=()=>["start","end","center","between","around","evenly","stretch","baseline","center-safe","end-safe"],aa=()=>["start","end","center","stretch","center-safe","end-safe"],ab=()=>["auto",...A()],ac=()=>[D,"auto","full","dvw","dvh","lvw","lvh","svw","svh","min","max","fit",...A()],ad=()=>[a,V,P],ae=()=>[...w(),Y,S,{position:[V,P]}],af=()=>["no-repeat",{repeat:["","x","y","space","round"]}],ag=()=>["auto","cover","contain",Z,O,{size:[V,P]}],ah=()=>[G,W,Q],ai=()=>["","none","full",j,V,P],aj=()=>["",E,W,Q],ak=()=>["solid","dashed","dotted","double"],al=()=>["normal","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"],am=()=>[E,G,Y,S],an=()=>["","none",o,V,P],ao=()=>["none",E,V,P],ap=()=>["none",E,V,P],aq=()=>[E,V,P],ar=()=>[D,"full",...A()];return{cacheSize:500,theme:{animate:["spin","ping","pulse","bounce"],aspect:["video"],blur:[H],breakpoint:[H],color:[I],container:[H],"drop-shadow":[H],ease:["in","out","in-out"],font:[N],"font-weight":["thin","extralight","light","normal","medium","semibold","bold","extrabold","black"],"inset-shadow":[H],leading:["none","tight","snug","normal","relaxed","loose"],perspective:["dramatic","near","normal","midrange","distant","none"],radius:[H],shadow:[H],spacing:["px",E],text:[H],"text-shadow":[H],tracking:["tighter","tight","normal","wide","wider","widest"]},classGroups:{aspect:[{aspect:["auto","square",D,P,V,q]}],container:["container"],columns:[{columns:[E,P,V,h]}],"break-after":[{"break-after":u()}],"break-before":[{"break-before":u()}],"break-inside":[{"break-inside":["auto","avoid","avoid-page","avoid-column"]}],"box-decoration":[{"box-decoration":["slice","clone"]}],box:[{box:["border","content"]}],display:["block","inline-block","inline","flex","inline-flex","table","inline-table","table-caption","table-cell","table-column","table-column-group","table-footer-group","table-header-group","table-row-group","table-row","flow-root","grid","inline-grid","contents","list-item","hidden"],sr:["sr-only","not-sr-only"],float:[{float:["right","left","none","start","end"]}],clear:[{clear:["left","right","both","none","start","end"]}],isolation:["isolate","isolation-auto"],"object-fit":[{object:["contain","cover","fill","none","scale-down"]}],"object-position":[{object:x()}],overflow:[{overflow:y()}],"overflow-x":[{"overflow-x":y()}],"overflow-y":[{"overflow-y":y()}],overscroll:[{overscroll:z()}],"overscroll-x":[{"overscroll-x":z()}],"overscroll-y":[{"overscroll-y":z()}],position:["static","fixed","absolute","relative","sticky"],inset:[{inset:B()}],"inset-x":[{"inset-x":B()}],"inset-y":[{"inset-y":B()}],start:[{start:B()}],end:[{end:B()}],top:[{top:B()}],right:[{right:B()}],bottom:[{bottom:B()}],left:[{left:B()}],visibility:["visible","invisible","collapse"],z:[{z:[F,"auto",V,P]}],basis:[{basis:[D,"full","auto",h,...A()]}],"flex-direction":[{flex:["row","row-reverse","col","col-reverse"]}],"flex-wrap":[{flex:["nowrap","wrap","wrap-reverse"]}],flex:[{flex:[E,D,"auto","initial","none",P]}],grow:[{grow:["",E,V,P]}],shrink:[{shrink:["",E,V,P]}],order:[{order:[F,"first","last","none",V,P]}],"grid-cols":[{"grid-cols":C()}],"col-start-end":[{col:J()}],"col-start":[{"col-start":K()}],"col-end":[{"col-end":K()}],"grid-rows":[{"grid-rows":C()}],"row-start-end":[{row:J()}],"row-start":[{"row-start":K()}],"row-end":[{"row-end":K()}],"grid-flow":[{"grid-flow":["row","col","dense","row-dense","col-dense"]}],"auto-cols":[{"auto-cols":L()}],"auto-rows":[{"auto-rows":L()}],gap:[{gap:A()}],"gap-x":[{"gap-x":A()}],"gap-y":[{"gap-y":A()}],"justify-content":[{justify:[...M(),"normal"]}],"justify-items":[{"justify-items":[...aa(),"normal"]}],"justify-self":[{"justify-self":["auto",...aa()]}],"align-content":[{content:["normal",...M()]}],"align-items":[{items:[...aa(),{baseline:["","last"]}]}],"align-self":[{self:["auto",...aa(),{baseline:["","last"]}]}],"place-content":[{"place-content":M()}],"place-items":[{"place-items":[...aa(),"baseline"]}],"place-self":[{"place-self":["auto",...aa()]}],p:[{p:A()}],px:[{px:A()}],py:[{py:A()}],ps:[{ps:A()}],pe:[{pe:A()}],pt:[{pt:A()}],pr:[{pr:A()}],pb:[{pb:A()}],pl:[{pl:A()}],m:[{m:ab()}],mx:[{mx:ab()}],my:[{my:ab()}],ms:[{ms:ab()}],me:[{me:ab()}],mt:[{mt:ab()}],mr:[{mr:ab()}],mb:[{mb:ab()}],ml:[{ml:ab()}],"space-x":[{"space-x":A()}],"space-x-reverse":["space-x-reverse"],"space-y":[{"space-y":A()}],"space-y-reverse":["space-y-reverse"],size:[{size:ac()}],w:[{w:[h,"screen",...ac()]}],"min-w":[{"min-w":[h,"screen","none",...ac()]}],"max-w":[{"max-w":[h,"screen","none","prose",{screen:[g]},...ac()]}],h:[{h:["screen","lh",...ac()]}],"min-h":[{"min-h":["screen","lh","none",...ac()]}],"max-h":[{"max-h":["screen","lh",...ac()]}],"font-size":[{text:["base",c,W,Q]}],"font-smoothing":["antialiased","subpixel-antialiased"],"font-style":["italic","not-italic"],"font-weight":[{font:[d,V,R]}],"font-stretch":[{"font-stretch":["ultra-condensed","extra-condensed","condensed","semi-condensed","normal","semi-expanded","expanded","extra-expanded","ultra-expanded",G,P]}],"font-family":[{font:[X,P,b]}],"fvn-normal":["normal-nums"],"fvn-ordinal":["ordinal"],"fvn-slashed-zero":["slashed-zero"],"fvn-figure":["lining-nums","oldstyle-nums"],"fvn-spacing":["proportional-nums","tabular-nums"],"fvn-fraction":["diagonal-fractions","stacked-fractions"],tracking:[{tracking:[e,V,P]}],"line-clamp":[{"line-clamp":[E,"none",V,R]}],leading:[{leading:[f,...A()]}],"list-image":[{"list-image":["none",V,P]}],"list-style-position":[{list:["inside","outside"]}],"list-style-type":[{list:["disc","decimal","none",V,P]}],"text-alignment":[{text:["left","center","right","justify","start","end"]}],"placeholder-color":[{placeholder:ad()}],"text-color":[{text:ad()}],"text-decoration":["underline","overline","line-through","no-underline"],"text-decoration-style":[{decoration:[...ak(),"wavy"]}],"text-decoration-thickness":[{decoration:[E,"from-font","auto",V,Q]}],"text-decoration-color":[{decoration:ad()}],"underline-offset":[{"underline-offset":[E,"auto",V,P]}],"text-transform":["uppercase","lowercase","capitalize","normal-case"],"text-overflow":["truncate","text-ellipsis","text-clip"],"text-wrap":[{text:["wrap","nowrap","balance","pretty"]}],indent:[{indent:A()}],"vertical-align":[{align:["baseline","top","middle","bottom","text-top","text-bottom","sub","super",V,P]}],whitespace:[{whitespace:["normal","nowrap","pre","pre-line","pre-wrap","break-spaces"]}],break:[{break:["normal","words","all","keep"]}],wrap:[{wrap:["break-word","anywhere","normal"]}],hyphens:[{hyphens:["none","manual","auto"]}],content:[{content:["none",V,P]}],"bg-attachment":[{bg:["fixed","local","scroll"]}],"bg-clip":[{"bg-clip":["border","padding","content","text"]}],"bg-origin":[{"bg-origin":["border","padding","content"]}],"bg-position":[{bg:ae()}],"bg-repeat":[{bg:af()}],"bg-size":[{bg:ag()}],"bg-image":[{bg:["none",{linear:[{to:["t","tr","r","br","b","bl","l","tl"]},F,V,P],radial:["",V,P],conic:[F,V,P]},$,T]}],"bg-color":[{bg:ad()}],"gradient-from-pos":[{from:ah()}],"gradient-via-pos":[{via:ah()}],"gradient-to-pos":[{to:ah()}],"gradient-from":[{from:ad()}],"gradient-via":[{via:ad()}],"gradient-to":[{to:ad()}],rounded:[{rounded:ai()}],"rounded-s":[{"rounded-s":ai()}],"rounded-e":[{"rounded-e":ai()}],"rounded-t":[{"rounded-t":ai()}],"rounded-r":[{"rounded-r":ai()}],"rounded-b":[{"rounded-b":ai()}],"rounded-l":[{"rounded-l":ai()}],"rounded-ss":[{"rounded-ss":ai()}],"rounded-se":[{"rounded-se":ai()}],"rounded-ee":[{"rounded-ee":ai()}],"rounded-es":[{"rounded-es":ai()}],"rounded-tl":[{"rounded-tl":ai()}],"rounded-tr":[{"rounded-tr":ai()}],"rounded-br":[{"rounded-br":ai()}],"rounded-bl":[{"rounded-bl":ai()}],"border-w":[{border:aj()}],"border-w-x":[{"border-x":aj()}],"border-w-y":[{"border-y":aj()}],"border-w-s":[{"border-s":aj()}],"border-w-e":[{"border-e":aj()}],"border-w-t":[{"border-t":aj()}],"border-w-r":[{"border-r":aj()}],"border-w-b":[{"border-b":aj()}],"border-w-l":[{"border-l":aj()}],"divide-x":[{"divide-x":aj()}],"divide-x-reverse":["divide-x-reverse"],"divide-y":[{"divide-y":aj()}],"divide-y-reverse":["divide-y-reverse"],"border-style":[{border:[...ak(),"hidden","none"]}],"divide-style":[{divide:[...ak(),"hidden","none"]}],"border-color":[{border:ad()}],"border-color-x":[{"border-x":ad()}],"border-color-y":[{"border-y":ad()}],"border-color-s":[{"border-s":ad()}],"border-color-e":[{"border-e":ad()}],"border-color-t":[{"border-t":ad()}],"border-color-r":[{"border-r":ad()}],"border-color-b":[{"border-b":ad()}],"border-color-l":[{"border-l":ad()}],"divide-color":[{divide:ad()}],"outline-style":[{outline:[...ak(),"none","hidden"]}],"outline-offset":[{"outline-offset":[E,V,P]}],"outline-w":[{outline:["",E,W,Q]}],"outline-color":[{outline:ad()}],shadow:[{shadow:["","none",k,_,U]}],"shadow-color":[{shadow:ad()}],"inset-shadow":[{"inset-shadow":["none",l,_,U]}],"inset-shadow-color":[{"inset-shadow":ad()}],"ring-w":[{ring:aj()}],"ring-w-inset":["ring-inset"],"ring-color":[{ring:ad()}],"ring-offset-w":[{"ring-offset":[E,Q]}],"ring-offset-color":[{"ring-offset":ad()}],"inset-ring-w":[{"inset-ring":aj()}],"inset-ring-color":[{"inset-ring":ad()}],"text-shadow":[{"text-shadow":["none",m,_,U]}],"text-shadow-color":[{"text-shadow":ad()}],opacity:[{opacity:[E,V,P]}],"mix-blend":[{"mix-blend":[...al(),"plus-darker","plus-lighter"]}],"bg-blend":[{"bg-blend":al()}],"mask-clip":[{"mask-clip":["border","padding","content","fill","stroke","view"]},"mask-no-clip"],"mask-composite":[{mask:["add","subtract","intersect","exclude"]}],"mask-image-linear-pos":[{"mask-linear":[E]}],"mask-image-linear-from-pos":[{"mask-linear-from":am()}],"mask-image-linear-to-pos":[{"mask-linear-to":am()}],"mask-image-linear-from-color":[{"mask-linear-from":ad()}],"mask-image-linear-to-color":[{"mask-linear-to":ad()}],"mask-image-t-from-pos":[{"mask-t-from":am()}],"mask-image-t-to-pos":[{"mask-t-to":am()}],"mask-image-t-from-color":[{"mask-t-from":ad()}],"mask-image-t-to-color":[{"mask-t-to":ad()}],"mask-image-r-from-pos":[{"mask-r-from":am()}],"mask-image-r-to-pos":[{"mask-r-to":am()}],"mask-image-r-from-color":[{"mask-r-from":ad()}],"mask-image-r-to-color":[{"mask-r-to":ad()}],"mask-image-b-from-pos":[{"mask-b-from":am()}],"mask-image-b-to-pos":[{"mask-b-to":am()}],"mask-image-b-from-color":[{"mask-b-from":ad()}],"mask-image-b-to-color":[{"mask-b-to":ad()}],"mask-image-l-from-pos":[{"mask-l-from":am()}],"mask-image-l-to-pos":[{"mask-l-to":am()}],"mask-image-l-from-color":[{"mask-l-from":ad()}],"mask-image-l-to-color":[{"mask-l-to":ad()}],"mask-image-x-from-pos":[{"mask-x-from":am()}],"mask-image-x-to-pos":[{"mask-x-to":am()}],"mask-image-x-from-color":[{"mask-x-from":ad()}],"mask-image-x-to-color":[{"mask-x-to":ad()}],"mask-image-y-from-pos":[{"mask-y-from":am()}],"mask-image-y-to-pos":[{"mask-y-to":am()}],"mask-image-y-from-color":[{"mask-y-from":ad()}],"mask-image-y-to-color":[{"mask-y-to":ad()}],"mask-image-radial":[{"mask-radial":[V,P]}],"mask-image-radial-from-pos":[{"mask-radial-from":am()}],"mask-image-radial-to-pos":[{"mask-radial-to":am()}],"mask-image-radial-from-color":[{"mask-radial-from":ad()}],"mask-image-radial-to-color":[{"mask-radial-to":ad()}],"mask-image-radial-shape":[{"mask-radial":["circle","ellipse"]}],"mask-image-radial-size":[{"mask-radial":[{closest:["side","corner"],farthest:["side","corner"]}]}],"mask-image-radial-pos":[{"mask-radial-at":w()}],"mask-image-conic-pos":[{"mask-conic":[E]}],"mask-image-conic-from-pos":[{"mask-conic-from":am()}],"mask-image-conic-to-pos":[{"mask-conic-to":am()}],"mask-image-conic-from-color":[{"mask-conic-from":ad()}],"mask-image-conic-to-color":[{"mask-conic-to":ad()}],"mask-mode":[{mask:["alpha","luminance","match"]}],"mask-origin":[{"mask-origin":["border","padding","content","fill","stroke","view"]}],"mask-position":[{mask:ae()}],"mask-repeat":[{mask:af()}],"mask-size":[{mask:ag()}],"mask-type":[{"mask-type":["alpha","luminance"]}],"mask-image":[{mask:["none",V,P]}],filter:[{filter:["","none",V,P]}],blur:[{blur:an()}],brightness:[{brightness:[E,V,P]}],contrast:[{contrast:[E,V,P]}],"drop-shadow":[{"drop-shadow":["","none",n,_,U]}],"drop-shadow-color":[{"drop-shadow":ad()}],grayscale:[{grayscale:["",E,V,P]}],"hue-rotate":[{"hue-rotate":[E,V,P]}],invert:[{invert:["",E,V,P]}],saturate:[{saturate:[E,V,P]}],sepia:[{sepia:["",E,V,P]}],"backdrop-filter":[{"backdrop-filter":["","none",V,P]}],"backdrop-blur":[{"backdrop-blur":an()}],"backdrop-brightness":[{"backdrop-brightness":[E,V,P]}],"backdrop-contrast":[{"backdrop-contrast":[E,V,P]}],"backdrop-grayscale":[{"backdrop-grayscale":["",E,V,P]}],"backdrop-hue-rotate":[{"backdrop-hue-rotate":[E,V,P]}],"backdrop-invert":[{"backdrop-invert":["",E,V,P]}],"backdrop-opacity":[{"backdrop-opacity":[E,V,P]}],"backdrop-saturate":[{"backdrop-saturate":[E,V,P]}],"backdrop-sepia":[{"backdrop-sepia":["",E,V,P]}],"border-collapse":[{border:["collapse","separate"]}],"border-spacing":[{"border-spacing":A()}],"border-spacing-x":[{"border-spacing-x":A()}],"border-spacing-y":[{"border-spacing-y":A()}],"table-layout":[{table:["auto","fixed"]}],caption:[{caption:["top","bottom"]}],transition:[{transition:["","all","colors","opacity","shadow","transform","none",V,P]}],"transition-behavior":[{transition:["normal","discrete"]}],duration:[{duration:[E,"initial",V,P]}],ease:[{ease:["linear","initial",r,V,P]}],delay:[{delay:[E,V,P]}],animate:[{animate:["none",s,V,P]}],backface:[{backface:["hidden","visible"]}],perspective:[{perspective:[p,V,P]}],"perspective-origin":[{"perspective-origin":x()}],rotate:[{rotate:ao()}],"rotate-x":[{"rotate-x":ao()}],"rotate-y":[{"rotate-y":ao()}],"rotate-z":[{"rotate-z":ao()}],scale:[{scale:ap()}],"scale-x":[{"scale-x":ap()}],"scale-y":[{"scale-y":ap()}],"scale-z":[{"scale-z":ap()}],"scale-3d":["scale-3d"],skew:[{skew:aq()}],"skew-x":[{"skew-x":aq()}],"skew-y":[{"skew-y":aq()}],transform:[{transform:[V,P,"","none","gpu","cpu"]}],"transform-origin":[{origin:x()}],"transform-style":[{transform:["3d","flat"]}],translate:[{translate:ar()}],"translate-x":[{"translate-x":ar()}],"translate-y":[{"translate-y":ar()}],"translate-z":[{"translate-z":ar()}],"translate-none":["translate-none"],accent:[{accent:ad()}],appearance:[{appearance:["none","auto"]}],"caret-color":[{caret:ad()}],"color-scheme":[{scheme:["normal","dark","light","light-dark","only-dark","only-light"]}],cursor:[{cursor:["auto","default","pointer","wait","text","move","help","not-allowed","none","context-menu","progress","cell","crosshair","vertical-text","alias","copy","no-drop","grab","grabbing","all-scroll","col-resize","row-resize","n-resize","e-resize","s-resize","w-resize","ne-resize","nw-resize","se-resize","sw-resize","ew-resize","ns-resize","nesw-resize","nwse-resize","zoom-in","zoom-out",V,P]}],"field-sizing":[{"field-sizing":["fixed","content"]}],"pointer-events":[{"pointer-events":["auto","none"]}],resize:[{resize:["none","","y","x"]}],"scroll-behavior":[{scroll:["auto","smooth"]}],"scroll-m":[{"scroll-m":A()}],"scroll-mx":[{"scroll-mx":A()}],"scroll-my":[{"scroll-my":A()}],"scroll-ms":[{"scroll-ms":A()}],"scroll-me":[{"scroll-me":A()}],"scroll-mt":[{"scroll-mt":A()}],"scroll-mr":[{"scroll-mr":A()}],"scroll-mb":[{"scroll-mb":A()}],"scroll-ml":[{"scroll-ml":A()}],"scroll-p":[{"scroll-p":A()}],"scroll-px":[{"scroll-px":A()}],"scroll-py":[{"scroll-py":A()}],"scroll-ps":[{"scroll-ps":A()}],"scroll-pe":[{"scroll-pe":A()}],"scroll-pt":[{"scroll-pt":A()}],"scroll-pr":[{"scroll-pr":A()}],"scroll-pb":[{"scroll-pb":A()}],"scroll-pl":[{"scroll-pl":A()}],"snap-align":[{snap:["start","end","center","align-none"]}],"snap-stop":[{snap:["normal","always"]}],"snap-type":[{snap:["none","x","y","both"]}],"snap-strictness":[{snap:["mandatory","proximity"]}],touch:[{touch:["auto","none","manipulation"]}],"touch-x":[{"touch-pan":["x","left","right"]}],"touch-y":[{"touch-pan":["y","up","down"]}],"touch-pz":["touch-pinch-zoom"],select:[{select:["none","text","all","auto"]}],"will-change":[{"will-change":["auto","scroll","contents","transform",V,P]}],fill:[{fill:["none",...ad()]}],"stroke-w":[{stroke:[E,W,Q,R]}],stroke:[{stroke:["none",...ad()]}],"forced-color-adjust":[{"forced-color-adjust":["auto","none"]}]},conflictingClassGroups:{overflow:["overflow-x","overflow-y"],overscroll:["overscroll-x","overscroll-y"],inset:["inset-x","inset-y","start","end","top","right","bottom","left"],"inset-x":["right","left"],"inset-y":["top","bottom"],flex:["basis","grow","shrink"],gap:["gap-x","gap-y"],p:["px","py","ps","pe","pt","pr","pb","pl"],px:["pr","pl"],py:["pt","pb"],m:["mx","my","ms","me","mt","mr","mb","ml"],mx:["mr","ml"],my:["mt","mb"],size:["w","h"],"font-size":["leading"],"fvn-normal":["fvn-ordinal","fvn-slashed-zero","fvn-figure","fvn-spacing","fvn-fraction"],"fvn-ordinal":["fvn-normal"],"fvn-slashed-zero":["fvn-normal"],"fvn-figure":["fvn-normal"],"fvn-spacing":["fvn-normal"],"fvn-fraction":["fvn-normal"],"line-clamp":["display","overflow"],rounded:["rounded-s","rounded-e","rounded-t","rounded-r","rounded-b","rounded-l","rounded-ss","rounded-se","rounded-ee","rounded-es","rounded-tl","rounded-tr","rounded-br","rounded-bl"],"rounded-s":["rounded-ss","rounded-es"],"rounded-e":["rounded-se","rounded-ee"],"rounded-t":["rounded-tl","rounded-tr"],"rounded-r":["rounded-tr","rounded-br"],"rounded-b":["rounded-br","rounded-bl"],"rounded-l":["rounded-tl","rounded-bl"],"border-spacing":["border-spacing-x","border-spacing-y"],"border-w":["border-w-x","border-w-y","border-w-s","border-w-e","border-w-t","border-w-r","border-w-b","border-w-l"],"border-w-x":["border-w-r","border-w-l"],"border-w-y":["border-w-t","border-w-b"],"border-color":["border-color-x","border-color-y","border-color-s","border-color-e","border-color-t","border-color-r","border-color-b","border-color-l"],"border-color-x":["border-color-r","border-color-l"],"border-color-y":["border-color-t","border-color-b"],translate:["translate-x","translate-y","translate-none"],"translate-none":["translate","translate-x","translate-y","translate-z"],"scroll-m":["scroll-mx","scroll-my","scroll-ms","scroll-me","scroll-mt","scroll-mr","scroll-mb","scroll-ml"],"scroll-mx":["scroll-mr","scroll-ml"],"scroll-my":["scroll-mt","scroll-mb"],"scroll-p":["scroll-px","scroll-py","scroll-ps","scroll-pe","scroll-pt","scroll-pr","scroll-pb","scroll-pl"],"scroll-px":["scroll-pr","scroll-pl"],"scroll-py":["scroll-pt","scroll-pb"],touch:["touch-x","touch-y","touch-pz"],"touch-x":["touch"],"touch-y":["touch"],"touch-pz":["touch"]},conflictingClassGroupModifiers:{"font-size":["leading"]},orderSensitiveModifiers:["*","**","after","backdrop","before","details-content","file","first-letter","first-line","marker","placeholder","selection"]}});a.s(["cn",()=>aj],95972);let ak={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},al=(a,d)=>{let e=(0,c.forwardRef)(({className:a,size:e=24,color:f="currentColor",children:g,...h},i)=>(0,b.jsxs)("svg",{ref:i,...ak,width:e,height:e,stroke:f,className:aj("lucide",a),...h,children:[d.map(([a,b])=>(0,c.createElement)(a,b)),g]}));return e.displayName=a,e};al("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);let am=al("languages",[["path",{d:"m5 8 6 6",key:"1wu5hv"}],["path",{d:"m4 14 6-6 2-3",key:"1k1g8d"}],["path",{d:"M2 5h12",key:"or177f"}],["path",{d:"M7 2h1",key:"1t2jsx"}],["path",{d:"m22 22-5-10-5 10",key:"don7ne"}],["path",{d:"M14 18h6",key:"1m8k6r"}]]),an=al("panel-left",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}]]);al("chevrons-up-down",[["path",{d:"m7 15 5 5 5-5",key:"1hf1tw"}],["path",{d:"m7 9 5-5 5 5",key:"sgt6xg"}]]),al("search",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]]),al("external-link",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]),al("moon",[["path",{d:"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",key:"a7tn18"}]]);let ao=al("sun",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 20v2",key:"1lh1kg"}],["path",{d:"m4.93 4.93 1.41 1.41",key:"149t6j"}],["path",{d:"m17.66 17.66 1.41 1.41",key:"ptbguv"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"M20 12h2",key:"1q8mjw"}],["path",{d:"m6.34 17.66-1.41 1.41",key:"1m8zz5"}],["path",{d:"m19.07 4.93-1.41 1.41",key:"1shlcs"}]]);al("airplay",[["path",{d:"M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1",key:"ns4c3b"}],["path",{d:"m12 15 5 6H7Z",key:"14qnn2"}]]),al("menu",[["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}],["line",{x1:"4",x2:"20",y1:"6",y2:"6",key:"1owob3"}],["line",{x1:"4",x2:"20",y1:"18",y2:"18",key:"yk5zj1"}]]),al("x",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]),al("loader-circle",[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]]);let ap=al("circle-check",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]),aq=al("circle-x",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]]);al("check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]);let ar=al("triangle-alert",[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]]),as=al("info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]);al("copy",[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]),al("clipboard",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"1"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"2"}]]),al("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]),al("hash",[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]);let at=al("text",[["path",{d:"M15 18H3",key:"olowqp"}],["path",{d:"M17 6H3",key:"16j9eg"}],["path",{d:"M21 12H3",key:"2avoz0"}]]);al("file",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}]]),al("folder",[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]),al("folder-open",[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]),al("star",[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]);let au=al("link",[["path",{d:"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",key:"1cjeqo"}],["path",{d:"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",key:"19qd67"}]]),av=al("square-pen",[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]]);al("chevron-right",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]),al("chevron-left",[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]]),al("plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]),al("trash-2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]),al("chevron-up",[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]),a.s(["CircleCheck",0,ap,"CircleX",0,aq,"Edit",0,av,"Info",0,as,"Languages",0,am,"Link",0,au,"Sidebar",0,an,"Sun",0,ao,"Text",0,at,"TriangleAlert",0,ar],13842)},61489,a=>{"use strict";let b,c,d=a=>"boolean"==typeof a?`${a}`:0===a?"0":a,e=function(){for(var a,b,c=0,d="",e=arguments.length;c<e;c++)(a=arguments[c])&&(b=function a(b){var c,d,e="";if("string"==typeof b||"number"==typeof b)e+=b;else if("object"==typeof b)if(Array.isArray(b)){var f=b.length;for(c=0;c<f;c++)b[c]&&(d=a(b[c]))&&(e&&(e+=" "),e+=d)}else for(d in b)b[d]&&(e&&(e+=" "),e+=d);return e}(a))&&(d&&(d+=" "),d+=b);return d},f={primary:"bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/80",outline:"border hover:bg-fd-accent hover:text-fd-accent-foreground",ghost:"hover:bg-fd-accent hover:text-fd-accent-foreground",secondary:"border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"},g=(b="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",c={variants:{variant:f,color:f,size:{sm:"gap-1 px-2 py-1.5 text-xs",icon:"p-1.5 [&_svg]:size-5","icon-sm":"p-1.5 [&_svg]:size-4.5","icon-xs":"p-1 [&_svg]:size-4"}}},a=>{var f;if((null==c?void 0:c.variants)==null)return e(b,null==a?void 0:a.class,null==a?void 0:a.className);let{variants:g,defaultVariants:h}=c,i=Object.keys(g).map(b=>{let c=null==a?void 0:a[b],e=null==h?void 0:h[b];if(null===c)return null;let f=d(c)||d(e);return g[b][f]}),j=a&&Object.entries(a).reduce((a,b)=>{let[c,d]=b;return void 0===d||(a[c]=d),a},{});return e(b,i,null==c||null==(f=c.compoundVariants)?void 0:f.reduce((a,b)=>{let{class:c,className:d,...e}=b;return Object.entries(e).every(a=>{let[b,c]=a;return Array.isArray(c)?c.includes({...h,...j}[b]):({...h,...j})[b]===c})?[...a,c,d]:a},[]),null==a?void 0:a.class,null==a?void 0:a.className)});a.s(["buttonVariants",0,g],61489)},49851,a=>{"use strict";let b=(0,a.i(60052).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/docs/node_modules/fumadocs-core/dist/link.js <module evaluation> from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/docs/node_modules/fumadocs-core/dist/link.js <module evaluation>","default");a.s(["default",0,b])},31289,a=>{"use strict";let b=(0,a.i(60052).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/docs/node_modules/fumadocs-core/dist/link.js from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/docs/node_modules/fumadocs-core/dist/link.js","default");a.s(["default",0,b])},73147,a=>{"use strict";a.i(49851);var b=a.i(31289);a.n(b)}];

//# sourceMappingURL=docs_3537ad1e._.js.map