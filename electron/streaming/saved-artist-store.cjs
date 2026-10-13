const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

function atomicWrite(file,payload){const tmp=`${file}.tmp`; fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8'); fs.renameSync(tmp,file);}
function createSavedArtistStore({baseDir,now=()=>new Date()}={}){
  if(!baseDir) throw new Error('baseDir is required');
  const dir=path.join(baseDir,'streaming-artists'); fs.mkdirSync(dir,{recursive:true});
  const fileFor=id=>path.join(dir,`${id}.json`);
  const readFile=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
  function list(){return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>readFile(path.join(dir,n))).filter(Boolean).sort((a,b)=>String(a.artistName).localeCompare(String(b.artistName)));}
  function get(id){const file=fileFor(String(id)); return fs.existsSync(file)?readFile(file):null;}
  function getByPlatformArtistId(platformArtistId){const key=String(platformArtistId||''); return list().find(a=>String(a.platformArtistId)===key)||null;}
  function mergeOrigins(existing,origin){const rows=[...(existing||[])]; if(origin?.kind&&origin?.input){const key=`${origin.kind}:${origin.input}`; if(!rows.some(x=>`${x.kind}:${x.input}`===key)) rows.push({kind:String(origin.kind),input:String(origin.input),addedAt:String(origin.addedAt||now().toISOString())});} return rows;}
  function normalizeSelection(catalogTracks,selected){const allowed=new Set((catalogTracks||[]).map(t=>String(t.spotifyTrackId||t.id))); const seen=new Set(); const out=[]; for(const id of selected||[]){const key=String(id); if(allowed.has(key)&&!seen.has(key)){seen.add(key); out.push(key);}} return out;}
  function upsertArtist({result,selectedTrackIds,sourceOrigin}={}){
    if(!result?.artist?.platformArtistId) throw new Error('Verified artist metadata is required');
    const platformArtistId=String(result.artist.platformArtistId);
    const existing=getByPlatformArtistId(platformArtistId);
    const stamp=now().toISOString();
    const catalogTracks=Array.isArray(result.tracks)&&result.status!=='failed'?result.tracks:(existing?.catalogTracks||[]);
    const selection=selectedTrackIds!==undefined?normalizeSelection(catalogTracks,selectedTrackIds):normalizeSelection(catalogTracks,existing?.selectedTrackIds||[]);
    const selectedSet=new Set(selection);
    const normalizedTracks=catalogTracks.map(t=>{const id=String(t.spotifyTrackId||t.id); return selectedSet.has(id)?{...t,isNew:false}:t;});
    const record={
      schemaVersion:2,id:String(existing?.id||randomUUID()),platform:'spotify',platformArtistId,
      artistName:String(result.artist.artistName||existing?.artistName||'Unknown artist'),
      artistUrl:String(result.artist.artistUrl||existing?.artistUrl||`https://open.spotify.com/artist/${platformArtistId}`),
      ...(result.artist.artworkUrl||existing?.artworkUrl?{artworkUrl:String(result.artist.artworkUrl||existing.artworkUrl)}:{}),
      sourceOrigins:mergeOrigins(existing?.sourceOrigins,sourceOrigin),catalogTracks:normalizedTracks,selectedTrackIds:selection,
      autoRefreshEnabled:existing?.autoRefreshEnabled!==undefined?existing.autoRefreshEnabled:true,
      lastFetchedAt:result.status==='failed'?(existing?.lastFetchedAt||stamp):stamp,
      lastFetchStatus:String(result.status||existing?.lastFetchStatus||'never'),
      ...(result.error?{lastFetchError:String(result.error)}:{}),
      createdAt:String(existing?.createdAt||stamp),updatedAt:stamp,
    };
    atomicWrite(fileFor(record.id),record); return record;
  }
  function saveSelection(id,selectedTrackIds){const existing=get(id); if(!existing) throw new Error('Saved artist not found'); const selection=normalizeSelection(existing.catalogTracks,selectedTrackIds); const selectedSet=new Set(selection); const record={...existing,selectedTrackIds:selection,catalogTracks:(existing.catalogTracks||[]).map(t=>selectedSet.has(String(t.spotifyTrackId||t.id))?{...t,isNew:false}:t),updatedAt:now().toISOString()}; atomicWrite(fileFor(record.id),record); return record;}
  function setAutoRefresh(id,enabled){const existing=get(id); if(!existing) throw new Error('Saved artist not found'); const record={...existing,autoRefreshEnabled:enabled===true,updatedAt:now().toISOString()}; atomicWrite(fileFor(record.id),record); return record;}
  function del(id){const file=fileFor(String(id)); if(fs.existsSync(file)) fs.unlinkSync(file); return {id:String(id),deleted:true};}
  return {dir,list,get,getByPlatformArtistId,upsertArtist,saveSelection,setAutoRefresh,delete:del};
}
module.exports={createSavedArtistStore};
