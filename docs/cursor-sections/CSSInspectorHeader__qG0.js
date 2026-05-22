// CSSInspectorHeader (qG0) — Toggle Design/CSS
// Extracted raw from workbench.desktop.main.js
// Length: 427 chars

function qG0(n){return(()=>{var e=Xmw(),t=e.firstChild,i=t.firstChild,r=i.nextSibling;return i.addEventListener("click",()=>n.setViewMode("visual")),r.addEventListener("click",()=>n.setViewMode("code")),Sn(s=>{var o=`css-inspector-toggle-btn ${n.viewMode()==="visual"?"active":""}`,a=`css-inspector-toggle-btn ${n.viewMode()==="code"?"active":""}`;return o!==s.e&&Pi(i,s.e=o),a!==s.t&&Pi(r,s.t=a),s},{e:void 0,t:void 0}),e})()}