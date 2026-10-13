const adapters=[require('./adapters/spotify.cjs'),require('./adapters/apple-music.cjs'),require('./adapters/youtube-music.cjs'),require('./adapters/soundcloud.cjs'),require('./adapters/deezer.cjs'),require('./adapters/tidal.cjs'),require('./adapters/audiomack.cjs'),require('./adapters/pandora.cjs')];
function listPlatformAdapters(){return adapters.slice();}
function getPlatformAdapter(id){return adapters.find(a=>a.id===id)||null;}
function hostMatches(hostname,expected=[]){
  const host=String(hostname||'').toLowerCase().replace(/^www\./,'');
  return expected.some(value=>host===String(value).toLowerCase()||host.endsWith(`.${String(value).toLowerCase()}`));
}
function detectPlatformFromInput(input=''){
  const text=String(input||'').trim();
  let url; try{url=new URL(text);}catch{return null;}
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  if(hostMatches(host,['spotify.com'])) return 'spotify';
  if(hostMatches(host,['music.apple.com'])) return 'apple-music';
  if(hostMatches(host,['music.youtube.com','youtube.com','youtu.be'])) return 'youtube-music';
  if(hostMatches(host,['soundcloud.com','on.soundcloud.com'])) return 'soundcloud';
  if(hostMatches(host,['deezer.com','link.deezer.com','deezer.page.link'])) return 'deezer';
  if(hostMatches(host,['tidal.com','listen.tidal.com','tidal.link'])) return 'tidal';
  if(hostMatches(host,['audiomack.com','amk.to'])) return 'audiomack';
  if(hostMatches(host,['pandora.com','pandora.app.link'])) return 'pandora';
  return null;
}
function cleanResolvedMusicUrl(input=''){
  let url; try{url=new URL(String(input||''));}catch{return String(input||'').trim();}
  for(const key of [...url.searchParams.keys()]){
    const low=key.toLowerCase();
    if(low.startsWith('utm_')||['si','feature','ref','referrer','share','shared','context'].includes(low)) url.searchParams.delete(key);
  }
  url.hash='';
  return url.toString().replace(/\?$/,'');
}
function resolveCatalogInput(originalInput='',finalUrl=''){
  const original=String(originalInput||'').trim();
  const finalValue=String(finalUrl||'').trim();
  if(!/^https?:\/\//i.test(original)||!/^https?:\/\//i.test(finalValue)) return original;
  const originalPlatform=detectPlatformFromInput(original);
  const finalPlatform=detectPlatformFromInput(finalValue);
  if(!originalPlatform||!finalPlatform||originalPlatform!==finalPlatform) return original;
  let finalParsed; try{finalParsed=new URL(finalValue);}catch{return original;}
  if(originalPlatform==='pandora'&&/^\/(restricted|unavailable)(?:\/|$)/i.test(finalParsed.pathname)) return original;
  return cleanResolvedMusicUrl(finalValue);
}

function resolveCatalogInputWithHints(originalInput='',finalUrl='',hints=[]){
  const resolved=resolveCatalogInput(originalInput,finalUrl);
  const originalPlatform=detectPlatformFromInput(originalInput);
  if(originalPlatform){
    const resolvedPlatform=detectPlatformFromInput(resolved);
    const resolvedUrl=(()=>{try{return new URL(resolved);}catch{return null;}})();
    const stillShare=resolvedUrl&&[
      'link.deezer.com','deezer.page.link','on.soundcloud.com','tidal.link','amk.to','pandora.app.link'
    ].includes(resolvedUrl.hostname.toLowerCase());
    if((!resolvedPlatform||stillShare) && Array.isArray(hints)){
      for(const hint of hints){
        const value=String(hint||'').trim();
        if(!value||detectPlatformFromInput(value)!==originalPlatform) continue;
        let parsed; try{parsed=new URL(value);}catch{continue;}
        if(/\/(album|playlist|track|artist|song|sets|channel|@[^/]+)/i.test(parsed.pathname)||/[?&]list=/.test(parsed.search)) return cleanResolvedMusicUrl(value);
      }
    }
  }
  return resolved;
}

module.exports={listPlatformAdapters,getPlatformAdapter,detectPlatformFromInput,resolveCatalogInput,resolveCatalogInputWithHints,cleanResolvedMusicUrl};
