(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZSCowork=api;})(globalThis,()=>{
  'use strict';
  const MAX_IMAGES=4,MAX_IMAGE_BASE64=750000,MAX_JOB_IMAGE_BASE64=2400000,MAX_QUEUE_IMAGE_BASE64=5000000;
  const MIME_TYPES=new Set(['image/jpeg','image/png']);
  function validateImages(value=[]) {
    if(!Array.isArray(value)||value.length>MAX_IMAGES)throw Error(`Attach at most ${MAX_IMAGES} photos per task.`);
    let total=0;
    return value.map(image=>{
      if(!image||!MIME_TYPES.has(image.mimeType)||typeof image.data!=='string'||image.data.length<4||image.data.length>MAX_IMAGE_BASE64||image.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw Error('A photo is invalid or too large. Reattach a JPG or PNG.');
      total+=image.data.length;
      if(total>MAX_JOB_IMAGE_BASE64)throw Error('Photos exceed the 2.4 MB queue limit. Try fewer or smaller images.');
      return {mimeType:image.mimeType,data:image.data,name:String(image.name||'Photo').slice(0,80)};
    });
  }
  // Photos live in chrome.storage.local with each queued job. Resize and encode
  // before queueing so reloads preserve them without exhausting the storage quota.
  async function imageFromFile(file,{bitmapFactory=globalThis.createImageBitmap,canvasFactory=()=>document.createElement('canvas')}={}) {
    if(!file||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('Choose a JPG, PNG, WebP or GIF image.');
    if(file.size>16000000)throw Error('This photo is over 16 MB. Choose a smaller file.');
    let bitmap;
    try { bitmap=await bitmapFactory(file); }
    catch { throw Error('This image could not be opened. Try a JPG or PNG.'); }
    try {
      const canvas=canvasFactory(),ctx=canvas.getContext('2d');
      if(!ctx||!bitmap.width||!bitmap.height)throw Error('Image conversion is unavailable in this browser.');
      const longest=Math.max(bitmap.width,bitmap.height);
      for(const maxSide of [1600,1280,1024,800]) {
        const scale=Math.min(1,maxSide/longest);
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        // JPEG has no alpha. Use a white base for transparent PNGs and WebP.
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const candidates=[];
        if(file.type==='image/png'&&maxSide===1600)candidates.push(['image/png',undefined]);
        candidates.push(['image/jpeg',.84],['image/jpeg',.7],['image/jpeg',.55]);
        for(const [mimeType,quality] of candidates){
          const url=canvas.toDataURL(mimeType,quality),prefix=`data:${mimeType};base64,`;
          if(url.startsWith(prefix)&&url.length-prefix.length<=MAX_IMAGE_BASE64)
            return validateImages([{mimeType,data:url.slice(prefix.length),name:file.name||'Photo'}])[0];
        }
      }
      throw Error('This photo could not be compressed enough. Try a smaller image.');
    } finally { bitmap.close?.(); }
  }
  class Queue {
    constructor({save=async()=>{},run,canRun=()=>true,onChange=()=>{},now=Date.now,id=()=>globalThis.crypto.randomUUID()}) {
      this.save=save;this.run=run;this.canRun=canRun;this.onChange=onChange;this.now=now;this.id=id;
      this.jobs=[];this.enabled=false;this.paused=true;this.busy=false;this.key='';this.write=Promise.resolve();this.generation=0;
    }
    snapshot(){return {enabled:this.enabled,paused:this.paused,jobs:this.jobs.map(job=>({...job})),key:this.key};}
    changed(){const snapshot=this.snapshot();this.onChange(snapshot);this.write=this.write.catch(()=>{}).then(()=>this.save(snapshot));this.write.catch(()=>{this.paused=true;this.onChange(this.snapshot());});}
    restore(key,value={}) {
      this.generation++;this.key=key;this.enabled=!!value.enabled;this.paused=true;
      this.jobs=(Array.isArray(value.jobs)?value.jobs:[]).slice(-50).filter(job=>job&&typeof job.id==='string'&&job.id.length<=100&&typeof job.text==='string'&&job.text.length<=12000&&['queued','running','completed','failed','cancelled','interrupted'].includes(job.status)).map(job=>{
        const {mode,effortMode,...saved}=job;let images=[],invalid=false;
        try{images=validateImages(saved.images||[]);}catch{invalid=true;}
        return {...saved,images,status:invalid||job.status==='running'?'interrupted':job.status,...(invalid?{error:'Stored photo is damaged or missing. Remove this task and attach again.'}:{})};
      });
      this.changed();
    }
    add(text,images=[]) {
      images=validateImages(images);
      text=String(text||'').trim();if(!text&&images.length)text='Look at the attached photo(s) and help me with this project.';
      if(!text||text.length>12000)throw Error('Enter a prompt of 1–12,000 characters or attach a photo.');
      if(this.jobs.filter(job=>['queued','running'].includes(job.status)).length>=30)throw Error('Queue limit reached (30 pending tasks).');
      if(this.jobs.length>=50){const index=this.jobs.findIndex(item=>!['queued','running'].includes(item.status));if(index<0)throw Error('Queue is full.');this.jobs.splice(index,1);}
      if(this.jobs.reduce((sum,job)=>sum+(job.images||[]).reduce((size,image)=>size+image.data.length,0),0)+images.reduce((sum,image)=>sum+image.data.length,0)>MAX_QUEUE_IMAGE_BASE64)throw Error('Cowork photo storage is full. Clear finished tasks or remove an older photo task.');
      const job={id:this.id(),text,images,status:'queued',createdAt:this.now()};
      this.jobs.push(job);this.changed();return job;
    }
    setEnabled(enabled){this.enabled=!!enabled;if(!enabled)this.paused=true;this.changed();}
    pause(){this.paused=true;this.changed();}
    resume(){if(!this.enabled)throw Error('Enable Cowork first.');if(this.jobs.some(job=>job.status==='interrupted'||job.result==='indeterminate'))throw Error('Review and remove interrupted or uncertain tasks before resuming.');this.paused=false;this.changed();}
    remove(id){const job=this.jobs.find(job=>job.id===id);if(job?.status==='running')throw Error('Stop the running task first.');this.jobs=this.jobs.filter(job=>job.id!==id);this.changed();}
    move(id,direction){const index=this.jobs.findIndex(job=>job.id===id);const other=index+direction;if(index<0||other<0||other>=this.jobs.length||this.jobs[index].status!=='queued'||this.jobs[other].status!=='queued')return;[this.jobs[index],this.jobs[other]]=[this.jobs[other],this.jobs[index]];this.changed();}
    async pump() {
      if(this.busy||!this.enabled||this.paused||!this.canRun())return;
      const job=this.jobs.find(job=>job.status==='queued');if(!job)return;
      this.busy=true;const generation=this.generation;job.status='running';job.startedAt=this.now();this.changed();
      try {
        // Persist dispatch before any send. A restored running job is interrupted,
        // never silently resubmitted after a reload or a crash.
        await this.write;if(this.paused||generation!==this.generation){job.status='queued';return;}
        const result=await this.run({...job});
        job.status=result?.outcome==='completed'?'completed':result?.outcome==='cancelled'?'cancelled':'failed';job.finishedAt=this.now();job.result=result?.outcome||'failed';
        if(job.status!=='completed')this.paused=true;
      }catch(error){job.status='failed';job.error=String(error.message||error);this.paused=true;}
      finally {this.busy=false;if(generation===this.generation){if(job.status!=='queued'&&job.status!=='running'){job.imageCount=job.images?.length||0;delete job.images;}this.changed();}}
    }
  }
  return {Queue,validateImages,imageFromFile,MAX_IMAGES};
});
