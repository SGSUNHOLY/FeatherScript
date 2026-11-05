const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../featherscript-extension/core/theme-motion.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const {mount,themes}=context.FSThemeMotion;
class Element {
 constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.style={setProperty(){}};}
 setAttribute(){}
 append(child){child.parentNode=this;this.children.push(child);}
 prepend(child){child.parentNode=this;this.children.unshift(child);}
 replaceChildren(){for(const el of this.children)el.parentNode=null;this.children=[];}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
}
const doc={createElement:()=>new Element(doc)},host=new Element(doc);
const scene=mount(host,'midnight');const initial=scene.element.children[0];
assert.equal(mount(host,'midnight'),scene);assert.equal(scene.element.children[0],initial,'same theme does not rebuild');
const presets=JSON.parse(fs.readFileSync(path.join(__dirname,'../featherscript-extension/core/theme-identities.json'),'utf8'));
assert.deepEqual(Object.keys(themes).sort(),Object.keys(presets).sort(),'every theme gets a scene');
function count(el){return el.children.reduce((sum,child)=>sum+1+count(child),0);}
for(const key of Object.keys(presets)){scene.setTheme(key);assert.equal(host.children.length,1);assert.equal(scene.element.dataset.sceneTheme,key);assert.ok(count(scene.element)>1);assert.ok(count(scene.element)<=21,'bounded scene elements');}
scene.setTheme('__proto__');assert.equal(scene.element.dataset.sceneTheme,'auto');assert.equal(scene.element.children.length,0);
scene.destroy();assert.equal(host.children.length,0);assert.notEqual(mount(host,'purple'),scene);
assert.equal(mount(null),null);
const compact=mount(new Element(doc),'christmas',{compact:true});assert.equal(compact.element.dataset.compact,'true');assert.ok(count(compact.element)<=12);
console.log('PASS every theme covered, bounded scenes, same-theme reuse, rapid replacement, teardown, compact mode and unknown-theme fallback');
