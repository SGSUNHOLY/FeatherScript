(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZSCommands=api;})(globalThis,()=>{
 'use strict';
 const STATES=Object.freeze(['queued','sending','sent','acknowledged','running','completed','failed','timed_out','indeterminate','unacknowledged','cancelled','duplicate','rejected']);
 const terminal=new Set(STATES.slice(5));
 const canonical=value=>JSON.stringify(sort(value));
 function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));return value;}
 async function idFor({provider,conversation,turn,tool,args}) {
   if(!turn)return 'cmd-'+crypto.randomUUID();
   const data=new TextEncoder().encode(canonical({provider,conversation,turn,tool,args}));
   return 'cmd-'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(value=>value.toString(16).padStart(2,'0')).join('');
 }
 function transition(record,state){if(!STATES.includes(state)||terminal.has(record.state))return false;if(!terminal.has(state)&&STATES.indexOf(state)<STATES.indexOf(record.state))return false;record.state=state;return true;}
 let overrides={};
 function configure(value){overrides=value&&typeof value==='object'?value:{};}
 function timeoutFor(name){const bare=String(name).split('/').pop();const fallback=bare==='execute_luau'?20000:120000;const value=Number(overrides[name]??overrides[bare]);return Number.isFinite(value)&&value>0?Math.max(1000,Math.min(900000,value)):fallback;}
 function providerNoticeKind(message){
   const text=String(message||'').replace(/\s+/g,' ').trim();
   if(!text||text.length>600)return null;
   // A model-fallback advisory does not necessarily block the current composer.
   if(/(?:responses|replies) will (?:now )?use (?:another|a different) model|automatically (?:switch|use).{0,30}model|you can still (?:send messages|chat)/i.test(text))return null;
   if(/(?:your|usage|message|daily) limit resets?(?: at| in| on)|(?:you(?:'|’)?ve|you have) (?:hit|reached|used up).{0,45}(?:limit|messages|credits)|(?:message|usage|daily|rate)[ -]?limit.{0,35}(?:reached|exceeded)|too many requests|resource[ _-]?exhausted|out of (?:messages|credits)|quota.{0,25}(?:exceeded|exhausted|reset)|limit of messages|limite de messages|r[ée]initialisation du quota/i.test(text))return 'rate_limit';
   if(/verify (?:that )?you(?:'|’)?re human|verify (?:that )?you are human|complete (?:the |a )?(?:captcha|verification|security check)|sign in to continue|session (?:has )?expired|log in again/i.test(text))return 'provider_blocked';
   return null;
 }
 function studioStateFailure(message){
   const text=String(message||'').trim();
   if(!text||text.length>1200)return null;
   if(/^(?:(?:ERROR|Error calling [^:]+):?\s*)?(?:The\s+)?(?:['"]?Edit['"]?\s+data\s*model|data\s*model\s+['"]?Edit['"]?)\s+(?:is\s+)?(?:not available|unavailable|not accessible)\b/i.test(text))return 'edit_unavailable';
   return null;
 }
 function classifySiteError(message,{comparison=false,generating=false}={},state={},now=Date.now()) {
   const text=String(message||'');
   const blocked=providerNoticeKind(text);if(blocked)return {kind:blocked,detail:text};
   if(comparison){state.message='';state.since=0;return null;}
   if(text && /context.{0,20}(limit|length|exceed)|token.{0,12}(limit|exceed)|conversation.{0,15}(long|limit)|maximum.{0,15}(messages|tokens)/i.test(text))return {kind:'context_limit',detail:text};
   if(text && !generating){if(state.message!==text){state.message=text;state.since=now;}else if(now-state.since>=3000)return {kind:'site_error',detail:text};}
   else {state.message='';state.since=0;}
   return null;
 }
 return {STATES,terminal,canonical,idFor,transition,configure,timeoutFor,providerNoticeKind,studioStateFailure,classifySiteError};
});
