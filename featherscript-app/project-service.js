// Desktop-owned, profile-isolated project memory. No website-origin access.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createBroker,KEY}=require('../featherscript-extension/core/projects');
const REMOTE=new Set(['list','find','get','create','resolve','attach','checkpoint','quick','preferences','note_save','note_delete','import']);
class ProjectService{
  constructor({directory,getProfileId}){this.directory=directory;this.getProfileId=getProfileId;this.brokers=new Map();this.server=null;this.port=0;this.token=crypto.randomBytes(32).toString('hex');}
  broker(){
    const profile=String(this.getProfileId());if(!/^[a-zA-Z0-9_-]{1,100}$/.test(profile))throw Error('Invalid desktop profile.');
    if(!this.brokers.has(profile)){
      const file=path.join(this.directory,'project-memory',profile+'.json');
      const store={get:async()=>{try{return {[KEY]:JSON.parse(fs.readFileSync(file,'utf8'))};}catch(error){if(error.code==='ENOENT')return {};throw error;}},set:async data=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(data[KEY]),{mode:0o600});fs.renameSync(temporary,file);}};
      this.brokers.set(profile,createBroker(store,{id:()=>crypto.randomUUID()}));
    }
    return this.brokers.get(profile);
  }
  async dispatch(input,{desktop=false}={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid project request.');
    if(!desktop&&!REMOTE.has(input.action))throw Error('This action is available only in the desktop Projects page.');
    const message={...input};
    if(message.action==='folder'){
      if(!desktop)throw Error('Desktop folder selection required.');
      const folder=fs.realpathSync(message.path);if(!fs.statSync(folder).isDirectory())throw Error('Choose a project folder.');
      message.action='origin';message.detected={kind:'folder',key:process.platform==='win32'?folder.toLowerCase():folder,name:folder};
    }
    const result=await this.broker().dispatch(message);
    if(input.detected?.kind==='roblox')result.detected=input.detected;
    return result;
  }
  async start(){
    if(this.server)return;
    this.server=http.createServer(async(request,response)=>{
      const send=(status,data)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
      const token=request.headers['x-fs-project-token'];
      const incoming=typeof token==='string'?Buffer.from(token):Buffer.alloc(0),expected=Buffer.from(this.token);
      if(incoming.length!==expected.length||!crypto.timingSafeEqual(incoming,expected)){send(401,{ok:false,error:'Unauthorized'});return;}
      if(request.method!=='POST'||request.url!=='/projects'){send(404,{ok:false,error:'Not found'});return;}
      const chunks=[];let bytes=0;request.setTimeout(10000,()=>request.destroy());
      try{for await(const chunk of request){bytes+=chunk.length;if(bytes>262144){send(413,{ok:false,error:'Project request is too large'});return;}chunks.push(chunk);}
        send(200,await this.dispatch(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      }catch(error){send(400,{ok:false,error:String(error.message||error)});}
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});this.port=this.server.address().port;
  }
  environment(){return {FS_PROJECT_PORT:String(this.port||''),FS_PROJECT_TOKEN:this.port?this.token:''};}
  close(){this.server?.close();this.server=null;this.port=0;}
}
module.exports={ProjectService};
