const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function node(){return {attrs:{},dataset:{},listeners:{},textContent:'',value:'50',disabled:false,setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||null;},querySelector(){return this.caption||null;},addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}};}
async function run(){
  const popup=node(),toolbar=node(),sound=node(),slider=node(),readout=node(),status=node();popup.caption=node();
  const groups={'[data-fs-music]':[popup,toolbar],'[data-fs-sound]':[sound],'[data-fs-volume]':[slider],'[data-fs-volume-value]':[readout],'[data-fs-audio-status]':[status]};
  const document={querySelectorAll:selector=>groups[selector]||[]};let listener,fail=false,settings={music:false,volume:.5,sound:true},playing=false;const calls=[],windowEvents={};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},async sendMessage(message){calls.push(message);if(message.type==='fs_audio_set'){settings={...settings,...message.patch};if(message.patch.music!==undefined)playing=message.patch.music&&!fail;}return {ok:!fail,settings,playing,supported:true,error:fail?'Playback blocked':''};}}};
  const ctx=vm.createContext({document,chrome,window:{addEventListener:(type,fn)=>{windowEvents[type]=fn;}},location:{protocol:'chrome-extension:'},localStorage:{getItem:()=>null},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'core/audio-ui.js'),'utf8'),ctx);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  ctx.ZSAudioUI.mount(document);await tick();ctx.ZSAudioUI.mount(document);await tick();
  assert.equal(popup.listeners.click.length,1,'remount never stacks handlers');
  await popup.listeners.click[0]();assert.equal(playing,true);assert.equal(popup.attrs['aria-pressed'],'true');assert.equal(toolbar.attrs['aria-pressed'],'true');assert.equal(popup.caption.textContent,'Pause');
  await toolbar.listeners.click[0]();assert.equal(playing,false);assert.equal(popup.caption.textContent,'Play');
  slider.value='73';slider.listeners.input[0]();assert.equal(readout.textContent,'73%');slider.listeners.change[0]();await tick();assert.equal(settings.volume,.73);
  await sound.listeners.click[0]();assert.equal(settings.sound,false);assert.equal(sound.attrs['aria-pressed'],'false');
  listener({type:'fs-audio-state',settings:{music:true,volume:.2,sound:false},playing:true,supported:true});assert.equal(popup.attrs['aria-pressed'],'true');assert.equal(slider.value,'20');
  fail=true;await toolbar.listeners.click[0]();assert.match(status.textContent,/Playback blocked/);assert.equal(toolbar.disabled,false,'failure releases the control');
  fail=false;slider.value='61';slider.listeners.input[0]();windowEvents.pagehide();await tick();assert.equal(settings.volume,.61,'closing popup flushes its pending volume update');
  assert.equal(calls.filter(message=>message.type==='fs_audio_set'&&message.patch.volume===.61).length,1);
  console.log('PASS synchronized music controls, single binding, play/pause, slider, shared mute, external updates, error recovery and close-time persistence');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
