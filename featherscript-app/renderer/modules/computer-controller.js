"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createComputer = ({$,api}) => {
    let current = {enabled:false,mode:'ask',roots:[],clients:[],history:[]}, roots = [], busy = false;
    const status = text => { $('#pc-status').textContent = text; };
    function modeHelp() {
      const mode = $('#pc-mode').value;
      $('#pc-full-confirm-row').hidden = mode !== 'full';
      $('#pc-mode-help').textContent = mode === 'full'
        ? 'Paired extensions may use all computer tools without action prompts. This uses your current OS permissions; it does not grant administrator rights.'
        : mode === 'unusual' ? 'System information and reads or edits in trusted folders can proceed automatically. Other actions ask.'
        : 'Approve each computer operation in a native desktop dialog. Closing or ignoring a dialog denies the request.';
    }
    function list(element, values, render, empty) {
      element.replaceChildren();
      if(!values.length) { const li=document.createElement('li');li.textContent=empty;element.append(li); }
      else values.forEach(value => {const li=document.createElement('li');render(li,value);element.append(li);});
    }
    function renderRoots() {
      list($('#pc-roots'),roots,(li,root) => {
        const text=document.createElement('span');text.textContent=root;
        const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent='Remove';button.disabled=busy;
        button.addEventListener('click',()=>{roots=roots.filter(value=>value!==root);renderRoots();status('Save permissions to apply folder changes.');});li.append(text,button);
      },'No trusted folders.');
    }
    function render(next) {
      current=next;roots=[...(next.roots||[])];
      $('#pc-enabled').checked=next.enabled;$('#pc-mode').value=next.mode;
      $('#pc-full-confirm').checked=false; modeHelp();renderRoots();
      for(const id of ['pc-save','pc-folder','pc-enabled','pc-mode'])$('#'+id).disabled=next.available===false;
      $('#pc-disable').disabled=!next.enabled;
      list($('#pc-clients'),next.clients||[],(li,origin)=>{
        const text=document.createElement('span');text.textContent=origin;
        const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent='Revoke';
        button.addEventListener('click',()=>mutate(()=>api.pc.revoke(origin),'Extension revoked.'));li.append(text,button);
      },'No extensions paired.');
      list($('#pc-history'),next.history||[],(li,item)=>{li.textContent=`${new Date(item.at).toLocaleTimeString()} · ${item.tool} · ${item.outcome}${item.target ? ' · '+item.target : ''}`;},'No computer activity in this app session.');
      status(next.error || (next.available===false ? 'Open the desktop app to use computer tools.' : next.enabled ? 'Computer tools enabled. Pair the browser extension on its first request.' : 'Computer tools disabled.'));
    }
    async function refresh() {try {const result=await api.pc.get();if(!result.ok)throw Error(result.error);render(result.state);}catch(error){status(error.message);}}
    async function mutate(operation,message) {
      if(busy)return;busy=true;$('#pc-save').disabled=true;
      try {const result=await operation();if(!result.ok)throw Error(result.error);render({...result.state,available:current.available});status(message);}
      catch(error){status(error.message);}
      finally{busy=false;$('#pc-save').disabled=current.available===false;renderRoots();}
    }
    $('#pc-mode').addEventListener('change',()=>{$('#pc-full-confirm').checked=false;modeHelp();});
    $('#pc-folder').addEventListener('click',async()=>{
      if(busy)return;
      try {const result=await api.pc.chooseFolder();if(!result.ok)throw Error(result.error);if(result.path && !roots.includes(result.path))roots.push(result.path);renderRoots();status('Save permissions to apply folder changes.');}catch(error){status(error.message);}
    });
    $('#pc-form').addEventListener('submit',event=>{
      event.preventDefault();const enabled=$('#pc-enabled').checked,mode=$('#pc-mode').value;
      if(enabled && mode==='full' && !$('#pc-full-confirm').checked){status('Confirm Full access before saving.');$('#pc-full-confirm').focus();return;}
      mutate(()=>api.pc.save({enabled,mode,roots}),'Permissions saved on this device.');
    });
    // Revocation must remain available even while another operation is pending.
    $('#pc-disable').addEventListener('click',async()=>{
      try {const result=await api.pc.disable();if(!result.ok)throw Error(result.error);render({...result.state,available:current.available});status('Computer access disabled. Pending operations cancelled.');}catch(error){status(error.message);}
    });
    $('#pc-refresh').addEventListener('click',refresh);
    document.querySelector('[data-page="settings"]')?.addEventListener('click',refresh);
    refresh();return {refresh};
  };
})();
