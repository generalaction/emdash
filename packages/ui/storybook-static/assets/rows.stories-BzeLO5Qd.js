import{j as o,r as D}from"./iframe-fRrJXGxS.js";import{r as se,s as ne,L as oe,D as ae,V as ie,a as le,m as ue}from"./layout-store-CJ9Igkt1.js";import{r as de}from"./render-tool-TTP8pYcx.js";import"./preload-helper-Dp1pzeXC.js";import"./index-DmSHHlOL.js";import"./index-CcPffzVj.js";function i({width:e=640,build:r}){const s=D.useRef(null);return D.useEffect(()=>{const t=s.current;if(!t)return;const n=ue();for(const[S,k]of Object.entries(n))t.style.setProperty(S,k);let a=r(t),u=!1;const d=()=>{for(typeof a=="function"&&a();t.firstChild;)t.firstChild.remove()};return se(()=>{u||(d(),a=r(t))}),()=>{u=!0,d()}},[]),o.jsx("div",{ref:s,className:ne["pchat-transcript"],style:{width:e,position:"relative",overflow:"visible"}})}function l(e,r,s,t,n){const a=ae,u=new oe(a),d=new ie;u.resetForWidth(t);const S={kind:"message",id:"row-preview",role:r,text:e,streaming:s||void 0},{node:k,dispose:re}=le(S,u,d,void 0,()=>{});return n.appendChild(k),re}function ce(e,r,s,t,n){const a={id:"tool-preview",name:e,status:r,inputSummary:s,detail:t};n.appendChild(de(a))}const xe={title:"Chat/Rows",argTypes:{text:{control:"text"},role:{control:"select",options:["user","assistant","thought"]},streaming:{control:"boolean"},width:{control:{type:"range",min:200,max:1200,step:10}}}},c={args:{text:"Hi there!",role:"user",streaming:!1,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}},h={args:{text:"Can you help me refactor the authentication service so it handles token refresh automatically, and also add proper error handling for network failures?",role:"user",streaming:!1,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}},m={args:{text:`Please fix these issues:
1. The button is not clickable
2. The form resets on submit
3. The modal does not close`,role:"user",streaming:!1,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}},g={args:{text:`I'll help you with that. Here's a refactored version of the authentication service:

\`\`\`typescript
class AuthService {
  async refreshToken(): Promise<void> {
    // implementation
  }
}
\`\`\`

This approach handles token refresh automatically.`,role:"assistant",streaming:!1,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}},p={args:{text:"Let me think about the best approach for this. The user wants token refresh to be automatic, which means I'll need to intercept 401 responses and retry with a fresh token.",role:"thought",streaming:!1,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}},w={args:{text:"I'm working on the implementation right now. The key insight is",role:"assistant",streaming:!0,width:640},render({text:e,role:r,streaming:s,width:t}){return o.jsx(i,{width:t,build:n=>l(e,r,s,t,n)})}};function y(e){return o.jsx(i,{width:e.width,build:r=>ce(e.name,e.status,e.inputSummary||void 0,e.showDetail&&e.detail?e.detail:void 0,r)})}const v={name:"read_file",status:"running",inputSummary:"src/auth/service.ts",detail:`{
  "path": "src/auth/service.ts",
  "encoding": "utf-8"
}`,showDetail:!1,width:640},f={args:{...v,status:"running"},render:e=>o.jsx(y,{...e})},x={args:{...v,status:"done"},render:e=>o.jsx(y,{...e})},b={args:{...v,status:"error",inputSummary:"File not found"},render:e=>o.jsx(y,{...e})},T={args:{...v,name:"write_file",status:"done",inputSummary:"src/auth/service.ts (+42 lines)",showDetail:!0},render:e=>o.jsx(y,{...e})};var R,j,H;c.parameters={...c.parameters,docs:{...(R=c.parameters)==null?void 0:R.docs,source:{originalSource:`{
  args: {
    text: 'Hi there!',
    role: 'user',
    streaming: false,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(H=(j=c.parameters)==null?void 0:j.docs)==null?void 0:H.source}}};var M,C,L;h.parameters={...h.parameters,docs:{...(M=h.parameters)==null?void 0:M.docs,source:{originalSource:`{
  args: {
    text: 'Can you help me refactor the authentication service so it handles token refresh automatically, and also add proper error handling for network failures?',
    role: 'user',
    streaming: false,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(L=(C=h.parameters)==null?void 0:C.docs)==null?void 0:L.source}}};var E,F,I;m.parameters={...m.parameters,docs:{...(E=m.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    text: 'Please fix these issues:\\n1. The button is not clickable\\n2. The form resets on submit\\n3. The modal does not close',
    role: 'user',
    streaming: false,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(I=(F=m.parameters)==null?void 0:F.docs)==null?void 0:I.source}}};var U,_,A;g.parameters={...g.parameters,docs:{...(U=g.parameters)==null?void 0:U.docs,source:{originalSource:`{
  args: {
    text: "I'll help you with that. Here's a refactored version of the authentication service:\\n\\n\`\`\`typescript\\nclass AuthService {\\n  async refreshToken(): Promise<void> {\\n    // implementation\\n  }\\n}\\n\`\`\`\\n\\nThis approach handles token refresh automatically.",
    role: 'assistant',
    streaming: false,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(A=(_=g.parameters)==null?void 0:_.docs)==null?void 0:A.source}}};var P,O,N;p.parameters={...p.parameters,docs:{...(P=p.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    text: "Let me think about the best approach for this. The user wants token refresh to be automatic, which means I'll need to intercept 401 responses and retry with a fresh token.",
    role: 'thought',
    streaming: false,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(N=(O=p.parameters)==null?void 0:O.docs)==null?void 0:N.source}}};var V,W,G;w.parameters={...w.parameters,docs:{...(V=w.parameters)==null?void 0:V.docs,source:{originalSource:`{
  args: {
    text: "I'm working on the implementation right now. The key insight is",
    role: 'assistant',
    streaming: true,
    width: 640
  },
  render({
    text,
    role,
    streaming,
    width
  }) {
    return <DomHost width={width} build={host => buildMessageRow(text, role, streaming, width, host)} />;
  }
}`,...(G=(W=w.parameters)==null?void 0:W.docs)==null?void 0:G.source}}};var q,z,B;f.parameters={...f.parameters,docs:{...(q=f.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    ...toolDefaults,
    status: 'running'
  },
  render: args => <ToolRow {...args} />
}`,...(B=(z=f.parameters)==null?void 0:z.docs)==null?void 0:B.source}}};var J,K,Q;x.parameters={...x.parameters,docs:{...(J=x.parameters)==null?void 0:J.docs,source:{originalSource:`{
  args: {
    ...toolDefaults,
    status: 'done'
  },
  render: args => <ToolRow {...args} />
}`,...(Q=(K=x.parameters)==null?void 0:K.docs)==null?void 0:Q.source}}};var X,Y,Z;b.parameters={...b.parameters,docs:{...(X=b.parameters)==null?void 0:X.docs,source:{originalSource:`{
  args: {
    ...toolDefaults,
    status: 'error',
    inputSummary: 'File not found'
  },
  render: args => <ToolRow {...args} />
}`,...(Z=(Y=b.parameters)==null?void 0:Y.docs)==null?void 0:Z.source}}};var $,ee,te;T.parameters={...T.parameters,docs:{...($=T.parameters)==null?void 0:$.docs,source:{originalSource:`{
  args: {
    ...toolDefaults,
    name: 'write_file',
    status: 'done',
    inputSummary: 'src/auth/service.ts (+42 lines)',
    showDetail: true
  },
  render: args => <ToolRow {...args} />
}`,...(te=(ee=T.parameters)==null?void 0:ee.docs)==null?void 0:te.source}}};const be=["UserShort","UserLong","UserMultiLine","Assistant","Thought","Streaming","ToolRunning","ToolDone","ToolError","ToolWithDetail"];export{g as Assistant,w as Streaming,p as Thought,x as ToolDone,b as ToolError,f as ToolRunning,T as ToolWithDetail,h as UserLong,m as UserMultiLine,c as UserShort,be as __namedExportsOrder,xe as default};
