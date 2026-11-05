// This is the only music source. No bridge, website or third-party audio service.
(() => {
  'use strict';
  const player=document.getElementById('music');
  let error='';
  player.addEventListener('error',()=>{error='The bundled music could not load. Reload the extension.';});
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.target!=='fs-audio-player')return false;
    (async()=>{
      if(message.action==='play'||message.action==='volume'){
        if(typeof message.volume!=='number'||!Number.isFinite(message.volume)||message.volume<0||message.volume>1)throw Error('Invalid music volume.');
        player.volume=message.volume;
      }
      if(message.action==='play'){error='';await player.play();}
      else if(message.action!=='status'&&message.action!=='volume')throw Error('Unknown audio action.');
      respond({ok:true,playing:!player.paused&&!player.ended,error});
    })().catch(e=>{error=String(e.message||e);respond({ok:false,playing:false,error});});
    return true;
  });
})();
