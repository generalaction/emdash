import{j as o,r as p}from"./iframe-fRrJXGxS.js";import{b as g,V as Q,L as X}from"./layout-store-CJ9Igkt1.js";import{T as Y,C as Z}from"./chat-transcript-CR1MPo-N.js";import"./preload-helper-Dp1pzeXC.js";import"./index-DmSHHlOL.js";import"./index-CcPffzVj.js";import"./render-tool-TTP8pYcx.js";const d=[`Let me think through this carefully.
`,`First, I need to understand the problem domain.
`,`The key constraint is that we must preserve O(log n) update complexity.
`,`A Fenwick tree would be ideal here.
`,`We can use binary-indexed trees to sum prefix heights efficiently.
`,`The virtualizer needs two operations: point-update and prefix-sum.
`,`Let me sketch the implementation:

`,"```\nfunction update(i, delta) {\n",`  for (i++; i <= n; i += i & -i)
`,`    tree[i] += delta;
}
\`\`\`

`,`For the range query we do:

`,"```\nfunction query(i) {\n",`  let s = 0;
`,`  for (i++; i > 0; i -= i & -i)
`,`    s += tree[i];
  return s;
}
\`\`\`

`,`Now for scroll position we binary-search the prefix-sum tree.
`,`This gives us O(log n) for both updates and scroll-to-row.
`,`The virtualizer should store heights relative to their initial estimates.
`,`Correction is applied as a delta so we never need to rebuild the tree.
`,`This approach is similar to what Virtua uses internally.
`];function u({setup:n,height:r=480,width:i=640}){const e=p.useRef(null),t=p.useRef(null),s=p.useRef(null),a=p.useRef([]);e.current||(e.current=new Y),t.current||(t.current=new Q),s.current||(s.current=new X);const c=e.current,T=t.current;return p.useEffect(()=>{const f=a.current;function J(w,P){f.push(setTimeout(P,w))}const S=n(c,T,J);return()=>{typeof S=="function"&&S();for(const w of f)clearTimeout(w);f.length=0,c.reset()}},[]),o.jsx("div",{style:{width:i,height:r,overflow:"auto",border:"1px solid #e2e8f0",borderRadius:8},children:o.jsx(Z,{store:c,viewState:T,layoutStore:s.current??void 0})})}const ae={title:"Chat/Thinking",component:u,parameters:{layout:"centered"}},l={name:"Thinking / Active",render:()=>o.jsx(u,{setup:g((n,r,i)=>{const e="think-active-1";n.upsertThinking({id:e,startedAt:Date.now()});let t=0,s="";function a(){t>=d.length&&(t=0),s+=d[t++],n.upsertThinking({id:e,text:s}),i(220,a)}i(200,a)})})},h={name:"Thinking / Transition to Done",render:()=>o.jsx(u,{setup:g((n,r,i)=>{const e="think-transition-1",t=Date.now();n.upsertThinking({id:e,startedAt:t});let s=0,a="";function c(){if(s>=d.length){const T=Date.now()-t;n.upsertThinking({id:e,text:a,status:"done",durationMs:T});return}a+=d[s++],n.upsertThinking({id:e,text:a}),i(200,c)}i(200,c)})})},m={name:"Thinking / Done Collapsed",render:()=>o.jsx(u,{setup:g((n,r,i)=>{const e="think-done-collapsed-1",t=Date.now()-4800;n.seed([{kind:"thinking",id:e,status:"done",text:d.join(""),startedAt:t,durationMs:4800}]),r.setCollapsed(e,!0)})})},k={name:"Thinking / Done Expanded",render:()=>o.jsx(u,{setup:g((n,r,i)=>{const e="think-done-expanded-1",t=Date.now()-6200;n.seed([{kind:"thinking",id:e,status:"done",text:d.join(""),startedAt:t,durationMs:6200}])})})},x={name:"Thinking / In Mixed Transcript",render:()=>{const n=[{kind:"message",id:"msg-1",role:"user",text:"Can you help me implement a Fenwick tree virtualizer?"},{kind:"thinking",id:"think-mixed-1",status:"done",text:d.join(""),startedAt:Date.now()-5e3,durationMs:5e3},{kind:"message",id:"msg-2",role:"assistant",text:[`Sure! Here's the plan:
`,`1. Implement a **Fenwick tree** for prefix-sum height queries.
`,"2. Use binary search to map `scrollTop → row index`.\n","3. Track height deltas via `setSize(i, newH)` — O(log n).\n",`
This avoids a full tree rebuild on each height update.`].join("")}];return o.jsx(u,{setup:g((r,i,e)=>{r.seed(n),i.setCollapsed("think-mixed-1",!0)}),height:520})}};var v,N,y,A,D;l.parameters={...l.parameters,docs:{...(v=l.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Thinking / Active',
  render: () => <ScriptedChat setup={action((transcript, _viewState, schedule) => {
    const id = 'think-active-1';
    transcript.upsertThinking({
      id,
      startedAt: Date.now()
    });
    let tokenIdx = 0;
    let accumulated = '';
    function appendNextToken() {
      if (tokenIdx >= REASONING_TOKENS.length) {
        tokenIdx = 0; // loop
      }
      accumulated += REASONING_TOKENS[tokenIdx++];
      transcript.upsertThinking({
        id,
        text: accumulated
      });
      schedule(220, appendNextToken);
    }
    schedule(200, appendNextToken);
  })} />
}`,...(y=(N=l.parameters)==null?void 0:N.docs)==null?void 0:y.source},description:{story:`ThinkingActive — tokens stream in every 200ms, duration label ticks every second.
The row never transitions to done; stays active indefinitely.`,...(D=(A=l.parameters)==null?void 0:A.docs)==null?void 0:D.description}}};var C,I,E,_,O;h.parameters={...h.parameters,docs:{...(C=h.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: 'Thinking / Transition to Done',
  render: () => <ScriptedChat setup={action((transcript, _viewState, schedule) => {
    const id = 'think-transition-1';
    const startedAt = Date.now();
    transcript.upsertThinking({
      id,
      startedAt
    });
    let tokenIdx = 0;
    let accumulated = '';
    function appendNextToken() {
      if (tokenIdx >= REASONING_TOKENS.length) {
        // All tokens streamed — finalize
        const durationMs = Date.now() - startedAt;
        transcript.upsertThinking({
          id,
          text: accumulated,
          status: 'done',
          durationMs
        });
        return;
      }
      accumulated += REASONING_TOKENS[tokenIdx++];
      transcript.upsertThinking({
        id,
        text: accumulated
      });
      schedule(200, appendNextToken);
    }
    schedule(200, appendNextToken);
  })} />
}`,...(E=(I=h.parameters)==null?void 0:I.docs)==null?void 0:E.source},description:{story:`TransitionToDone — streams for ~3 s then transitions to done (collapsed by default).
Click the header to expand/collapse.`,...(O=(_=h.parameters)==null?void 0:_.docs)==null?void 0:O.description}}};var b,R,j,M,G;m.parameters={...m.parameters,docs:{...(b=m.parameters)==null?void 0:b.docs,source:{originalSource:`{
  name: 'Thinking / Done Collapsed',
  render: () => <ScriptedChat setup={action((transcript, viewState, _schedule) => {
    const id = 'think-done-collapsed-1';
    const startedAt = Date.now() - 4800;
    transcript.seed([{
      kind: 'thinking',
      id,
      status: 'done',
      text: REASONING_TOKENS.join(''),
      startedAt,
      durationMs: 4800
    }]);
    // Seed collapsed state to simulate the engine-transition default.
    viewState.setCollapsed(id, true);
  })} />
}`,...(j=(R=m.parameters)==null?void 0:R.docs)==null?void 0:j.source},description:{story:`DoneCollapsed — static done row; collapsed by default.
Click the header to expand.`,...(G=(M=m.parameters)==null?void 0:M.docs)==null?void 0:G.description}}};var K,z,F,q,H;k.parameters={...k.parameters,docs:{...(K=k.parameters)==null?void 0:K.docs,source:{originalSource:`{
  name: 'Thinking / Done Expanded',
  render: () => <ScriptedChat setup={action((transcript, _viewState, _schedule) => {
    const id = 'think-done-expanded-1';
    const startedAt = Date.now() - 6200;
    transcript.seed([{
      kind: 'thinking',
      id,
      status: 'done',
      text: REASONING_TOKENS.join(''),
      startedAt,
      durationMs: 6200
    }]);
    // Not seeded collapsed → expanded by default (viewState default is expanded).
  })} />
}`,...(F=(z=k.parameters)==null?void 0:z.docs)==null?void 0:F.source},description:{story:`DoneExpanded — static done row, pre-expanded.
Click the header to collapse.`,...(H=(q=k.parameters)==null?void 0:q.docs)==null?void 0:H.description}}};var L,V,U,W,B;x.parameters={...x.parameters,docs:{...(L=x.parameters)==null?void 0:L.docs,source:{originalSource:`{
  name: 'Thinking / In Mixed Transcript',
  render: () => {
    const items: ChatItem[] = [{
      kind: 'message',
      id: 'msg-1',
      role: 'user',
      text: 'Can you help me implement a Fenwick tree virtualizer?'
    }, {
      kind: 'thinking',
      id: 'think-mixed-1',
      status: 'done',
      text: REASONING_TOKENS.join(''),
      startedAt: Date.now() - 5000,
      durationMs: 5000
    }, {
      kind: 'message',
      id: 'msg-2',
      role: 'assistant',
      text: ["Sure! Here's the plan:\\n", '1. Implement a **Fenwick tree** for prefix-sum height queries.\\n', '2. Use binary search to map \`scrollTop → row index\`.\\n', '3. Track height deltas via \`setSize(i, newH)\` — O(log n).\\n', '\\nThis avoids a full tree rebuild on each height update.'].join('')
    }];
    return <ScriptedChat setup={action((transcript, viewState, _schedule) => {
      transcript.seed(items);
      // Collapse the thinking row by default (as the engine would).
      viewState.setCollapsed('think-mixed-1', true);
    })} height={520} />;
  }
}`,...(U=(V=x.parameters)==null?void 0:V.docs)==null?void 0:U.source},description:{story:"InMixedTranscript — a thinking row sandwiched between user/assistant messages.",...(B=(W=x.parameters)==null?void 0:W.docs)==null?void 0:B.description}}};const oe=["ThinkingActive","TransitionToDone","DoneCollapsed","DoneExpanded","InMixedTranscript"];export{m as DoneCollapsed,k as DoneExpanded,x as InMixedTranscript,l as ThinkingActive,h as TransitionToDone,oe as __namedExportsOrder,ae as default};
