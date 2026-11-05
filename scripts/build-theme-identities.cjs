// Build passive theme artwork and both visual identity stylesheets from one map.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const escape=value=>String(value).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const circle=(x,y,r,extra='')=>`<circle cx="${x}" cy="${y}" r="${r}" ${extra}/>`;
const line=(x1,y1,x2,y2,extra='')=>`<path d="M${x1} ${y1}L${x2} ${y2}" ${extra}/>`;
const tree=(x,y,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0L-25 55H-13L-42 100H-18L-56 151H56L18 100H42L13 55H25Z"/><path d="M-5 145H5V174H-5Z"/></g>`;
function artwork(id,p,identity,index){
 const c=p.accent,t=p.muted,secondary=p.light?'#64748b':'#e0c3fc';
 const seed=index%5,kind=identity.motif;let art='';
 if(kind==='orbit')art=`<g transform="translate(1000 180) rotate(${seed*12-28})" fill="none">${[92,144,208].map(r=>`<ellipse rx="${r}" ry="${r*.44}"/>`).join('')}${circle(0,0,48,'fill="currentColor" fill-opacity=".12"')}${circle(126,22,9,'fill="currentColor"')}</g>`+Array.from({length:23},(_,i)=>circle(40+(i*167)%1130,20+(i*91)%700,i%4===0?2.2:1)).join('');
 if(kind==='cloud')art=Array.from({length:5},(_,i)=>`<path d="M${500+i*40} ${85+i*58}c80-50 92 28 170-4s100-20 190-8 170-70 260-32" fill="none" stroke-width="${i===0?3:1}"/>`).join('')+`<path d="M820 150c-20-70 95-98 122-40 50-36 112 3 95 48h-224" fill="none" stroke-width="2"/>`;
 if(kind==='crystal')art=[0,1,2,3].map(i=>`<g transform="translate(${790+i*84} ${170+i%2*50}) rotate(${i*13-15})"><path d="M0-118L51-53 34 108 0 150-38 100-53-51Z" fill="currentColor" fill-opacity=".08"/><path d="M0-118V150M-53-51H51M-38 100L51-53M34 108L-53-51" fill="none"/></g>`).join('');
 if(kind==='waves'||kind==='aurora')art=Array.from({length:7},(_,i)=>`<path d="M-80 ${560+i*24}C220 ${390-i*24} 360 ${780-i*22} 650 ${590-i*21}S1000 ${520-i*37} 1300 ${580-i*25}" fill="none" stroke-width="${kind==='aurora'?14:1.5}" stroke-opacity="${kind==='aurora'?.1+i*.025:.6}"/>`).join('');
 if(kind==='sun')art=circle(990,235,134,'fill="currentColor" fill-opacity=".1"')+Array.from({length:9},(_,i)=>line(844,210+i*17,1138,210+i*17)).join('')+'<path d="M0 750Q260 500 570 690T1200 610V800H0Z" fill="currentColor" fill-opacity=".1"/>';
 if(kind==='forest'||kind==='christmas')art=[0,1,2,3,4,5,6,7].map(i=>tree(50+i*155,575+i%3*20,.8+i%3*.2)).join('');
 if(kind==='mountain')art='<path d="M0 800L170 490 320 680 590 335 760 620 970 410 1200 770Z" fill="currentColor" fill-opacity=".09"/><path d="M170 490L120 583 170 560 205 586 230 565M590 335L515 466 590 429 638 468 670 451M970 410L900 513 972 482 1015 516 1050 499" fill="none" stroke-width="2"/>';
 if(kind==='contour')art=Array.from({length:9},(_,i)=>`<path d="M${730+i*22} -20C${1060+i*10} 50 ${620+i*19} 290 ${980+i*13} 400S${700+i*23} 700 ${1100+i*16} 850" fill="none"/>`).join('');
 if(['flower','leaves'].includes(kind)){
  art='<path d="M1200 760Q950 590 1000 180M1080 620Q830 570 740 420M1030 440Q1120 370 1165 290" fill="none" stroke-width="2"/>';
  for(let i=0;i<9;i++){const x=920+(i*57)%230,y=160+i*62;if(kind==='flower')art+=`<g transform="translate(${x} ${y}) rotate(${i*31})">${[0,72,144,216,288].map(a=>`<ellipse rx="10" ry="24" transform="rotate(${a}) translate(0 -18)" fill="currentColor" fill-opacity=".12"/>`).join('')}${circle(0,0,5)}</g>`;else art+=`<ellipse cx="${x}" cy="${y}" rx="12" ry="39" transform="rotate(${i%2?48:-44} ${x} ${y})" fill="currentColor" fill-opacity=".12"/>`;}
 }
 if(kind==='paper')art=Array.from({length:15},(_,i)=>line(0,50+i*53,1200,50+i*53,'stroke-opacity=".18"')).join('')+line(80,0,80,800,'stroke-opacity=".4"')+circle(1050,130,72,'stroke-dasharray="2 9"')+circle(1050,130,61);
 if(kind==='dial')art=`<g transform="translate(1040 170)">${[55,90,130].map(r=>circle(0,0,r,'fill="none"')).join('')}${Array.from({length:36},(_,i)=>`<path d="M0-108V-123" transform="rotate(${i*10})"/>`).join('')}<path d="M0 0L-40-55M0 0L60-22"/></g>`;
 if(kind==='race')art='<path d="M800 0H835L460 800H425ZM875 0H890L515 800H500Z" fill="currentColor" fill-opacity=".1" stroke="none"/>'+Array.from({length:9},(_,i)=>`<rect x="${950+i%2*38}" y="${30+i*38}" width="38" height="38" fill="currentColor" fill-opacity="${i%2?.12:.04}" stroke="none"/>`).join('');
 if(kind==='machine'||kind==='blueprint')art=Array.from({length:25},(_,i)=>line(i*50,0,i*50,800,'stroke-opacity=".15"')).join('')+Array.from({length:17},(_,i)=>line(0,i*50,1200,i*50,'stroke-opacity=".15"')).join('')+'<g transform="translate(1015 170)"><rect x="-100" y="-85" width="200" height="170" fill="none"/><path d="M-100-85L0-140 100-85M0-140V30M-100-85L0-30 100-85M0-30V85" fill="none"/>'+circle(0,0,135,'fill="none" stroke-dasharray="4 9"')+'</g>';
 if(kind==='circuit')art=Array.from({length:7},(_,i)=>`<path d="M${800+i*43} 0v${60+i*35}l-75 75v${200+i*32}l70 70v300" fill="none" stroke-width="${i%3===0?3:1}"/>`+circle(725+i*43,335+i*32,5,'fill="currentColor"')).join('');
 if(kind==='coffee')art=`<g transform="translate(1020 185) rotate(-12)">${circle(0,0,104,'fill="none" stroke-width="9" stroke-opacity=".18"')}${circle(0,0,94,'fill="none" stroke-width="2"')}<path d="M-43-27h75v50c0 45-75 45-75 0Zm75 7c65-16 65 64 0 49M-48 73h105M-20-50q-16-17 0-32M4-50q-16-17 0-32" fill="none" stroke-width="3"/></g>`;
 if(kind==='arches')art=Array.from({length:5},(_,i)=>`<path d="M${790+i*23} 800V240a${170-i*23} ${170-i*23} 0 0 1 ${340-i*46} 0v560" fill="none" stroke-width="2"/>`).join('')+circle(985,215,70,'fill="currentColor" fill-opacity=".07"');
 if(kind==='deco')art=`<g transform="translate(1000 210)">${Array.from({length:13},(_,i)=>`<path d="M0 165L${Math.sin((i-6)*.16)*200} ${165-Math.cos((i-6)*.16)*260}"/>`).join('')}<path d="M-165 0Q0-170 165 0" fill="none" stroke-width="3"/></g>`;
 if(kind==='citrus')art=`<g transform="translate(1020 200)">${circle(0,0,126,'fill="none" stroke-width="5"')}${circle(0,0,110,'fill="none"')}${Array.from({length:10},(_,i)=>`<path d="M0 0L0-110" transform="rotate(${i*36})"/>`).join('')}</g>`;
 if(kind==='tiles')art=Array.from({length:20},(_,i)=>`<rect x="${760+i%4*108}" y="${20+Math.floor(i/4)*108}" width="94" height="94" rx="${i%2?45:6}" fill="none"/>`).join('');
 const snow=()=>Array.from({length:42},(_,i)=>circle(20+i*137%1160,20+i*73%740,i%4===0?3:1.4,'fill="currentColor" stroke="none"')).join('');
 if(kind==='snow')art=snow()+[0,1,2].map(i=>`<g transform="translate(${910+i*85} ${170+i*140})">${[0,60,120].map(a=>`<path d="M0-65V65M-13-49L0-36 13-49M-13 49L0 36 13 49" transform="rotate(${a})" fill="none"/>`).join('')}</g>`).join('');
 if(kind==='halloween')art=circle(1015,190,115,'fill="#ffbd69" fill-opacity=".18" stroke="none"')+`<g fill="none" stroke-width="5"><path d="M1180 800L1105 390 1165 100M1105 390L990 300 955 180M1125 290L1030 210M1100 570L960 460 895 405M1190 620L1130 540 1195 450"/></g><path d="M775 245l22-20 20 19 20-19 22 20-42-9Z" fill="currentColor"/><g transform="translate(970 680)"><ellipse rx="70" ry="50" fill="#ff9e3d" fill-opacity=".24"/><ellipse rx="30" ry="50" fill="none"/><path d="M-7-45L0-67 15-72M-40-8L-22-25-10-8M10-8L25-25 40-8M-32 18Q0 47 32 18" fill="none" stroke-width="4"/></g><path d="M0 780Q260 725 500 770T1200 735V800H0Z" fill="currentColor" fill-opacity=".12" stroke="none"/>`;
 if(kind==='christmas')art+=snow()+`<path d="M740 0Q960 115 1200 15" fill="none" stroke-width="3"/>`+[0,1,2].map(i=>`<path d="M${865+i*125} 0V${85+i%2*45}"/>`+circle(865+i*125,112+i%2*45,27,`fill="${i===1?'#ec8791':'currentColor'}" fill-opacity=".22"`)).join('')+`<path d="M1040 210l8 19 21 2-16 14 5 21-18-11-18 11 5-21-16-14 21-2Z" fill="currentColor"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><title>${escape(identity.label)}</title><defs><linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c}" stop-opacity=".09"/><stop offset="1" stop-color="${secondary}" stop-opacity=".025"/></linearGradient></defs><rect width="1200" height="800" fill="url(#light)"/><g color="${c}" stroke="currentColor" fill="currentColor" stroke-width="1.4" opacity="${p.light?.48:.62}">${art}</g><path d="M24 45V24H45M1155 776h21v-21" fill="none" stroke="${t}" stroke-opacity=".22"/></svg>`;
}
function build(root){
 const core=path.join(root,'featherscript-extension/core');const identities=JSON.parse(fs.readFileSync(path.join(core,'theme-identities.json'),'utf8'));
 const presets=JSON.parse(fs.readFileSync(path.join(core,'theme-presets.json'),'utf8'));
 const original=[{id:'default',background:'#f2ecdc',surface:'#fbf7ec',accent:'#78501e',muted:'#6a5d41',light:true},{id:'dark',background:'#110f09',surface:'#201d13',accent:'#f1d377',muted:'#b3a78a'},{id:'midnight',background:'#020617',surface:'#0f172a',accent:'#38bdf8',muted:'#b5cde1'}];
 const all=[...original,...presets],seen=new Set();const desktop=[],extension=[];
 const assetDir=path.join(root,'featherscript-extension/assets/themes');fs.mkdirSync(assetDir,{recursive:true});
 all.forEach((p,index)=>{
  const identity=identities[p.id];if(!identity)throw Error('Missing identity '+p.id);if(!/^[a-z]+$/.test(p.id)||seen.has(p.id))throw Error('Invalid identity id');seen.add(p.id);
  if(!['sans','serif','mono'].includes(identity.heading)||!['solid','double','dashed'].includes(identity.edge)||!Number.isInteger(identity.radius)||identity.radius<0||identity.radius>32)throw Error('Invalid identity '+p.id);
  const image=artwork(p.id,p,identity,index);if(!image.includes('<path')&&!image.includes('<circle'))throw Error('Missing artwork '+p.id);
  fs.writeFileSync(path.join(assetDir,p.id+'.svg'),image+'\n');
  const font={sans:'var(--font-sans)',serif:'var(--font-serif)',mono:'var(--font-mono)'}[identity.heading];const texture=identity.heading==='mono'?'repeating-linear-gradient(0deg,transparent 0 31px,color-mix(in srgb,var(--accent) 5%,transparent) 31px 32px)':'linear-gradient(135deg,color-mix(in srgb,var(--accent) 4%,transparent),transparent 45%)';
  desktop.push(`body[data-theme="${p.id}"] {--identity-scene:url("../../featherscript-extension/assets/themes/${p.id}.svg");--identity-radius:${identity.radius}px;--identity-font:${font};--identity-edge:${identity.edge};--identity-texture:${texture};--identity-title:"${identity.label.toUpperCase()}";}`);
  desktop.push(`.preview-${p.id} {--identity-radius:${identity.radius}px;background-color:${p.background}!important;background-image:url("../../featherscript-extension/assets/themes/${p.id}.svg")!important;background-size:cover!important;background-position:right center!important;border:1px ${identity.edge} ${p.accent}66!important;border-radius:${Math.min(identity.radius,15)}px!important;} .preview-${p.id} :is(.tp-side,.tp-bar,.tp-block){display:none!important;} .preview-${p.id}::after{content:"${identity.label.toUpperCase()}";position:absolute;left:7px;bottom:7px;right:4px;font:600 7px/1.2 ui-monospace,monospace;letter-spacing:.03em;color:${p.accent};}`);
  extension.push(`html[data-zs-theme="${p.id}"] #zs-root {--zs-character-scene:url("assets/themes/${p.id}.svg");--zs-character-radius:${Math.min(identity.radius+2,28)}px;--zs-character-control-radius:${Math.min(10,Math.max(2,Math.round(identity.radius/2)))}px;--zs-character-label:"${identity.label.toUpperCase()}";--zs-character-edge:${identity.edge};--zs-character-font:${identity.heading==='serif'?'Georgia,serif':identity.heading==='mono'?'ui-monospace,monospace':'ui-sans-serif,system-ui'};}`);
 });
 if(Object.keys(identities).some(id=>!seen.has(id)))throw Error('Unknown theme identity');
 desktop.push(`body[data-theme] .panel {border-radius:var(--identity-radius,14px);border-style:var(--identity-edge,solid);background-image:var(--identity-texture);}
body[data-theme] :is(.topbar h2,.panel-head h3,.launch-hero h2){font-family:var(--identity-font,var(--font-sans));}
body[data-theme] .theme-preview{position:relative;isolation:isolate;overflow:hidden;}
body[data-theme]:not(.has-custom-scene) .app-ambient::before{opacity:.12;}
body[data-theme]:not(.has-custom-scene) .app-ambient::after{content:"";position:absolute;inset:0;background-image:var(--identity-scene);background-position:right center;background-size:cover;opacity:.9;filter:none;pointer-events:none;}
body[data-theme] .launch-route{background-image:var(--identity-scene);background-size:cover;background-position:right center;}
body[data-theme] .route-feather{border-radius:var(--identity-radius,14px);border-style:var(--identity-edge,solid);}
body[data-theme] .topbar-kicker::after{content:" / " var(--identity-title);opacity:.7;font-size:8px;letter-spacing:.1em;}
body[data-theme] .theme-preview::after{pointer-events:none;}
body[data-theme] .theme-preview{min-height:68px;}
@media(max-width:700px){body[data-theme] .topbar-kicker::after{display:none;}}
`);
 extension.push(`html[data-zs-theme] #zs-root #zs-bar {border-radius:var(--zs-character-radius,18px);border-style:var(--zs-character-edge,solid);background-image:var(--zs-character-scene),linear-gradient(140deg,var(--zs-bar-1),var(--zs-bar-3))!important;background-size:auto 100%,100% 100%;background-position:right center;background-repeat:no-repeat;}
html[data-zs-theme] #zs-root :is(#zs-menu,#zs-workflow-panel){border-radius:var(--zs-character-radius,16px);border-style:var(--zs-character-edge,solid);background-image:var(--zs-character-scene);background-size:cover;background-position:right center;}
html[data-zs-theme] #zs-root :is(.zs-brand-name,#zs-workflow-panel header b){font-family:var(--zs-character-font,ui-sans-serif);}
html[data-zs-theme] #zs-root #zs-bar::before{background-image:none;animation:none;}
html[data-zs-preset] .zs-chip{--chip-ink:var(--zs-ink);--chip-ink-soft:var(--zs-ink-soft);--chip-face-1:var(--zs-preset-surface);--chip-face-2:var(--zs-preset-background);--chip-line:var(--zs-ink-line);}
html[data-zs-preset]:not(.zs-light) .zs-chip.err{--chip-ink:#fecaca;--chip-ink-soft:#fda4af;border-color:#fb7185;}
html[data-zs-preset].zs-light .zs-chip.err{--chip-ink:#991b1b;--chip-ink-soft:#9f1239;border-color:#be123c;}
html[data-zs-theme] #zs-root :is(#zs-brand,#zs-state){color:var(--zs-ink);}
html[data-zs-theme] #zs-root .zs-brand-name{color:var(--zs-ink);-webkit-text-fill-color:var(--zs-ink);}
html[data-zs-theme] #zs-root #zs-control-deck :is(#zs-skill-status,#zs-script-profile,#zs-pc-permissions){color:var(--zs-ink);}
@media(max-width:620px){#zs-root #zs-bar:not(.is-min) .zs-free{display:none;}#zs-root #zs-bar:not(.is-min) #zs-conn{font-size:9px;padding:0 8px;}#zs-root #zs-bar:not(.is-min) .zs-brand-name{font-size:12px;}}
`);
 const header='/* Generated by scripts/build-theme-identities.cjs from core/theme-identities.json. */\n';
 fs.writeFileSync(path.join(root,'featherscript-app/renderer/theme-identities.css'),header+desktop.join('\n'));
 fs.writeFileSync(path.join(root,'featherscript-extension/theme-identities.css'),header+extension.join('\n'));
 console.log(`Built ${all.length} theme identities and passive local illustrations.`);
}
module.exports={build,artwork};if(require.main===module)build(path.resolve(process.argv[2]||path.join(__dirname,'..')));
