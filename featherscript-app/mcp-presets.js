const fs=require('node:fs'),path=require('node:path');
const presets=require('../mcp-presets.json');
function list(root){const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));return presets.map(p=>({...p,enabled:!!config.mcpServers?.[p.id]}));}
function save(root,input){
 if(!input||typeof input.enabled!=='boolean')throw Error('Choose an integration and enabled state.');
 const preset=presets.find(p=>p.id===input.id);if(!preset)throw Error('Unknown optional integration.');
 const file=path.join(root,'config.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));config.mcpServers||={};
 if(input.enabled)config.mcpServers[preset.id]={command:'launch_optional_mcp.py',args:[preset.id]};else delete config.mcpServers[preset.id];
 const temporary=file+'.presets-'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n');fs.renameSync(temporary,file);
 return list(root);
}
module.exports={list,save};
