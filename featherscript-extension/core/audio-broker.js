// One extension-owned player, shared by popup, dashboard and chat toolbar.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZSAudioBroker=factory();})(globalThis,()=>{
  'use strict';
  const KEY='fsExtensionAudio';
  function normalize(value={}){return {music:value.music===true,sound:value.sound!==false,volume:typeof value.volume==='number'&&Number.isFinite(value.volume)?Math.max(0,Math.min(1,value.volume)):.5};}
  function create(api,{broadcast=()=>{}}={}){
    let sequence=Promise.resolve();
    const supported=()=>!!(api.offscreen?.createDocument && api.runtime.getContexts);
    const exists=async()=>supported()&&(await api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[api.runtime.getURL('audio.html')]})).length>0;
    const load=async legacy=>{const data=await api.storage.local.get([KEY]);const settings=normalize(data[KEY]||{sound:legacy!==false});if(!data[KEY]&&typeof legacy==='boolean')await api.storage.local.set({[KEY]:settings});return settings;};
    const request=async message=>{
      let timer;
      try{return await Promise.race([api.runtime.sendMessage({target:'fs-audio-player',...message}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Music player did not respond. Reload the extension and try Play again.')),7000);})]);}
      finally{clearTimeout(timer);}
    };
    async function status(settings){
      let playing=false,error='';
      if(await exists()){try{const reply=await request({action:'status'});playing=reply?.playing===true;error=reply?.error||'';}catch(e){error=e.message;}}
      return {ok:true,settings,playing,supported:supported(),error};
    }
    const enqueue=operation=>{const result=sequence.catch(()=>{}).then(operation);sequence=result;return result;};
    const get=legacy=>enqueue(async()=>status(await load(legacy)));
    const set=patch=>enqueue(async()=>{
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['music','sound','volume'].includes(key)))throw Error('Invalid audio setting.');
      for(const key of ['music','sound'])if(key in patch && typeof patch[key]!=='boolean')throw Error('Invalid audio switch.');
      if('volume' in patch && (typeof patch.volume!=='number'||!Number.isFinite(patch.volume)||patch.volume<0||patch.volume>1))throw Error('Volume must be from 0 to 1.');
      const settings=normalize({...await load(),...patch});
      if(patch.music===true&&!supported())throw Error('Music needs Chrome or Edge 116 or newer with offscreen audio support.');
      await api.storage.local.set({[KEY]:settings});
      let error='';
      try{
        if(patch.music===false){if(await exists())await api.offscreen.closeDocument();}
        else if(patch.music===true){
          if(!await exists())await api.offscreen.createDocument({url:'audio.html',reasons:['AUDIO_PLAYBACK'],justification:'Play user-enabled ambient music while the extension popup is closed.'});
          const reply=await request({action:'play',volume:settings.volume});
          if(!reply?.ok)throw Error(reply?.error||'Music could not start.');
        }else if('volume' in patch && await exists())await request({action:'volume',volume:settings.volume});
      }catch(e){error=String(e.message||e);}
      const result=await status(settings);if(error){result.ok=false;result.error=error;}
      try{broadcast({target:'fs-audio-ui',type:'fs-audio-state',...result});}catch{}
      return result;
    });
    return {get,set};
  }
  return {create,normalize,KEY};
});
