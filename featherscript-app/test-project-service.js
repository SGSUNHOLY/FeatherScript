const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ProjectService}=require('./project-service');
(async()=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.test-projects-'));let profile='profile-a';
  const service=new ProjectService({directory,getProfileId:()=>profile});
  try{
    await service.start();const url=`http://127.0.0.1:${service.port}/projects`;
    const remote=async data=>{const response=await fetch(url,{method:'POST',headers:{'X-FS-Project-Token':service.token,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,...await response.json()};};
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{'X-FS-Project-Token':'é'.repeat(64)},body:'{}'})).status,401);
    const created=await remote({action:'create',profile:'roblox',title:'Village 🪶',detected:{kind:'roblox',key:'place:42',name:'Village'}});assert.equal(created.ok,true);const id=created.project.id;
    await remote({action:'checkpoint',profile:'roblox',projectId:id,entry:{id:'t-1',prompt:'Build café',reply:'Café ready',outcome:'completed'}});
    let fired=await service.dispatch({action:'fire',projectId:id,profile:'roblox'},{desktop:true});assert.equal(fired.project.handoff.status,'ready');
    await remote({action:'checkpoint',profile:'roblox',projectId:id,entry:{id:'t-2',prompt:'Build road',outcome:'running'}});
    assert.equal((await service.dispatch({action:'get',projectId:id,profile:'roblox'},{desktop:true})).project.handoff.entries.length,1,'fired handoff is a frozen snapshot');
    for(const action of ['all','delete','fire','folder','origin'])assert.equal((await remote({action,projectId:id,profile:'roblox'})).ok,false,'web/extension cannot perform desktop-only action '+action);
    profile='profile-b';assert.equal((await service.dispatch({action:'all'},{desktop:true})).projects.length,0,'desktop profiles have separate project files');
    assert.equal((await remote({action:'get',projectId:id,profile:'roblox'})).ok,false);profile='profile-a';
    const local=await remote({action:'create',profile:'agent',title:'Local tools'});
    const linked=await service.dispatch({action:'folder',projectId:local.project.id,profile:'agent',path:directory},{desktop:true});assert.equal(linked.project.origin.kind,'folder');
    await service.dispatch({action:'delete',projectId:id,profile:'roblox'},{desktop:true});
    assert.equal((await remote({action:'checkpoint',projectId:id,profile:'roblox',entry:{id:'late',prompt:'late',outcome:'completed'}})).ok,false,'deleted memory cannot be resurrected by late task results');
    assert.ok(fs.existsSync(directory),'memory deletion keeps actual project folders');
    const restarted=new ProjectService({directory,getProfileId:()=>profile});
    assert.equal((await restarted.dispatch({action:'all'},{desktop:true})).projects.length,1,'memory survives app service restart');
    console.log('PASS desktop memory: persistent organization, frozen handoffs, deletion, profile isolation, authenticated Unicode HTTP and desktop-only controls');
  }finally{service.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(__dirname));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
