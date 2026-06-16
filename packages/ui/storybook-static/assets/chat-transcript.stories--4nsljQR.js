import{j as n,r as l}from"./iframe-fRrJXGxS.js";import{C as u,T as d}from"./chat-transcript-CR1MPo-N.js";import"./preload-helper-Dp1pzeXC.js";import"./layout-store-CJ9Igkt1.js";import"./index-DmSHHlOL.js";import"./index-CcPffzVj.js";import"./render-tool-TTP8pYcx.js";function B(t){let r=t>>>0;return()=>{r|=0,r=r+1831565813|0;let e=Math.imul(r^r>>>15,1|r);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}const y="lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute".split(" ");function a(t,r,e){const o=r+Math.floor(t()*(e-r+1)),s=[];for(let c=0;c<o;c++)s.push(y[Math.floor(t()*y.length)]);const i=s.join(" ");return i.charAt(0).toUpperCase()+i.slice(1)}const _=["```typescript","function add(a: number, b: number): number {","  return a + b;","}","console.log(add(2, 3));","```"].join(`
`),A=["| Block | Strategy |","|-------|----------|","| prose | pretext  |","| code  | line-count |","| island | DOM measure |"].join(`
`);function z(t,r){switch(r%6){case 0:return a(t,8,40)+".";case 1:return`## ${a(t,2,5)}

${a(t,20,60)}.`;case 2:return[a(t,5,15)+":","",`- ${a(t,3,8)}`,`- ${a(t,3,8)}`,`- ${a(t,3,8)}`].join(`
`);case 3:return`${a(t,6,18)}.

${_}`;case 4:return`> ${a(t,8,24)}.`;default:return`${a(t,6,18)}.

${A}`}}const v=["read_file","write_file","run_command","search"];function H(t=6e3,r=1){const e=B(r),o=[];for(let s=0;s<t;s++){if(s%7===3){const c=["done","done","done","error"],x=c[Math.floor(e()*c.length)];o.push({kind:"tool",id:`tool-${s}`,name:v[Math.floor(e()*v.length)],status:x,inputSummary:`packages/ui/src/chat/${a(e,1,3).toLowerCase().replace(/ /g,"-")}.ts`,detail:x==="error"?a(e,5,12):void 0});continue}const i=s%2===0?"user":"assistant";o.push({kind:"message",id:`msg-${s}`,role:i,text:i==="user"?a(e,4,16)+"?":z(e,s)})}return o}const q=[{kind:"message",id:"msg-1",role:"user",text:"Can you explain how the projected layout model works?"},{kind:"message",id:"msg-2",role:"assistant",text:`
## Projected layout

Instead of letting the browser wrap text, we compute all line breaks ourselves:

1. **Prose** — \`walkRichInlineLineRanges\` + \`materializeRichInlineLineRange\` give exact x-offsets per fragment.
2. **Code** — split on \`\\n\`, each line at a fixed \`top = padY + i * lineHeight\`.
3. **Islands** — fixed height constant, corrected once the DOM renders.

> The key invariant: \`layoutMessage\` is the **single** source of truth for height AND geometry.

Here's the core loop:

\`\`\`typescript
walkRichInlineLineRanges(prepared, width, (range) => {
  const line = materializeRichInlineLineRange(prepared, range);
  // line.fragments carry x-offsets
});
\`\`\`

No browser reflow during scroll.
`.trim()},{kind:"tool",id:"tool-1",name:"read_file",status:"done",inputSummary:"packages/ui/src/chat/layout/layout-prose.ts"},{kind:"message",id:"msg-3",role:"user",text:"What about tables?"},{kind:"message",id:"msg-4",role:"assistant",text:`
Tables are treated as island blocks with DOM measure-once.

| Tier | Strategy | Who measures? |
|------|----------|---------------|
| prose | pretext rich-inline | LayoutStore |
| code | line count | LayoutStore |
| island | DOM once | IslandBlock ref |

After the first render the corrected height is cached and future scrolls are O(1).
`.trim()}],Z={title:"Chat/ChatTranscript",parameters:{layout:"fullscreen"},argTypes:{stickToBottom:{control:"boolean"}}};function N({stickToBottom:t}){const r=l.useRef(null);if(!r.current){const e=new d;e.seed(q),r.current=e}return n.jsx("div",{style:{height:"100vh",display:"flex",flexDirection:"column"},children:n.jsx(u,{store:r.current,stickToBottom:t})})}const m={args:{stickToBottom:!0},render:t=>n.jsx(N,{...t})},S=["Sure! ",`Here's the imperative renderer at work.

`,"It starts simply enough, ",`but **grows** with more and more content.

`,`> Each chunk triggers a re-layout of only this message.

`,"```typescript\nconst layout = layoutStore.getLayout(item, viewState);\n```\n\n","And ends cleanly."];function P(){const t=l.useRef(null);if(!t.current){const e=new d;e.seed([{kind:"message",id:"seed-1",role:"user",text:"Show me streaming."}]),t.current=e}const r=t.current;return l.useEffect(()=>{let e=0;const o=setInterval(()=>{e<S.length?r.appendMessageChunk("assistant","stream-1",S[e++]):(r.finalizeTurn(),clearInterval(o))},300);return()=>clearInterval(o)},[r]),n.jsx("div",{style:{height:"100vh",display:"flex",flexDirection:"column"},children:n.jsx(u,{store:r,stickToBottom:!0})})}const p={render:()=>n.jsx(P,{})};function U(){const t=l.useRef(null);if(!t.current){const r=new d;r.seed(H(6e3)),t.current=r}return n.jsx("div",{style:{height:"100vh",display:"flex",flexDirection:"column"},children:n.jsx(u,{store:t.current,stickToBottom:!1})})}const h={render:()=>n.jsx(U,{})};function Y(){const t=l.useRef(null);if(!t.current){const e=new d;e.seed([{kind:"message",id:"slot-msg-1",role:"user",text:"Show me a code block with an imperative slot override."},{kind:"message",id:"slot-msg-2",role:"assistant",text:"```typescript\nconst x = 42;\nconsole.log(x);\n```"}]),t.current=e}const r={renderCode:e=>{const o=document.createElement("pre");o.style.cssText="background:#1e1e1e;color:#d4d4d4;padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:12px;line-height:18px;";const s=document.createElement("code");if(s.textContent=e.code,o.appendChild(s),e.lang){const i=document.createElement("div");i.style.cssText="font-size:11px;color:#6b9bd2;margin-bottom:6px;font-family:var(--chat-mono);",i.textContent=e.lang,o.insertBefore(i,s)}return o}};return n.jsx("div",{style:{height:"100vh",display:"flex",flexDirection:"column"},children:n.jsx(u,{store:t.current,slots:r,stickToBottom:!1})})}const g={render:()=>n.jsx(Y,{})},f={render:()=>n.jsx("div",{style:{height:"100vh",display:"flex",flexDirection:"column"},children:n.jsx(u,{store:new d})})};var k,T,w;m.parameters={...m.parameters,docs:{...(k=m.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    stickToBottom: true
  },
  render: args => <TranscriptWrapper {...args} />
}`,...(w=(T=m.parameters)==null?void 0:T.docs)==null?void 0:w.source}}};var b,j,D;p.parameters={...p.parameters,docs:{...(b=p.parameters)==null?void 0:b.docs,source:{originalSource:`{
  render: () => <StreamingWrapper />
}`,...(D=(j=p.parameters)==null?void 0:j.docs)==null?void 0:D.source}}};var R,M,C;h.parameters={...h.parameters,docs:{...(R=h.parameters)==null?void 0:R.docs,source:{originalSource:`{
  render: () => <LargeTranscriptWrapper />
}`,...(C=(M=h.parameters)==null?void 0:M.docs)==null?void 0:C.source}}};var E,L,I;g.parameters={...g.parameters,docs:{...(E=g.parameters)==null?void 0:E.docs,source:{originalSource:`{
  render: () => <SlotDemoWrapper />
}`,...(I=(L=g.parameters)==null?void 0:L.docs)==null?void 0:I.source}}};var $,O,W;f.parameters={...f.parameters,docs:{...($=f.parameters)==null?void 0:$.docs,source:{originalSource:`{
  render: () => <div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column'
  }}>
      <ChatTranscript store={new TranscriptStore()} />
    </div>
}`,...(W=(O=f.parameters)==null?void 0:O.docs)==null?void 0:W.source}}};const ee=["Default","Streaming","LargeTranscript","ImperativeSlotDemo","Empty"];export{m as Default,f as Empty,g as ImperativeSlotDemo,h as LargeTranscript,p as Streaming,ee as __namedExportsOrder,Z as default};
