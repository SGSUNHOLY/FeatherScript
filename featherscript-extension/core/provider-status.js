// Common provider UI notices. Scan bounded chrome/composer surfaces, never the
// transcript, editable prompt, hidden banners or FeatherScript's own feedback.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./commands'));
  else root.ZSProviderStatus=factory(root.ZSCommands);
})(globalThis,Commands=>{
  'use strict';
  const selector='[role="alert"],[role="status"],[aria-live],[data-testid*="limit"],[data-testid*="quota"],[class*="usage-limit"],[class*="limit-banner"],[class*="quota"]';
  function create(provider,{document:doc=globalThis.document}={}){
    function scan(){
      if(!doc?.querySelectorAll)return null;
      let composer=null,items=[];
      try{composer=provider.getEditor?.();items=provider.allItems?.()||[];}catch{return null;}
      const candidates=new Set();
      for(const node of doc.querySelectorAll(selector)){candidates.add(node);if(candidates.size>=48)break;}
      let parent=composer?.parentElement;
      for(let level=0;parent&&parent!==doc.body&&parent!==doc.documentElement&&level<3;level++,parent=parent.parentElement){
        const queue=[parent];let visited=0;
        while(queue.length&&visited++<40&&candidates.size<128){
          const node=queue.shift();candidates.add(node);
          for(const child of Array.from(node.children||[]).slice(0,12))queue.push(child);
        }
      }
      for(const node of candidates){
        try{
          if(!node.isConnected||!node.getClientRects().length)continue;
          if(node.closest('#zs-root,.zs-chip,pre,code,script,style,textarea,input,[contenteditable],[role="textbox"],[data-message-author-role],[hidden],[aria-hidden="true"]'))continue;
          if(node.querySelector('textarea,input,[contenteditable],[role="textbox"]'))continue;
          if(items.some(item=>item===node||item.contains(node)||node.contains(item)))continue;
          const text=String(node.textContent||'').replace(/\s+/g,' ').trim();
          if(text.length<8||text.length>600)continue;
          const kind=Commands.providerNoticeKind(text);if(!kind)continue;
          const style=doc.defaultView?.getComputedStyle(node);
          if(style&&(style.visibility==='hidden'||style.display==='none'||style.opacity==='0'))continue;
          return {kind,detail:text.slice(0,400)};
        }catch{/* A provider may replace its chrome while the scan is running. */}
      }
      return null;
    }
    function assertCanSend(){
      const notice=scan();if(!notice)return;
      const error=Error(notice.detail+' — FeatherScript paused. Resolve the provider notice, then resume manually.');
      error.zsNoRetry=true;error.zsProviderNotice=notice;throw error;
    }
    return {scan,assertCanSend};
  }
  return {create};
});
