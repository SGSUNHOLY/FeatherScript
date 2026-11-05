"use strict";
(() => {
  const modules=globalThis.FSRenderer ||= {};
  modules.createBlender=({$,api,state,socket})=>{
    const names=['get_scene_info','generate_3d','create_model','look','animate_object','save_scene','export_glb','execute_blender_code'];
    // Keep status rows mounted; heartbeat updates only change their text.
    const rows=new Map(names.map(name=>{
      const row=document.createElement('div');row.className='row';
      const label=document.createElement('span');label.className='row-key mono';label.textContent=name;
      const value=document.createElement('span');value.className='row-val';row.append(label,value);$('#blender-tools').append(row);return [name,value];
    }));
    let busy=false;
    function render() {
      const server=state.servers.find(item=>item.id==='blender');
      const schemas=new Set(state.tools.filter(tool=>tool.server==='blender').map(tool=>tool.name.split('/').pop()));
      $('#blender-connection').textContent=!state.connected
        ? (state.bridge.status==='error' ? state.bridge.detail : 'Bridge offline. Use Settings → Bridge to reconnect.')
        : server?.error || (server?.alive ? 'Controller connected. Test Blender to verify the installed executable.' : $('#blender-enabled').checked ? 'Waiting for the Blender controller. Save configuration, then refresh connections.' : 'Blender is disabled. Enable it and save configuration.');
      for(const [name,value] of rows)value.textContent=schemas.has(name) ? 'Available' : 'Unavailable';
    }
    async function load() {
      try {
        const result=await api.mcp.get();if(!result.ok)throw Error(result.error);
        const settings=result.settings;$('#blender-enabled').checked=settings.enabled;
        $('#blender-executable').value=settings.executable || '';render();
      }catch(error){$('#blender-state').textContent=error.message;}
    }
    $('#blender-enabled').addEventListener('change',render);
    $('#blender-browse').addEventListener('click',async()=>{
      try {const result=await api.mcp.chooseExecutable();if(!result.ok)throw Error(result.error);if(result.path)$('#blender-executable').value=result.path;}
      catch(error){$('#blender-state').textContent=error.message;}
    });
    $('#blender-test').addEventListener('click',async()=>{
      if(busy)return;busy=true;$('#blender-test').disabled=true;
      const diagnostic=$('#blender-diagnostic');diagnostic.hidden=false;diagnostic.dataset.tone='idle';diagnostic.textContent='Starting a temporary background scene and rendering a CPU preview…';
      try {
        const result=await api.mcp.test({executable:$('#blender-executable').value.trim()});
        if(!result.ok)throw Error(result.error);
        const info=result.diagnostic;diagnostic.dataset.tone='ok';
        diagnostic.textContent=`Blender ${info.version} passed the headless startup and CPU render check.\n${info.executable}\n${info.objects} scene objects inspected; PNG preview verified (${info.previewBytes} bytes). The temporary test scene has closed. Enable Blender and save configuration to use it with the agent.`;
      }catch(error){diagnostic.dataset.tone='error';diagnostic.textContent=error.message;}
      finally{busy=false;$('#blender-test').disabled=false;}
    });
    $('#blender-config').addEventListener('submit',async event=>{
      event.preventDefault();const button=$('#blender-save');if(button.disabled)return;button.disabled=true;
      $('#blender-state').textContent='Saving and restarting bridge…';
      try {
        const result=await api.mcp.save({enabled:$('#blender-enabled').checked,executable:$('#blender-executable').value,safeMode:false});
        if(!result.ok)throw Error(result.error);
        $('#blender-state').textContent='Configuration saved. Refreshing connections…';socket.send({type:'list_tools',id:'blender-refresh-'+Date.now()});
      }catch(error){$('#blender-state').textContent=error.message;}
      finally{button.disabled=false;render();}
    });
    load();return {render};
  };
})();
