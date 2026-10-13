function decodeHtml(value=''){return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function meta(html,key){const patterns=[
 new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["'][^>]+content=["']([^"']+)["']`,'i'),
 new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`,'i')];
 for(const p of patterns){const m=String(html).match(p);if(m)return decodeHtml(m[1]).trim();}return '';}
function canonical(html){const m=String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)||String(html).match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);return m?decodeHtml(m[1]).trim():'';}
function cleanTitle(title,platform){let out=String(title||'').replace(/\s+/g,' ').trim();const suffixes={youtube:/\s*-\s*YouTube$/i,instagram:/\s*•\s*Instagram.*$/i,facebook:/\s*\|\s*Facebook$/i,x:/\s*\/\s*X$/i,pinterest:/\s*\|\s*Pinterest$/i};if(suffixes[platform])out=out.replace(suffixes[platform],'').trim();return out.slice(0,300);}
async function withTimeoutFetch(fetchImpl,url,options={}){const controller=typeof AbortController!=='undefined'?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),12000):null;try{return await fetchImpl(url,{...options,...(controller?{signal:controller.signal}:{})});}finally{if(timer)clearTimeout(timer);}}
async function fetchText(fetchImpl,url){const response=await withTimeoutFetch(fetchImpl,url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36','accept-language':'en-US,en;q=0.9'}});if(!response?.ok)throw new Error(`HTTP ${response?.status||0}`);return await response.text();}
async function resolveYouTubeOembed(target,fetchImpl){if(target.targetType!=='video')return null;const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(target.url)}&format=json`;const response=await withTimeoutFetch(fetchImpl,endpoint,{headers:{'user-agent':'Mozilla/5.0'}});if(!response?.ok)return null;const data=await response.json();return {title:cleanTitle(data?.title,'youtube'),creatorName:String(data?.author_name||'').trim().slice(0,160),creatorUrl:String(data?.author_url||'').trim(),canonicalUrl:target.url,resolutionStatus:'resolved',resolutionReason:'YouTube metadata resolved'};}
async function resolveSocialTarget(target,{fetchImpl=globalThis.fetch}={}){
 if(!target?.url||typeof fetchImpl!=='function')return {...target,resolutionStatus:'unresolved',resolutionReason:'Metadata resolver is unavailable'};
 try{
  if(target.platform==='youtube'){try{const yt=await resolveYouTubeOembed(target,fetchImpl);if(yt)return {...target,...yt,resolvedAt:new Date().toISOString()};}catch{}}
  const html=await fetchText(fetchImpl,target.url);const title=cleanTitle(meta(html,'og:title')||meta(html,'twitter:title')||((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''),target.platform);
  let creatorName=String(meta(html,'author')||meta(html,'article:author')||'').trim().slice(0,160);if(!creatorName&&['channel','profile','page','page/profile','community'].includes(String(target.targetType||'')))creatorName=title; if(!creatorName)creatorName=String(meta(html,'og:site_name')||'').trim().slice(0,160);
  const canonicalUrl=canonical(html)||target.url;const enough=Boolean(title||creatorName);
  return {...target,title:title||target.title||'',creatorName:creatorName||target.creatorName||'',canonicalUrl,resolutionStatus:enough?'resolved':'partial',resolutionReason:enough?'Page metadata resolved':'The platform did not expose public title/creator metadata',resolvedAt:new Date().toISOString()};
 }catch(error){return {...target,resolutionStatus:'unresolved',resolutionReason:error instanceof Error?error.message:String(error),resolvedAt:new Date().toISOString()};}
}
async function resolveMany(targets,options={}){const out=[];for(const target of targets||[])out.push(await resolveSocialTarget(target,options));return out;}
module.exports={resolveSocialTarget,resolveMany,_test:{decodeHtml,meta,canonical,cleanTitle}};
