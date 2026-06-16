var H=Object.defineProperty;var I=(s,e,t)=>e in s?H(s,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):s[e]=t;var l=(s,e,t)=>I(s,typeof e!="symbol"?e+"":e,t);import{c as O,o as B,e as v,s as c,T as S,d as N,f as E,r as M,g as R,h as x,a as D,m as L,p as A,L as j,D as F,V}from"./layout-store-CJ9Igkt1.js";import{r as b,j as P}from"./iframe-fRrJXGxS.js";import{r as z}from"./render-tool-TTP8pYcx.js";class ie{constructor(){l(this,"committed",[]);l(this,"activeTurn",null);O(this,{committed:B.ref})}get items(){return this.activeTurn===null||this.activeTurn.length===0?this.committed:[...this.committed,...this.activeTurn]}seed(e){this.committed=Object.freeze([...e]),this.activeTurn=null}appendMessageChunk(e,t,n){this.activeTurn===null&&(this.activeTurn=[]);const i=this.activeTurn.find(a=>a.kind==="message"&&a.id===t);i?i.text+=n:this.activeTurn.push({kind:"message",id:t,role:e,text:n,streaming:!0})}upsertTool(e){this.activeTurn===null&&(this.activeTurn=[]);const t=this.activeTurn.find(n=>n.kind==="tool"&&n.id===e.id);t?(e.name!==void 0&&(t.name=e.name),e.status!==void 0&&(t.status=e.status),e.inputSummary!==void 0&&(t.inputSummary=e.inputSummary),e.detail!==void 0&&(t.detail=e.detail)):this.activeTurn.push({kind:"tool",id:e.id,name:e.name??"unknown",status:e.status??"running",inputSummary:e.inputSummary,detail:e.detail})}upsertThinking(e){this.activeTurn===null&&(this.activeTurn=[]);const t=this.activeTurn.find(n=>n.kind==="thinking"&&n.id===e.id);t?(e.text!==void 0&&(t.text=e.text),e.status!==void 0&&(t.status=e.status),e.durationMs!==void 0&&(t.durationMs=e.durationMs)):this.activeTurn.push({kind:"thinking",id:e.id,status:e.status??"thinking",text:e.text??"",startedAt:e.startedAt??Date.now(),durationMs:e.durationMs})}finalizeTurn(){if(!this.activeTurn)return;const e=this.activeTurn.map(t=>t.kind==="message"&&t.streaming?{...t,streaming:!1}:t.kind==="thinking"&&t.status==="thinking"?{...t,status:"done",durationMs:Date.now()-t.startedAt}:t);this.committed=Object.freeze([...this.committed,...e]),this.activeTurn=null}reset(){this.committed=[],this.activeTurn=null}}function _(s){return String(Math.floor(s/1e3))}function Y(s,e,t,n){return s.status==="thinking"?$(s):W(s,e,t,n)}function $(s){const e=Date.now()-s.startedAt,t=v("span",{className:c.pthinking__spinner}),n=v("span",{children:[`Thinking ${_(e)}s`]}),i=v("div",{className:c.pthinking__header,attrs:{"aria-live":"polite","aria-atomic":"false"},children:[t,n]}),a=v("div",{className:c["pthinking__window-text"],children:[s.text]}),r=v("div",{className:c.pthinking__window,children:[a]});return{node:v("div",{className:c.pthinking,style:{position:"relative",height:`${S+E}px`},children:[i,r]}),dispose:()=>{},live:{labelEl:n,windowTextEl:a}}}function W(s,e,t,n){const i=s.durationMs!==void 0?_(s.durationMs):"?",a=!t.isCollapsed(s.id),r=v("span",{className:`${c.pthinking__chevron}${a?` ${c["pthinking__chevron--expanded"]}`:""}`,attrs:{"aria-hidden":"true"},children:["›"]}),d=v("div",{className:`${c.pthinking__header} ${c["pthinking__header--done"]}`,attrs:{role:"button","aria-expanded":String(a),"data-collapse-id":s.id},children:[`Thought for ${i}s`,r]}),f=t.isCollapsed(s.id)?S:S+2*N+(e.measured.get(s.id)??E),u=v("div",{className:c.pthinking,style:{position:"relative",height:`${f}px`},children:[d]});if(a){const h=v("div",{className:c.pthinking__body,style:{top:`${S}px`},children:[s.text]});u.appendChild(h),requestAnimationFrame(()=>{const o=h.getBoundingClientRect().height;o>0&&n(s.id,o)})}return{node:u,dispose:()=>{}}}class K{constructor(){l(this,"mounted",new Map);l(this,"free",[])}acquire(){const e=this.free.pop()??v("div",{className:c["pchat-row"]});for(;e.firstChild;)e.removeChild(e.firstChild);return e}register(e,t){this.mounted.set(e,t)}unmount(e){const t=this.mounted.get(e);if(t){for(t.dispose(),t.node.parentNode&&t.node.parentNode.removeChild(t.node);t.node.firstChild;)t.node.removeChild(t.node.firstChild);this.free.push(t.node),this.mounted.delete(e)}}has(e){return this.mounted.has(e)}get(e){return this.mounted.get(e)}mountedIndices(){return this.mounted.keys()}disposeAll(){for(const e of[...this.mounted.keys()])this.unmount(e);this.free.length=0}}const U=48;class G{constructor(e){l(this,"el");l(this,"stuck",!0);l(this,"rafId",null);this.el=e,this.onScroll=this.onScroll.bind(this),this.el.addEventListener("scroll",this.onScroll,{passive:!0})}onScroll(){const e=this.el,t=e.scrollHeight-e.clientHeight-e.scrollTop;this.stuck=t<=U}schedule(){this.stuck&&this.rafId===null&&(this.rafId=requestAnimationFrame(()=>{if(this.rafId=null,this.stuck){const e=this.el;e.scrollTop=e.scrollHeight-e.clientHeight}}))}scrollToBottom(){this.el.scrollTop=this.el.scrollHeight-this.el.clientHeight}dispose(){this.rafId!==null&&(cancelAnimationFrame(this.rafId),this.rafId=null),this.el.removeEventListener("scroll",this.onScroll)}}class X{constructor(){l(this,"n",0);l(this,"sizes",new Float64Array(0));l(this,"bit",new Float64Array(0))}bitUpdate(e,t){for(let n=e+1;n<=this.n;n+=n&-n)this.bit[n]+=t}bitQuery(e){let t=0;for(let n=e+1;n>0;n-=n&-n)t+=this.bit[n];return t}setCount(e,t){const n=this.n;if(e>this.n){const i=new Float64Array(e),a=new Float64Array(e+1);i.set(this.sizes.subarray(0,n)),this.n=e,this.sizes=i,this.bit=a;for(let r=0;r<n;r++)this.bitUpdate(r,this.sizes[r]);for(let r=n;r<e;r++){const d=t(r);this.sizes[r]=d,this.bitUpdate(r,d)}}else if(e<this.n){const i=new Float64Array(e),a=new Float64Array(e+1);i.set(this.sizes.subarray(0,e)),this.n=e,this.sizes=i,this.bit=a;for(let r=0;r<e;r++)this.bitUpdate(r,this.sizes[r])}}setSize(e,t){if(e<0||e>=this.n)return 0;const n=this.sizes[e],i=t-n;return i===0?0:(this.sizes[e]=t,this.bitUpdate(e,i),i)}top(e){return e<=0?0:this.bitQuery(e-1)}total(){return this.n>0?this.bitQuery(this.n-1):0}size(e){return e>=0&&e<this.n?this.sizes[e]:0}get count(){return this.n}findIndex(e){if(this.n===0||e<=0)return 0;const t=this.total();if(e>=t)return Math.max(0,this.n-1);let n=0,i=1;for(;i<=this.n;)i<<=1;i>>=1;let a=0;for(;i>0;){const r=n+i;r<=this.n&&a+this.bit[r]<=e&&(a+=this.bit[r],n=r),i>>=1}return Math.min(n,this.n-1)}range(e,t,n=4){if(this.n===0)return{start:0,end:-1};const i=Math.max(0,this.findIndex(e)-n),a=Math.min(this.n-1,this.findIndex(e+t)+n);return{start:i,end:a}}}const C=8;class Q{constructor(e){l(this,"scrollEl");l(this,"canvasEl");l(this,"store");l(this,"viewState");l(this,"layoutStore");l(this,"slots");l(this,"doStickToBottom");l(this,"virt");l(this,"pool");l(this,"sticky");l(this,"rafPending",!1);l(this,"disposers",[]);l(this,"seededCollapsed",new Set);this.scrollEl=e.scrollEl,this.store=e.store,this.viewState=e.viewState,this.layoutStore=e.layoutStore,this.slots=e.slots,this.doStickToBottom=e.stickToBottom??!0,this.virt=new X,this.pool=new K,this.sticky=new G(e.scrollEl),this.canvasEl=document.createElement("div"),this.canvasEl.className=c["pchat-canvas"],this.scrollEl.appendChild(this.canvasEl);const t=L();for(const[u,h]of Object.entries(t))this.scrollEl.style.setProperty(u,h);this._syncCount(),this._renderVisible(),this.doStickToBottom&&this.sticky.scrollToBottom();const n=()=>this._scheduleFrame();this.scrollEl.addEventListener("scroll",n,{passive:!0}),this.disposers.push(()=>this.scrollEl.removeEventListener("scroll",n));let i=0;const a=new ResizeObserver(u=>{var o;const h=((o=u[0])==null?void 0:o.contentRect.width)??this.scrollEl.clientWidth;if(h>0&&h!==i){i=h,this.layoutStore.resetForWidth(h);const m=this.store.items;for(let p=0;p<this.virt.count;p++){const g=m[p];g&&this.virt.setSize(p,this.layoutStore.estimateHeight(g))}this._rerenderAll()}});a.observe(this.scrollEl),this.disposers.push(()=>a.disconnect()),M(()=>{this.layoutStore.resetForWidth(0);const u=i;u>0&&this.layoutStore.resetForWidth(u),this._rerenderAll()});const r=R(()=>{this.store.items.slice(),this._syncCount(),this._renderVisible(),this.doStickToBottom&&this.sticky.schedule()});this.disposers.push(r);const d=x(()=>this.viewState.collapseVersion,()=>{this._rerenderVisible()});this.disposers.push(d);const f=u=>{const h=u.target.closest("[data-collapse-id]");if(h){const o=h.dataset.collapseId;o&&this.viewState.toggleCollapsed(o)}};this.scrollEl.addEventListener("click",f),this.disposers.push(()=>this.scrollEl.removeEventListener("click",f))}_syncCount(){const e=this.store.items,t=e.length;this.virt.setCount(t,n=>{const i=e[n];return i?this.layoutStore.estimateHeight(i):60}),this.canvasEl.style.height=`${this.virt.total()}px`}_scheduleFrame(){this.rafPending||(this.rafPending=!0,requestAnimationFrame(()=>{this.rafPending=!1,this._renderVisible()}))}_renderVisible(){const{scrollTop:e,clientHeight:t}=this.scrollEl,{start:n,end:i}=this.virt.range(e,t,C),a=this.store.items;for(const r of[...this.pool.mountedIndices()])(r<n||r>i)&&this.pool.unmount(r);for(let r=n;r<=i;r++){if(this.pool.has(r)){const f=this.pool.get(r),u=a[r];if(f.wasStreaming&&(u==null?void 0:u.kind)==="message"&&!u.streaming)this.pool.unmount(r);else{this._positionRow(f.node,r);continue}}const d=a[r];d&&this._mountRow(r,d)}}_mountRow(e,t){const n=this.pool.acquire();n.dataset.index=String(e);let i,a,r=!1;const d=()=>{const o=this.layoutStore.getLayout(t,this.viewState),m=this.virt.setSize(e,o.height);this.canvasEl.style.height=`${this.virt.total()}px`,m!==0&&this.virt.top(e)<this.scrollEl.scrollTop&&(this.scrollEl.scrollTop+=m),this.doStickToBottom&&this.sticky.schedule()};if(t.kind==="message"){const o=D(t,this.layoutStore,this.viewState,this.slots,d);if(a=o.node,t.streaming&&o.patchRefs){r=!0;const{bubbleEl:m,contentEl:p}=o.patchRefs;let g=[];const w=(y,k)=>{this.layoutStore.setMeasured(y,k),d()},T=x(()=>t.text,()=>{this.layoutStore.invalidateItem(t.id);const y=A(m,p,t,this.layoutStore,this.viewState,this.slots,g,w);g=y.disposers;const k=this.virt.setSize(e,y.newHeight);this.canvasEl.style.height=`${this.virt.total()}px`,k!==0&&this.virt.top(e)<this.scrollEl.scrollTop&&(this.scrollEl.scrollTop+=k),this.doStickToBottom&&this.sticky.schedule()});i=()=>{T();for(const y of g)y();o.dispose()}}else i=o.dispose}else if(t.kind==="thinking"){const o=t,m=Y(o,this.layoutStore,this.viewState,(p,g)=>{this.layoutStore.setMeasured(p,g),d()});if(a=m.node,o.status==="thinking"&&m.live){const{labelEl:p,windowTextEl:g}=m.live,w=setInterval(()=>{const y=Math.floor((Date.now()-o.startedAt)/1e3);p.textContent=`Thinking ${y}s`},1e3),T=x(()=>({text:o.text,status:o.status}),({text:y,status:k})=>{g.textContent=y;const q=g.parentElement;q&&(q.scrollTop=q.scrollHeight),k==="done"&&!this.seededCollapsed.has(o.id)&&(this.seededCollapsed.add(o.id),clearInterval(w),this.viewState.setCollapsed(o.id,!0))},{fireImmediately:!0});i=()=>{clearInterval(w),T()}}else i=()=>{}}else a=z(t),i=()=>{};n.appendChild(a),this.canvasEl.appendChild(n);const u=this.layoutStore.getLayout(t,this.viewState).height,h=this.virt.setSize(e,u);this.canvasEl.style.height=`${this.virt.total()}px`,h!==0&&this.virt.top(e)<this.scrollEl.scrollTop&&(this.scrollEl.scrollTop+=h),this._positionRow(n,e),this.pool.register(e,{node:n,dispose:i,wasStreaming:r})}_positionRow(e,t){const n=this.virt.top(t),i=this.virt.size(t);e.style.transform=`translateY(${n}px)`,e.style.containIntrinsicSize=`0 ${i}px`}_rerenderAll(){for(const e of[...this.pool.mountedIndices()])this.pool.unmount(e);this._syncCount(),this._renderVisible()}_rerenderVisible(){const{scrollTop:e,clientHeight:t}=this.scrollEl,{start:n,end:i}=this.virt.range(e,t,C);for(let a=n;a<=i;a++)this.pool.unmount(a);this._renderVisible()}dispose(){this.pool.disposeAll(),this.sticky.dispose();for(const e of this.disposers)e();this.disposers=[],this.canvasEl.parentNode===this.scrollEl&&this.scrollEl.removeChild(this.canvasEl)}}function J({store:s,fonts:e=F,slots:t,stickToBottom:n=!0,className:i,viewState:a,layoutStore:r}){const d=b.useRef(null),f=b.useMemo(()=>new j(e),[e]),u=b.useMemo(()=>new V,[]),h=r??f,o=a??u,m=b.useRef(t);m.current=t,b.useEffect(()=>{if(!d.current)return;const g=new Q({scrollEl:d.current,store:s,viewState:o,layoutStore:h,get slots(){return m.current},stickToBottom:n,fonts:e});return()=>g.dispose()},[]);const p=i?`${c["pchat-transcript"]} ${i}`:c["pchat-transcript"];return P.jsx("div",{ref:d,className:p})}J.__docgenInfo={description:"",methods:[],displayName:"ChatTranscript",props:{store:{required:!0,tsType:{name:"TranscriptStore"},description:""},fonts:{required:!1,tsType:{name:"signature",type:"object",raw:`{
  body: VariantMetrics;
  bold: VariantMetrics;
  italic: VariantMetrics;
  boldItalic: VariantMetrics;
  link: VariantMetrics;
  h1: VariantMetrics;
  h2: VariantMetrics;
  h3: VariantMetrics;
  inlineCode: VariantMetrics;
  mention: VariantMetrics;
  code: VariantMetrics;
  codeLang: VariantMetrics;
  blockGap: number;
  bubblePadY: number;
  codeBlockPadX: number;
  codeBlockPadY: number;
  codeBlockBorder: number;
  inlineCodeExtraWidth: number;
  mentionExtraWidth: number;
  listIndent: number;
  blockquoteIndent: number;
  islandFixedHeight: number;
}`,signature:{properties:[{key:"body",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"bold",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"italic",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"boldItalic",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"link",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"h1",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"h2",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"h3",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"inlineCode",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"mention",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"code",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"codeLang",value:{name:"signature",type:"object",raw:`{
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
  font: string;
  lineHeight: number;
}`,signature:{properties:[{key:"font",value:{name:"string",required:!0},description:"CSS font shorthand, exactly matching the computed font of the rendered element."},{key:"lineHeight",value:{name:"number",required:!0}}]},required:!0}},{key:"blockGap",value:{name:"number",required:!0}},{key:"bubblePadY",value:{name:"number",required:!0}},{key:"codeBlockPadX",value:{name:"number",required:!0}},{key:"codeBlockPadY",value:{name:"number",required:!0}},{key:"codeBlockBorder",value:{name:"number",required:!0}},{key:"inlineCodeExtraWidth",value:{name:"number",required:!0}},{key:"mentionExtraWidth",value:{name:"number",required:!0}},{key:"listIndent",value:{name:"number",required:!0}},{key:"blockquoteIndent",value:{name:"number",required:!0}},{key:"islandFixedHeight",value:{name:"number",required:!0}}]}},description:"",defaultValue:{value:`{
  body: { font: BODY_FONT, lineHeight: BODY.lineHeight },
  bold: { font: BODY_BOLD_FONT, lineHeight: BODY.lineHeight },
  italic: { font: BODY_ITALIC_FONT, lineHeight: BODY.lineHeight },
  boldItalic: { font: BODY_BOLD_ITALIC_FONT, lineHeight: BODY.lineHeight },
  link: { font: BODY_LINK_FONT, lineHeight: BODY.lineHeight },
  h1: { font: H1_FONT, lineHeight: H1.lineHeight },
  h2: { font: H2_FONT, lineHeight: H2.lineHeight },
  h3: { font: H3_FONT, lineHeight: H3.lineHeight },
  inlineCode: { font: INLINE_CODE_FONT, lineHeight: INLINE_CODE.lineHeight },
  mention: { font: MENTION_FONT, lineHeight: MENTION.lineHeight },
  code: { font: CODE_BLOCK_FONT, lineHeight: CODE_BLOCK.lineHeight },
  codeLang: { font: CODE_BLOCK_FONT, lineHeight: CODE_LANG.lineHeight },
  blockGap: BLOCK_GAP,
  bubblePadY: BUBBLE_PAD_Y,
  codeBlockPadX: CODE_BLOCK_PAD_X,
  codeBlockPadY: CODE_BLOCK_PAD_Y,
  codeBlockBorder: CODE_BLOCK_BORDER,
  inlineCodeExtraWidth: INLINE_CODE_EXTRA_WIDTH,
  mentionExtraWidth: MENTION_EXTRA_WIDTH,
  listIndent: LIST_INDENT,
  blockquoteIndent: BLOCKQUOTE_INDENT,
  islandFixedHeight: ISLAND_FIXED_HEIGHT,
}`,computed:!1}},slots:{required:!1,tsType:{name:"signature",type:"object",raw:`{
  /** Override code block rendering. Return a DOM node or mount/unmount pair. */
  renderCode?: (block: Block & { tier: 'code' }) => MountResult;
  /** Override island rendering per type. */
  renderIsland?: Partial<Record<IslandType, (block: Block & { tier: 'island' }) => MountResult>>;
  /** Override mention chip: return a DOM Text/Element node. */
  renderMention?: (label: string, tone?: string) => Node;
}`,signature:{properties:[{key:"renderCode",value:{name:"signature",type:"function",raw:"(block: Block & { tier: 'code' }) => MountResult",signature:{arguments:[{type:{name:"intersection",raw:"Block & { tier: 'code' }",elements:[{name:"union",raw:"ProseBlock | CodeBlock | IslandBlock",elements:[{name:"signature",type:"object",raw:`{
  kind: 'prose';
  tier: 'prose';
  id: BlockId;
  variant: ProseVariant;
  runs: InlineRun[];
  /** Nesting depth (for list items and blockquotes). */
  depth?: number;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'prose'",required:!0}},{key:"tier",value:{name:"literal",value:"'prose'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"variant",value:{name:"union",raw:"'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'list-item' | 'quote'",elements:[{name:"literal",value:"'body'"},{name:"literal",value:"'h1'"},{name:"literal",value:"'h2'"},{name:"literal",value:"'h3'"},{name:"literal",value:"'h4'"},{name:"literal",value:"'h5'"},{name:"literal",value:"'h6'"},{name:"literal",value:"'list-item'"},{name:"literal",value:"'quote'"}],required:!0}},{key:"runs",value:{name:"Array",elements:[{name:"union",raw:"InlineText | InlineCode | InlineMention",elements:[{name:"signature",type:"object",raw:`{
  kind: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  href?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'text'",required:!0}},{key:"text",value:{name:"string",required:!0}},{key:"bold",value:{name:"boolean",required:!1}},{key:"italic",value:{name:"boolean",required:!1}},{key:"strike",value:{name:"boolean",required:!1}},{key:"href",value:{name:"string",required:!1}}]}},{name:"signature",type:"object",raw:`{
  kind: 'code';
  text: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'code'",required:!0}},{key:"text",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:`{
  kind: 'mention';
  label: string;
  /** Optional semantic tone for the chip colour. */
  tone?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'mention'",required:!0}},{key:"label",value:{name:"string",required:!0}},{key:"tone",value:{name:"string",required:!1},description:"Optional semantic tone for the chip colour."}]}}]}],raw:"InlineRun[]",required:!0}},{key:"depth",value:{name:"number",required:!1},description:"Nesting depth (for list items and blockquotes)."}]}},{name:"signature",type:"object",raw:`{
  kind: 'code';
  tier: 'code';
  id: BlockId;
  /** Raw source code. */
  code: string;
  /** Optional language hint (e.g. "typescript"). */
  lang?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'code'",required:!0}},{key:"tier",value:{name:"literal",value:"'code'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"code",value:{name:"string",required:!0},description:"Raw source code."},{key:"lang",value:{name:"string",required:!1},description:'Optional language hint (e.g. "typescript").'}]}},{name:"signature",type:"object",raw:`{
  kind: 'island';
  tier: 'island';
  id: BlockId;
  islandType: IslandType;
  /** Raw source (markdown table, math expression, mermaid definition, URL, or '-'). */
  raw: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'island'",required:!0}},{key:"tier",value:{name:"literal",value:"'island'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"islandType",value:{name:"union",raw:"'table' | 'math' | 'mermaid' | 'image' | 'rule'",elements:[{name:"literal",value:"'table'"},{name:"literal",value:"'math'"},{name:"literal",value:"'mermaid'"},{name:"literal",value:"'image'"},{name:"literal",value:"'rule'"}],required:!0}},{key:"raw",value:{name:"string",required:!0},description:"Raw source (markdown table, math expression, mermaid definition, URL, or '-')."}]}}]},{name:"signature",type:"object",raw:"{ tier: 'code' }",signature:{properties:[{key:"tier",value:{name:"literal",value:"'code'",required:!0}}]}}]},name:"block"}],return:{name:"union",raw:"Node | { mount: (host: HTMLElement) => void; unmount?: () => void }",elements:[{name:"Node"},{name:"signature",type:"object",raw:"{ mount: (host: HTMLElement) => void; unmount?: () => void }",signature:{properties:[{key:"mount",value:{name:"signature",type:"function",raw:"(host: HTMLElement) => void",signature:{arguments:[{type:{name:"HTMLElement"},name:"host"}],return:{name:"void"}},required:!0}},{key:"unmount",value:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}},required:!1}}]}}]}},required:!1},description:"Override code block rendering. Return a DOM node or mount/unmount pair."},{key:"renderIsland",value:{name:"Partial",elements:[{name:"Record",elements:[{name:"union",raw:"'table' | 'math' | 'mermaid' | 'image' | 'rule'",elements:[{name:"literal",value:"'table'"},{name:"literal",value:"'math'"},{name:"literal",value:"'mermaid'"},{name:"literal",value:"'image'"},{name:"literal",value:"'rule'"}],required:!0},{name:"signature",type:"function",raw:"(block: Block & { tier: 'island' }) => MountResult",signature:{arguments:[{type:{name:"intersection",raw:"Block & { tier: 'island' }",elements:[{name:"union",raw:"ProseBlock | CodeBlock | IslandBlock",elements:[{name:"signature",type:"object",raw:`{
  kind: 'prose';
  tier: 'prose';
  id: BlockId;
  variant: ProseVariant;
  runs: InlineRun[];
  /** Nesting depth (for list items and blockquotes). */
  depth?: number;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'prose'",required:!0}},{key:"tier",value:{name:"literal",value:"'prose'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"variant",value:{name:"union",raw:"'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'list-item' | 'quote'",elements:[{name:"literal",value:"'body'"},{name:"literal",value:"'h1'"},{name:"literal",value:"'h2'"},{name:"literal",value:"'h3'"},{name:"literal",value:"'h4'"},{name:"literal",value:"'h5'"},{name:"literal",value:"'h6'"},{name:"literal",value:"'list-item'"},{name:"literal",value:"'quote'"}],required:!0}},{key:"runs",value:{name:"Array",elements:[{name:"union",raw:"InlineText | InlineCode | InlineMention",elements:[{name:"signature",type:"object",raw:`{
  kind: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  href?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'text'",required:!0}},{key:"text",value:{name:"string",required:!0}},{key:"bold",value:{name:"boolean",required:!1}},{key:"italic",value:{name:"boolean",required:!1}},{key:"strike",value:{name:"boolean",required:!1}},{key:"href",value:{name:"string",required:!1}}]}},{name:"signature",type:"object",raw:`{
  kind: 'code';
  text: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'code'",required:!0}},{key:"text",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:`{
  kind: 'mention';
  label: string;
  /** Optional semantic tone for the chip colour. */
  tone?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'mention'",required:!0}},{key:"label",value:{name:"string",required:!0}},{key:"tone",value:{name:"string",required:!1},description:"Optional semantic tone for the chip colour."}]}}]}],raw:"InlineRun[]",required:!0}},{key:"depth",value:{name:"number",required:!1},description:"Nesting depth (for list items and blockquotes)."}]}},{name:"signature",type:"object",raw:`{
  kind: 'code';
  tier: 'code';
  id: BlockId;
  /** Raw source code. */
  code: string;
  /** Optional language hint (e.g. "typescript"). */
  lang?: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'code'",required:!0}},{key:"tier",value:{name:"literal",value:"'code'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"code",value:{name:"string",required:!0},description:"Raw source code."},{key:"lang",value:{name:"string",required:!1},description:'Optional language hint (e.g. "typescript").'}]}},{name:"signature",type:"object",raw:`{
  kind: 'island';
  tier: 'island';
  id: BlockId;
  islandType: IslandType;
  /** Raw source (markdown table, math expression, mermaid definition, URL, or '-'). */
  raw: string;
}`,signature:{properties:[{key:"kind",value:{name:"literal",value:"'island'",required:!0}},{key:"tier",value:{name:"literal",value:"'island'",required:!0}},{key:"id",value:{name:"string",required:!0}},{key:"islandType",value:{name:"union",raw:"'table' | 'math' | 'mermaid' | 'image' | 'rule'",elements:[{name:"literal",value:"'table'"},{name:"literal",value:"'math'"},{name:"literal",value:"'mermaid'"},{name:"literal",value:"'image'"},{name:"literal",value:"'rule'"}],required:!0}},{key:"raw",value:{name:"string",required:!0},description:"Raw source (markdown table, math expression, mermaid definition, URL, or '-')."}]}}]},{name:"signature",type:"object",raw:"{ tier: 'island' }",signature:{properties:[{key:"tier",value:{name:"literal",value:"'island'",required:!0}}]}}]},name:"block"}],return:{name:"union",raw:"Node | { mount: (host: HTMLElement) => void; unmount?: () => void }",elements:[{name:"Node"},{name:"signature",type:"object",raw:"{ mount: (host: HTMLElement) => void; unmount?: () => void }",signature:{properties:[{key:"mount",value:{name:"signature",type:"function",raw:"(host: HTMLElement) => void",signature:{arguments:[{type:{name:"HTMLElement"},name:"host"}],return:{name:"void"}},required:!0}},{key:"unmount",value:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}},required:!1}}]}}]}}}],raw:"Record<IslandType, (block: Block & { tier: 'island' }) => MountResult>"}],raw:"Partial<Record<IslandType, (block: Block & { tier: 'island' }) => MountResult>>",required:!1},description:"Override island rendering per type."},{key:"renderMention",value:{name:"signature",type:"function",raw:"(label: string, tone?: string) => Node",signature:{arguments:[{type:{name:"string"},name:"label"},{type:{name:"string"},name:"tone"}],return:{name:"Node"}},required:!1},description:"Override mention chip: return a DOM Text/Element node."}]}},description:""},stickToBottom:{required:!1,tsType:{name:"boolean"},description:"",defaultValue:{value:"true",computed:!1}},className:{required:!1,tsType:{name:"string"},description:""},viewState:{required:!1,tsType:{name:"ViewStateStore"},description:`Optional external ViewStateStore.  When provided the component uses it
directly instead of creating an internal one.  Useful for stories and
tests that need to pre-seed collapse state.`},layoutStore:{required:!1,tsType:{name:"LayoutStore"},description:`Optional external LayoutStore.  When provided the component uses it
directly instead of creating an internal one.`}}};export{J as C,ie as T};
