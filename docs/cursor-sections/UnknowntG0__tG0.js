// UnknowntG0 (tG0) — unidentified
// Extracted raw from workbench.desktop.main.js
// Length: 274 chars

function tG0(n){if(n.byteLength<16||!(n[4]===102&&n[5]===116&&n[6]===121&&n[7]===112))return!1;const t=Math.min(n.byteLength,64),i=String.fromCharCode(...n.slice(0,t));return i.includes("heic")||i.includes("heix")||i.includes("hevc")||i.includes("hevx")||i.includes("heif")}