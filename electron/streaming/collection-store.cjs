const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

function atomicWrite(file,payload){
  const tmp=`${file}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');
  fs.renameSync(tmp,file);
}

function normalizeVerification(value){
  if(!value || typeof value!=='object' || value.status!=='verified') return undefined;
  return {
    status:'verified',
    verifiedAt:String(value.verifiedAt||''),
    verifiedUrl:String(value.verifiedUrl||''),
    verifiedDeviceMode:String(value.verifiedDeviceMode||'desktop'),
    verifiedDeviceProfile:String(value.verifiedDeviceProfile||'Desktop 1280x720'),
  };
}

function normalizeTrack(track){
  if(!track || typeof track!=='object') return track;
  const verification=normalizeVerification(track.verification);
  return verification?{...track,verification}:{...track};
}

function createCollectionStore({baseDir}){
  if(!baseDir) throw new Error('baseDir is required');
  const dir=path.join(baseDir,'streaming-collections');
  fs.mkdirSync(dir,{recursive:true});
  const fileFor=id=>path.join(dir,`${id}.json`);
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

  function list(){
    return fs.readdirSync(dir)
      .filter(n=>n.endsWith('.json'))
      .map(n=>{try{return read(path.join(dir,n));}catch{return null;}})
      .filter(Boolean)
      .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function get(id){
    const f=fileFor(String(id));
    if(!fs.existsSync(f)) return null;
    try{return read(f);}catch{return null;}
  }

  function save(input={}){
    const now=new Date().toISOString();
    const id=String(input.id||randomUUID());
    const verification=normalizeVerification(input.verification);
    const record={
      schemaVersion:2,
      id,
      name:String(input.name||'Untitled collection'),
      platform:String(input.platform||'spotify'),
      sourceInput:String(input.sourceInput||''),
      canonicalSourceInput:String(input.canonicalSourceInput||input.sourceInput||''),
      sourceKind:String(input.sourceKind||'search'),
      tracks:Array.isArray(input.tracks)?input.tracks.map(normalizeTrack):[],
      createdAt:input.createdAt||now,
      updatedAt:now,
    };
    if(verification) record.verification=verification;
    atomicWrite(fileFor(id),record);
    return record;
  }

  function markVerified(id,{trackId,url,deviceMode='desktop',deviceProfile='Desktop 1280x720',verifiedAt}={}){
    const record=get(id);
    if(!record) throw new Error('Saved music item not found');
    const verification={
      status:'verified',
      verifiedAt:String(verifiedAt||new Date().toISOString()),
      verifiedUrl:String(url||''),
      verifiedDeviceMode:String(deviceMode||'desktop'),
      verifiedDeviceProfile:String(deviceProfile||'Desktop 1280x720'),
    };
    if(trackId){
      const key=String(trackId);
      let found=false;
      record.tracks=(Array.isArray(record.tracks)?record.tracks:[]).map(track=>{
        const matches=String(track?.id||'')===key || String(track?.url||'')===key;
        if(!matches) return track;
        found=true;
        return {...track,verification};
      });
      if(!found) throw new Error('Saved song not found');
    } else {
      record.verification=verification;
    }
    record.schemaVersion=2;
    record.updatedAt=new Date().toISOString();
    atomicWrite(fileFor(String(id)),record);
    return record;
  }

  function del(id){
    const f=fileFor(String(id));
    if(fs.existsSync(f)) fs.unlinkSync(f);
    return {id:String(id),deleted:true};
  }

  function convertLegacy(id,{artistResult,savedArtistStore}={}){
    const legacy=get(id);
    if(!legacy) return {converted:false,reason:'Legacy collection not found'};
    if(String(legacy.platform)!=='spotify') return {converted:false,reason:'Only Spotify legacy collections can be converted'};
    if(!artistResult?.artist?.platformArtistId||!Array.isArray(artistResult?.tracks)||!savedArtistStore?.upsertArtist) return {converted:false,reason:'Verified exact artist catalog is required'};
    const byId=new Map();
    const byUrl=new Map();
    for(const t of artistResult.tracks){
      const tid=String(t.spotifyTrackId||t.id||'');
      if(tid) byId.set(tid,t);
      if(t.url) byUrl.set(String(t.url),t);
    }
    const mapped=[];
    for(const t of legacy.tracks||[]){
      const found=byId.get(String(t.id||''))||byUrl.get(String(t.url||''));
      if(!found) return {converted:false,reason:'Legacy tracks could not all be mapped to one exact artist'};
      if(!(found.creditedArtistIds||[]).includes(String(artistResult.artist.platformArtistId))) return {converted:false,reason:'Legacy collection contains tracks outside the exact artist'};
      mapped.push(String(found.spotifyTrackId||found.id));
    }
    const artist=savedArtistStore.upsertArtist({result:artistResult,selectedTrackIds:mapped,sourceOrigin:{kind:legacy.sourceKind||'search',input:legacy.sourceInput||legacy.name||'',addedAt:new Date().toISOString()}});
    return {converted:true,artist};
  }

  return {dir,list,get,save,markVerified,convertLegacy,delete:del};
}

module.exports={createCollectionStore};
