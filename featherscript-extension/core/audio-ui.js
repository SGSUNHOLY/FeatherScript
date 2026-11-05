// Shared controls: changing one surface updates every open extension surface.
(() => {
  'use strict';
  let state={settings:{music:false,sound:true,volume:.5},playing:false,supported:true,error:''},busy=false,context=null,volumeTimer=0,pendingVolume=null;
  const bound=new WeakSet();
  async function rpc(type,patch){const result=await chrome.runtime.sendMessage({type,patch});if(!result)throw Error('Extension unavailable. Reload it.');if(result.settings)state=result;render();if(result.ok===false)throw Error(result.error||'Audio setting failed.');return result;}
  function render(){
    document.querySelectorAll('[data-fs-music]').forEach(button=>{button.disabled=busy||!state.supported;button.setAttribute('aria-pressed',String(state.playing));button.setAttribute('aria-label',state.playing?'Pause ambient music':'Play ambient music');button.title=state.playing?'Pause ambient music':'Play ambient music';const caption=button.querySelector('[data-audio-caption]');if(caption)caption.textContent=state.playing?'Pause':'Play';});
    document.querySelectorAll('[data-fs-sound]').forEach(button=>{const on=state.settings.sound;button.setAttribute(button.getAttribute('role')==='switch'?'aria-checked':'aria-pressed',String(on));button.setAttribute('aria-label',`Sound effects ${on?'on':'off'}`);button.title=`Sound effects ${on?'on':'off'}`;});
    const percent=Math.round((pendingVolume??state.settings.volume)*100);
    document.querySelectorAll('[data-fs-volume]').forEach(input=>{input.value=String(percent);input.setAttribute('aria-valuetext',`${percent}%`);});
    document.querySelectorAll('[data-fs-volume-value]').forEach(node=>{node.textContent=percent+'%';});
    document.querySelectorAll('[data-fs-audio-status]').forEach(node=>{node.textContent=state.error||(!state.supported?'Update Chrome or Edge for music support.':state.playing?(percent===0?'Muted · raise the volume':'Ambient music playing · continues when the popup closes'):'Music paused · press Play to listen');node.dataset.tone=state.error?'error':state.playing?'playing':'paused';});
  }
  function showError(error){state.error=String(error.message||error);render();}
  async function change(patch){try{return await rpc('fs_audio_set',patch);}catch(e){showError(e);return null;}}
  function cue(kind='tap'){
    if(!state.settings.sound)return;
    try{
      context ||= new AudioContext();
      if(context.state==='suspended')context.resume().catch(()=>{});
      const now=context.currentTime;
      for(const [i,frequency] of (kind==='ready'?[587.33,783.99]:kind==='toggle'?[659.25]:[493.88]).entries()){
        const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(.0001,now+i*.08);gain.gain.exponentialRampToValueAtTime(.045,now+i*.08+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.08+.15);
        oscillator.connect(gain);gain.connect(context.destination);oscillator.start(now+i*.08);oscillator.stop(now+i*.08+.16);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      }
    }catch{/* Audio support is optional. */}
  }
  function flushVolume(){clearTimeout(volumeTimer);volumeTimer=0;if(pendingVolume===null)return;const volume=pendingVolume;pendingVolume=null;void change({volume});}
  function mount(scope=document){
    for(const button of scope.querySelectorAll('[data-fs-music]'))if(!bound.has(button)){bound.add(button);button.addEventListener('click',async()=>{if(busy)return;busy=true;render();try{await change({music:!state.playing});}finally{busy=false;render();}});}
    for(const button of scope.querySelectorAll('[data-fs-sound]'))if(!bound.has(button)){bound.add(button);button.addEventListener('click',async()=>{const result=await change({sound:!state.settings.sound});if(result?.settings.sound)cue('toggle');});}
    for(const input of scope.querySelectorAll('[data-fs-volume]'))if(!bound.has(input)){bound.add(input);input.addEventListener('input',()=>{pendingVolume=Math.max(0,Math.min(1,Number(input.value)/100));render();clearTimeout(volumeTimer);volumeTimer=setTimeout(flushVolume,100);});input.addEventListener('change',flushVolume);}
    render();
    let legacySound;
    // Never inspect a provider page's localStorage; migration is extension-only.
    if(location.protocol==='chrome-extension:')try{legacySound=localStorage.getItem('featherscript-sfx')!=='off';}catch{}
    chrome.runtime.sendMessage({type:'fs_audio_get',legacySound}).then(result=>{if(result?.settings){state=result;render();}}).catch(showError);
  }
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='fs-audio-state'&&message.settings){state=message;render();}});
  window.addEventListener('focus',()=>{if(!busy)chrome.runtime.sendMessage({type:'fs_audio_get'}).then(result=>{if(result?.settings){state=result;render();}}).catch(()=>{});});
  window.addEventListener('pagehide',flushVolume);
  globalThis.ZSAudioUI={mount,cue};
})();
