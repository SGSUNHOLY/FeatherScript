// Shared, passive scene layers. CSS owns all motion; theme changes do no frame work.
(() => {
  'use strict';
  const THEMES = Object.freeze({
    default:['paper',1,32], dark:['dial',2,48], midnight:['orbit',3,40],
    azure:['cloud',4,38], purple:['saturn',5,64], violet:['crystal',6,30],
    rose:['petal',7,24], crimson:['race',8,12], sunset:['sun',9,36],
    amber:['dial',10,32], emerald:['crystal',11,42], forest:['forest',12,28],
    teal:['contour',13,34], ocean:['wave',14,22], graphite:['machine',15,40],
    nord:['snowmountain',16,24], mocha:['steam',17,18], sakura:['petal',18,32],
    pearl:['arch',19,36], lavender:['leaf',20,30], mint:['tile',21,34],
    cobalt:['satellite',22,30], amethyst:['crystal',23,56], copper:['circuit',24,18],
    ruby:['deco',25,36], lemon:['citrus',26,40], sage:['leaf',27,44],
    glacier:['glacier',28,30], ink:['paper',29,46], coffee:['steam',30,24],
    plum:['wave',31,36], neon:['circuit',32,12], orchid:['petal',33,40],
    terracotta:['arch',34,48], aurora:['aurora',35,32], blueprint:['blueprint',36,28],
    sand:['contour',37,52], blossom:['petal',38,28], ice:['frost',39,14],
    halloween:['hollow',40,36], christmas:['snow',41,18],
  });
  const instances = new WeakMap();
  function mount(host, theme='auto', {compact=false}={}) {
    if (!host?.ownerDocument) return null;
    const previous=instances.get(host);
    if (previous && previous.element.parentNode===host) {previous.setTheme(theme);return previous;}
    const doc=host.ownerDocument;
    const element=doc.createElement('div');element.className='fs-theme-motion';
    element.setAttribute('aria-hidden','true');element.setAttribute('inert','');
    element.dataset.compact=String(compact);host.prepend(element);
    let current;
    function setTheme(next) {
      const key=Object.hasOwn(THEMES,next)?next:'auto';
      if (key===current) return;
      current=key;element.replaceChildren();element.dataset.sceneTheme=key;
      const config=THEMES[key];if(!config)return;
      const [kind,seed,period]=config;element.dataset.sceneKind=kind;
      element.style.setProperty('--scene-period',period+'s');
      element.style.setProperty('--scene-angle',((seed*7)%36-18)+'deg');
      const scene=doc.createElement('div');scene.className='fs-scene-stage';element.append(scene);
      function node(name,parent=scene,index=0) {
        const el=doc.createElement('span');el.className='fs-scene-'+name;
        el.style.setProperty('--i',index);el.style.setProperty('--phase',-((index*7+seed*3)%period)+'s');
        parent.append(el);return el;
      }
      function scatter(name,count) {
        for(let i=0;i<count;i++){
          const el=node(name,scene,i);
          el.style.setProperty('--x',((seed*17+i*31)%94+3)+'%');
          el.style.setProperty('--y',((seed*11+i*43)%88+5)+'%');
          el.style.setProperty('--size',(3+(seed+i*7)%7)+'px');
        }
      }
      switch(kind){
        case 'orbit':case 'saturn':case 'satellite': {
          node('sun-core');
          for(let i=0;i<3;i++){
            const plane=node('orbit-plane',scene,i);plane.style.setProperty('--diameter',(160+i*110)+'px');
            const pivot=node('orbiter',plane,i);node(i===1&&kind==='saturn'?'ringed-planet':'planet',pivot,i);
          }
          scatter('star',compact?4:8);if(kind==='satellite')node('radar');else node('comet');break;
        }
        case 'cloud':for(let i=0;i<3;i++)node('cloud',scene,i);node('airline');break;
        case 'wave':for(let i=0;i<3;i++)node('wave',scene,i);scatter('bubble',compact?3:5);break;
        case 'petal':node('branch');scatter('petal',compact?5:9);break;
        case 'leaf':node('stem');scatter('leaf',compact?4:7);break;
        case 'forest':for(let i=0;i<3;i++)node('pine',scene,i);scatter('firefly',compact?4:7);break;
        case 'frost':
          for(let i=0;i<2;i++)node('frost-edge',scene,i);
          for(let i=0;i<(compact?2:3);i++)node('gust',scene,i);
          scatter('ice-shard',compact?3:4);scatter('snow',compact?4:7);break;
        case 'snow':scatter('snow',compact?7:12);if(key==='christmas'){node('pine');node('holiday-star');}else node('ice-ring');break;
        case 'hollow':node('moon');for(let i=0;i<3;i++)node('bat',scene,i);scatter('ember',compact?3:5);break;
        case 'dial':for(let i=0;i<2;i++){const dial=node('dial',scene,i);node('needle',dial,i);}break;
        case 'machine':for(let i=0;i<2;i++)node('gear',scene,i);node('scan');break;
        case 'crystal':for(let i=0;i<4;i++)node('crystal',scene,i);node('glint');break;
        case 'steam':node('cup');for(let i=0;i<3;i++)node('steam',scene,i);break;
        case 'sun':node('horizon');node('setting-sun');for(let i=0;i<2;i++)node('heat',scene,i);break;
        case 'mountain':case 'glacier':case 'snowmountain':
          for(let i=0;i<3;i++)node('mountain',scene,i);node('mist');
          if(kind==='mountain')scatter('star',4);else{scatter('snow',compact?3:6);if(kind==='glacier')for(let i=0;i<2;i++)node('gust',scene,i);}break;
        case 'aurora':for(let i=0;i<3;i++)node('aurora',scene,i);scatter('star',6);break;
        case 'circuit':for(let i=0;i<3;i++)node('circuit',scene,i);scatter('signal',4);break;
        case 'race':for(let i=0;i<4;i++)node('speedline',scene,i);node('checkers');break;
        case 'contour':for(let i=0;i<4;i++)node('contour',scene,i);node('grain');break;
        case 'arch':for(let i=0;i<3;i++)node('arch',scene,i);node('glint');break;
        case 'tile':for(let i=0;i<6;i++)node('tile',scene,i);break;
        case 'deco':for(let i=0;i<3;i++)node('deco',scene,i);node('glint');break;
        case 'citrus':for(let i=0;i<2;i++)node('citrus',scene,i);scatter('leaf',3);break;
        case 'blueprint':node('draft-grid');node('compass');node('scan');break;
        case 'paper':node('page');node('seal');scatter('dust',compact?3:6);break;
      }
    }
    const api={element,setTheme,destroy(){element.remove();if(instances.get(host)===api)instances.delete(host);}};
    instances.set(host,api);setTheme(theme);return api;
  }
  globalThis.FSThemeMotion={mount,themes:THEMES};
  // Renderer scripts run after the ambient host exists. Extensions mount explicitly.
  const ambient=globalThis.document?.querySelector('.app-ambient');
  if(ambient){
    const body=document.body;const scene=mount(ambient,body.dataset.theme);
    new MutationObserver(()=>scene.setTheme(body.dataset.theme)).observe(body,{attributes:true,attributeFilter:['data-theme']});
  }
})();
