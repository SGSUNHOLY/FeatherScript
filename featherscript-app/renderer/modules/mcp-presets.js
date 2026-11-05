"use strict";
(()=>{
 const modules=globalThis.FSRenderer||={};
 modules.createMcpPresets=({$,api,state})=>{
  const host=$('#mcp-preset-list'),status=$('#mcp-preset-status'),rows=new Map();let saving=false;
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  function render(){for(const [id,row] of rows){
    // Same verdict as the bar chip and the model's list_mcp_servers: the bridge
    // already says WHY a server is down (state + fix), so this card quotes it
    // instead of sitting on "Starting" while the process has crashed.
    const server=state.servers.find(s=>s.id===id);
    const missing=row.enabled&&state.connected&&!server;
    const st=!row.enabled?'disabled':!state.connected?'offline':missing?'offline':ZSServerStatus.state(server);
    const ready=st==='working';
    row.badge.textContent=ready?'Server ready':st==='offline'?(!state.connected?'Bridge offline':'Not loaded'):st==='disabled'?'Available':ZSServerStatus.WORDS[st]||'Starting';
    row.badge.dataset.active=String(ready);
    const why=ZSServerStatus.reason(server);
    row.detail.textContent=ready?'Server connected. Test the operation you need before relying on its results.'
      :!row.enabled?'Enable starts this optional package. First use may download its pinned version.'
      :!state.connected?'The bridge is not answering. Start it from the FeatherScript app.'
      :missing?'This integration is enabled but not loaded by the bridge. Restart the bridge from Settings.'
      :why||'Starting the MCP process. First use may take longer while its package is prepared.';
  }}
  async function load(){
   if(!api.mcp.presets){status.textContent='Open the desktop app to manage optional integrations.';return;}
   try{const result=await api.mcp.presets();if(!result.ok)throw Error(result.error);host.replaceChildren();rows.clear();
    for(const preset of result.presets){
     const card=el('article',undefined,'mcp-connection-row'),heading=el('div',undefined,'mcp-connection-heading'),badge=el('span','Available','local-badge');heading.append(el('h3',preset.title),badge);
     const detail=el('p',undefined,'mcp-card-detail'),command=el('code',(preset.runner==='npm'?'npx --yes ':'uvx ')+preset.args.join(' ')),button=el('button',preset.enabled?'Disable':'Enable','ghost-btn');button.type='button';
     button.addEventListener('click',async()=>{if(saving)return;saving=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Saving integration and restarting the bridge…';try{const changed=await api.mcp.togglePreset({id:preset.id,enabled:!preset.enabled});if(!changed.ok)throw Error(changed.error);await load();status.textContent='Configuration saved. Server status will update after startup.';}catch(error){status.textContent=error.message;}finally{saving=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}});
     const copy=el('div',undefined,'mcp-connection-copy'),packageInfo=el('details'),summary=el('summary','Package details'),controls=el('div',undefined,'mcp-connection-controls');packageInfo.append(summary,command);copy.append(heading,el('p',preset.description),packageInfo,detail);controls.append(button);card.append(copy,controls);host.append(card);rows.set(preset.id,{enabled:preset.enabled,badge,detail});
    }render();
   }catch(error){status.textContent=error.message;}
  }
  void load();return {render,load};
 };
})();
