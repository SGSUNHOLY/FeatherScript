"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  // Guides describe the local product workflow, so they also work offline.
  const guides = [
    {id:'continuation',category:'Agent workflow',title:'Memory and continuation',summary:'Review saved notes and move work to a fresh chat.',page:'providers',action:'Open a supported chat',steps:[
      'Use the extension gear to open Quick Settings. Quick notes lists the facts you added and completed-task excerpts saved automatically.',
      'Learn as I work controls automatic saving. Turning it off keeps existing notes. Open a note to edit it or use Delete to remove it.',
      'When you open a fresh chat and previous work exists, choose Continue or Start New. Start New keeps project files and earlier memories intact.',
      'Expand Save or move memory and chats to save a continuation JSON. In a fresh chat, load that file to restore its task excerpts as historical context. It is not a full chat or project backup.',
      'A continuation checks current project state and does not automatically replay old tool calls or resume queued tasks. Resume paused tasks uses the existing Cowork queue.',
    ]},
    {id:'optional-mcps',category:'Connect tools',title:'Enable optional MCP servers',summary:'Connect browser, documentation, repository and memory tools.',page:'mcps',action:'Open MCP servers',steps:[
      'Open MCPs and enable only the integrations you want. The card shows the pinned package command and prerequisites. Node.js/npm is needed for npm packages; uvx is needed for Python packages.',
      'Enabling or disabling a server restarts the bridge. Save your Blender scene first. The first launch may download the package.',
      'Server ready means the MCP process answered. It does not prove a browser or remote service can complete your request. Read the tool’s setup requirements and test a small read operation first.',
      'Blender uses the local headless controller and supports Python scripting. Test Blender checks the installed executable with a temporary CPU render; it does not replace your agent scene.',
      'Disable removes only that optional server configuration. Roblox Studio and other configured servers are preserved.',
    ]},
    {id:'start',category:'Start here',title:'Your first working session',summary:'Connect the desktop, extension and your preferred AI.',page:'providers',action:'Choose a provider',steps:[
      'Extract the entire FeatherScript folder. Run app.bat on Windows. First-run setup installs the pinned desktop runtime; keep the folder together.',
      'Wait for Bridge online in the app. If it stays offline, open Settings and read the Bridge detail before restarting.',
      'Install the unpacked browser extension using the guide below, then choose a supported website in Providers.',
      'Open a chat with a visible composer. Start the FeatherScript controller, describe a small task, and wait for its tool result before sending another request.',
    ]},
    {id:'extension',category:'Setup',title:'Install or reload the browser extension',summary:'Use the matching extension from this FeatherScript folder.',page:'providers',action:'Open providers',steps:[
      'In Chrome open the Extensions page from the browser menu. In Edge open Extensions → Manage extensions.',
      'Enable Developer mode. Choose Load unpacked and select the featherscript-extension folder beside app.bat.',
      'After updating FeatherScript, press Reload on that extension entry. Refresh any chat tabs that were already open.',
      'Keep the desktop app running. If another mod uses port 17613, close that mod and restart FeatherScript’s bridge in Settings. Do not run both bridges on that port.',
    ]},
    {id:'roblox',category:'Connect tools',title:'Connect Roblox Studio',summary:'Make the bridge and a loaded place available to the agent.',page:'overview',action:'Check connections',steps:[
      'Open Roblox Studio and load a place. A running Studio window without a loaded place may not accept editing commands.',
      'Enable Studio’s MCP connection in Assistant settings if it is available in your Studio build. If Studio was already open, revisit its MCP server settings to trigger registration.',
      'Return to Overview and refresh connections. Check the Studio status separately from Bridge online; a bridge connection alone does not mean a place is ready.',
      'Ask the agent to inspect the scene first. Review the resulting objects or scripts in Studio before continuing with a larger task.',
    ]},
    {id:'blender',category:'Connect tools',title:'Set up headless Blender',summary:'Run real Blender in the background without an addon.',page:'mcps',action:'Set up Blender',steps:[
      'Install Blender on this computer. FeatherScript uses the installed executable; it does not bundle the Blender editor.',
      'Open MCPs. Leave the executable field empty for automatic detection, or Browse to the Blender executable inside the installation folder.',
      'Press Test Blender. This launches a temporary background scene, checks its version and scene response, renders and verifies a CPU PNG preview, then closes that test process. It does not change your open Blender files.',
      'Enable headless Blender and save configuration. Wait for the bridge to restart, then refresh connections before starting a new agent session.',
      'Start with get_scene_info, generate_3d for a basic shape, or create_model for a grouped table, chair, building or crate. Optional color, metallic and roughness settings control PBR materials. Use look for a preview.',
      'Use save_scene with a new absolute .blend path to keep the editable scene. Use export_glb with a new absolute .glb path to import generated meshes through Roblox Studio’s 3D Importer. Set generated_only=false to include other scene meshes.',
      'Blender supports inspection, procedural modeling, transform animation, previews, saving, exporting and Python scripting. Save the scene before restarting the bridge: its unsaved background scene is temporary.',
    ]},
    {id:'vault',category:'Connect tools',title:'Use an Obsidian vault for context',summary:'Bring local Markdown notes into the conversation.',page:'memory',action:'Open memory & vault',steps:[
      'Open Memory and choose the existing folder that contains your Obsidian Markdown notes.',
      'Save the vault configuration. Ask the agent to search notes by topic, then read the specific files it needs.',
      'Keep note editing disabled for read-only context. Enable editing only if you want the agent to create or update vault notes.',
      'Project memory is separate from your vault. Put short, durable instructions in Project memory and longer reference material in vault files.',
    ]},
    {id:'profiles',category:'Personalize',title:'Manage local profiles',summary:'Separate your projects without accounts or sign-in.',page:'settings',action:'Manage profiles',steps:[
      'In Settings → Local profiles, create a name for each workspace or project. Switch with the active-profile selector or the profile control in navigation.',
      'Memory, notes, prompts, palette, layout and interface feel belong to the selected profile. Skills and bridge connections are shared on this computer.',
      'Remove this profile deletes its local data after a confirmation naming it, then switches to another profile. At least one profile must remain.',
      'Deleting a profile does not delete shared skills or files in your vault. Computer permissions are device-wide, not separate per profile.',
    ]},
    {id:'appearance',category:'Personalize',title:'Make the workspace yours',summary:'Choose a layout, palette, gradient or local photo.',page:'settings',action:'Customize appearance',steps:[
      'Choose Default for the sidebar notebook, Studio for top tabs, or Canvas for the floating dock. Layout changes save immediately without changing your colors.',
      'Search the theme picker to find a preset. The same preset catalogue is available in the extension controller settings.',
      'Expand Make your own palette & background to edit colors, gradients or a local PNG, JPEG or WebP photo. Save my design keeps it with this desktop profile.',
      'Feel controls motion, particles, music and interface sound. The preview respects Motion Off and muted sound. System reduced-motion preferences also limit animation.',
    ]},
    {id:'permissions',category:'Connect tools',title:'Choose computer permissions',summary:'Control what the agent can do on this device.',page:'settings',action:'Review permissions',steps:[
      'Computer tools are off by default. Enable them in Settings → Computer access and save the permission mode.',
      'Always ask opens a native approval dialog for every operation. Ask when unusual allows system information and reads or edits inside trusted folders; other operations ask.',
      'Full access lets paired extensions use the computer tools without action prompts. It uses your current OS account and does not grant administrator rights.',
      'The first request from a new extension always asks. Allow once approves only that request; Allow and pair remembers that extension under the selected mode.',
      'Use Disable now to revoke access and cancel pending requests and controller-owned programs. Revoke a paired extension separately or refresh Recent computer activity to review this session.',
    ]},
    {id:'cowork',category:'Agent workflow',title:'Skills & Cowork',summary:'Use relevant skill context and queue follow-up tasks.',page:'providers',action:'Open a supported chat',steps:[
      'Start the controller in a supported chat. Choose RobloxScript for Studio work or AgentScript for local PC work.',
      'Relevant main skill instructions load before queued prompts. Supporting references and scripts remain available through feather_getskills with skill and file parameters.',
      'Open Cowork, enable the queue, add prompts and Resume. One task runs at a time, using the profile selected when it starts.',
      'Pause leaves the current task running. Stop cancels it and preserves later prompts. Reload pauses the queue and marks previously running tasks interrupted.',
      'Review actual state before repeating cancelled or uncertain edits. Remove interrupted jobs before resuming. The selected AI model and native thinking controls remain unchanged.',
    ]},
    {id:'troubleshoot',category:'Troubleshoot',title:'When a connection or tool fails',summary:'Check the specific layer instead of repeatedly retrying.',page:'settings',action:'Open bridge settings',steps:[
      'Bridge offline: read the Bridge detail in Settings and logs/app-bridge.log. Check Python availability, blocked setup downloads, and another app occupying port 17613.',
      'Controller missing: reload the matching browser extension, refresh the supported chat tab, and wait for the composer to appear. Avoid sending overlapping requests while a tool is running.',
      'Blender unavailable: run Test Blender from MCPs. A missing executable, failed background startup and a disconnected controller have different messages.',
      'A saved Blender configuration does not prove Blender started. Test Blender verifies a real process; the live agent’s scene is created separately on its first tool call.',
      'After a bridge restart, refresh connections and start a fresh agent session so its tool catalogue includes the enabled integrations.',
    ]},
  ];
  modules.createGuides = ({$,onNavigate}) => {
    const host=$('#guide-list'), search=$('#guide-search');
    let category='';
    const cards=guides.map(guide=>{
      const card=document.createElement('details');card.className='guide-card';card.dataset.guide=guide.id;
      const summary=document.createElement('summary');
      const icon=document.createElement('span');icon.className='guide-number';icon.textContent=String(guides.indexOf(guide)+1).padStart(2,'0');
      const heading=document.createElement('span');heading.className='guide-heading';
      const category=document.createElement('small');category.textContent=guide.category;
      const title=document.createElement('b');title.textContent=guide.title;
      const description=document.createElement('span');description.textContent=guide.summary;
      heading.append(category,title,description);summary.append(icon,heading);
      const list=document.createElement('ol');guide.steps.forEach(text=>{const step=document.createElement('li');step.textContent=text;list.append(step);});
      const action=document.createElement('button');action.type='button';action.className='ghost-btn';action.textContent=guide.action+' ↗';action.addEventListener('click',()=>onNavigate(guide.page));
      card.append(summary,list,action);host.append(card);return {card,category:guide.category,text:[guide.title,guide.category,guide.summary,...guide.steps].join(' ').toLowerCase()};
    });
    const filter=()=>{
      const query=search.value.trim().toLowerCase();let visible=0;
      cards.forEach(({card,text,category:kind})=>{card.hidden=!text.includes(query)||(category==='help'?kind!=='Troubleshoot':category==='setup'?kind==='Troubleshoot':false);if(!card.hidden)visible++;});
      $('#guide-empty').hidden=visible>0;$('#guide-count').textContent=`${visible} of ${cards.length} guides`;
    };
    search.addEventListener('input',filter);
    for(const [id,value] of [['#guide-category-setup','setup'],['#guide-category-help','help']])$(id).addEventListener('click',()=>{category=category===value?'':value;$('#guide-category-setup').setAttribute('aria-pressed',String(category==='setup'));$('#guide-category-help').setAttribute('aria-pressed',String(category==='help'));filter();});
    $('#guide-count').textContent=`${cards.length} guides · available offline`;
  };
})();
