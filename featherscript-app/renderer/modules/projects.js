"use strict";
(()=>{
  const modules=globalThis.FSRenderer||={};
  modules.createProjects=({$,api,state,providers})=>{
    let ticket=0;
    const host=$('#project-memory-list'),status=$('#project-memory-status'),search=$('#project-memory-search');
    const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
    async function load(){
      const current=++ticket,owner=state.user?.id;
      if(!api.projects){status.textContent='Open the desktop app to manage automatic project memory.';return;}
      try{
        const result=await api.projects.list();if(current!==ticket||owner!==state.user?.id)return;if(!result.ok)throw Error(result.error);
        host.replaceChildren();const query=search.value.trim().toLowerCase();let count=0;
        const groups=new Map();
        for(const project of result.projects){if(query&&!`${project.title} ${project.origin?.name||''}`.toLowerCase().includes(query))continue;const key=project.origin?.kind==='roblox'?'Roblox Studio places':project.origin?.kind==='folder'?'Local project folders':'Projects awaiting identification';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(project);}
        for(const [name,projects] of groups){
          const section=el('section',undefined,'project-group');section.append(el('h4',name));
          for(const project of projects){
            count++;const card=el('article',undefined,'project-memory-card');const heading=el('div',undefined,'project-memory-heading');heading.append(el('h4',project.title),el('span',project.profile==='agent'?'AgentScript':'RobloxScript','local-badge'));card.append(heading);
            card.append(el('p',project.origin?.name||'No stable place ID or local folder identified yet.','hint'));
            const latest=project.entries.at(-1);card.append(el('p',latest?latest.prompt:'No task checkpoint saved yet.','project-last-task'));
            card.append(el('small',`${project.entries.length} checkpoints · ${latest?.outcome||'new'}${project.handoff?.status==='ready'?' · handoff ready':''}`));
            const detail=el('details'),summary=el('summary','Saved memory'),notes=el('pre',project.entries.slice(-6).map(entry=>`[${entry.outcome}] ${entry.prompt}\n${entry.reply}`).join('\n\n')||'Tasks are saved automatically when the extension uses this project.');detail.append(summary,notes);card.append(detail);
            const actions=el('div',undefined,'project-memory-actions');
            // Fire used to end by launching the last provider's site, which meant
            // the handoff was only usable from this machine, in that one browser,
            // right then. It now hands over the JSON file itself, and opening a
            // chat is a separate choice.
            const openChat=async()=>{const last=localStorage.getItem('fs.lastAI');const provider=providers.find(p=>p.id===last&&!p.external)||providers.find(p=>p.id==='deepseek');if(!provider)throw Error('No AI chat provider is selected yet.');const opened=await api.openExternal(provider.url);if(opened?.ok===false)throw Error('Browser launch failed: '+opened.error);};
            const run=async(action,button)=>{button.disabled=true;try{
              if(action==='saveFile'){const result=await api.projects.saveFile({projectId:project.id,profile:project.profile});if(!result.ok)throw Error(result.error);status.textContent=result.cancelled?'Nothing was saved - the handoff stays ready to export any time.':'Continuation file saved to '+result.path+' ('+result.checkpoints+' checkpoints). Load it in any fresh chat with “Load continuation file”.';return;}
              if(action==='openChat'){await openChat();status.textContent='Chat opened. Choose Continue '+project.title+' there.';return;}
              const result=await api.projects[action]({projectId:project.id,profile:project.profile});if(!result.ok)throw Error(result.error);if(result.cancelled)return;
              if(action==='fire'){const saved=await api.projects.saveFile({projectId:project.id,profile:project.profile});if(!saved.ok)throw Error(saved.error);status.textContent=saved.cancelled?'Handoff fired for “'+project.title+'” - export it any time with Save continuation file.':'Handoff fired and saved to '+saved.path+'. Load it whenever you like with “Load continuation file”.';}
              else status.textContent=action==='delete'?'Saved memory deleted. Project files are kept.':'Project folder identified.';
              await load();
            }catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
            for(const [action,label] of [['fire','Fire handoff'],['saveFile','Save continuation file'],...(project.profile==='agent'?[['folder','Identify folder']]:[]),['openChat','Open AI chat'],['delete','Delete memory']]){const button=el('button',label,action==='delete'?'ghost-btn ghost-danger':'ghost-btn');button.type='button';button.addEventListener('click',()=>run(action,button));actions.append(button);}
            card.append(actions);section.append(card);
          }
          host.append(section);
        }
        $('#project-memory-empty').hidden=count>0;$('#project-memory-count').textContent=count+' projects';
      }catch(error){if(current===ticket)status.textContent=error.message;}
    }
    $('#project-memory-refresh').addEventListener('click',()=>{status.textContent='';void load();});search.addEventListener('input',()=>{void load();});
    window.addEventListener('focus',()=>{if(state.page==='memory')void load();});
    return {load};
  };
})();
