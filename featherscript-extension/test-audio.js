const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {create,normalize,KEY}=require('./core/audio-broker');
async function test(){
  let settings={},exists=false,creates=0,closes=0,playing=false,volume=.5,failPlay=false;
  const updates=[];
  const api={storage:{local:{get:async()=>settings,set:async data=>{settings={...settings,...data};}}},
    runtime:{getURL:file=>'chrome-extension://fixture/'+file,getContexts:async()=>exists?[{}]:[],sendMessage:async message=>{
      assert.equal(message.target,'fs-audio-player');
      if(message.action==='play'){if(failPlay)return {ok:false,playing:false,error:'Playback blocked'};playing=true;volume=message.volume;}
      if(message.action==='volume')volume=message.volume;
      return {ok:true,playing};
    }},offscreen:{createDocument:async options=>{assert.deepEqual(options.reasons,['AUDIO_PLAYBACK']);assert.equal(exists,false,'one player only');exists=true;creates++;},closeDocument:async()=>{exists=false;playing=false;closes++;}},
  };
  const broker=create(api,{broadcast:update=>updates.push(update)});
  let status=await broker.get(false);assert.equal(status.settings.sound,false);assert.equal(settings[KEY].sound,false,'legacy mute migrates');assert.equal(creates,0,'opening a UI never starts music');
  await Promise.all([broker.set({music:true}),broker.set({music:true})]);assert.equal(creates,1,'concurrent Play creates only one player');assert.equal(playing,true);
  await broker.set({volume:.8});assert.equal(volume,.8);assert.equal(settings[KEY].sound,false,'music does not reset sound effects');
  const restarted=create(api);status=await restarted.get();assert.equal(status.playing,true,'worker restart recovers actual offscreen state');
  await broker.set({music:false});assert.equal(closes,1);assert.equal(playing,false);assert.equal(exists,false);
  await broker.set({volume:.3});assert.equal(creates,1,'volume does not start a paused player');
  for(const patch of [{volume:NaN},{volume:2},{music:'yes'},{unknown:true},null])await assert.rejects(broker.set(patch),/Invalid|Volume/);
  failPlay=true;status=await broker.set({music:true});assert.equal(status.ok,false);assert.match(status.error,/Playback blocked/);assert.equal(status.playing,false,'failed play never displays Playing');
  await broker.set({music:false});
  const unsupported=create({...api,offscreen:null});await assert.rejects(unsupported.set({music:true}),/Chrome or Edge/);
  assert.equal(normalize({volume:Infinity}).volume,.5);assert.ok(updates.length>=5);
  const wav=fs.readFileSync(path.join(__dirname,'assets/ambient.wav'));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  const rate=wav.readUInt32LE(24),channels=wav.readUInt16LE(22),bits=wav.readUInt16LE(34);
  assert.equal(channels,1);assert.equal(bits,16);assert.ok(wav.length/(rate*2)>30);
  let max=0,sum=0;for(let offset=44;offset+1<wav.length;offset+=2){const value=wav.readInt16LE(offset);max=Math.max(max,Math.abs(value));sum+=value*value;}
  assert.ok(max<32767&&max>10000,'music is audible without clipping');assert.ok(Math.sqrt(sum/((wav.length-44)/2))>1000);
  let listener;
  const player={paused:true,ended:false,volume:0,addEventListener(){},async play(){this.paused=false;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'audio.js'),'utf8'),{document:{getElementById:()=>player},chrome:{runtime:{onMessage:{addListener:fn=>{listener=fn;}}}}});
  const call=message=>new Promise(resolve=>listener(message,{},resolve));
  assert.equal(listener({target:'other'},{},()=>{}),false);
  assert.equal((await call({target:'fs-audio-player',action:'play',volume:.4})).playing,true);assert.equal(player.volume,.4);
  player.play=async()=>{throw Error('Autoplay denied');};player.paused=true;
  const failure=await call({target:'fs-audio-player',action:'play',volume:.5});assert.equal(failure.ok,false);assert.equal(failure.playing,false);
  console.log('PASS shared music: single player, popup-independent lifetime, worker recovery, migration, pause/volume/errors, bundled PCM and player acknowledgements');
}
test().catch(error=>{console.error(error);process.exitCode=1;});
