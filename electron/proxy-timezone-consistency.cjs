function clean(value){return String(value ?? '').trim();}

function validTimezoneId(value){
  const timezoneId=clean(value);
  if(!timezoneId)return '';
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezoneId}).format(new Date(0));return timezoneId;}catch{return '';}
}

function finite(value){const n=Number(value);return Number.isFinite(n)?n:undefined;}

async function readJsonPage(context,url,timeoutMs){
  if(!context||typeof context.newPage!=='function'){const e=new Error('Proxy timezone browser probe is unavailable');e.code='ORBITQA_TIMEZONE_PROBE_UNAVAILABLE';throw e;}
  const page=await context.newPage();
  if(!page||typeof page.goto!=='function'){await page?.close?.().catch(()=>undefined);const e=new Error('Proxy timezone browser probe page is unavailable');e.code='ORBITQA_TIMEZONE_PROBE_UNAVAILABLE';throw e;}
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:timeoutMs});
    const text=await response?.text?.().catch?.(()=>null) ?? await page.textContent('body').catch(()=>null);
    if(!text)throw new Error('empty geo response');
    return JSON.parse(String(text));
  }finally{await page.close?.().catch(()=>undefined);}
}

function normalizeIpWho(raw={}){
  const timezoneId=validTimezoneId(raw?.timezone?.id||raw?.timezone||'');
  if(raw?.success===false||!timezoneId)return null;
  return {
    timezoneId,
    countryCode:clean(raw.country_code||raw.countryCode).toUpperCase(),
    country:clean(raw.country), region:clean(raw.region), city:clean(raw.city),
    latitude:finite(raw.latitude), longitude:finite(raw.longitude), provider:'ipwho.is',
  };
}
function normalizeIpApiCo(raw={}){
  const timezoneId=validTimezoneId(raw.timezone||'');
  if(raw?.error===true||!timezoneId)return null;
  return {
    timezoneId,
    countryCode:clean(raw.country_code||raw.country).toUpperCase(),
    country:clean(raw.country_name), region:clean(raw.region), city:clean(raw.city),
    latitude:finite(raw.latitude), longitude:finite(raw.longitude), provider:'ipapi.co',
  };
}

async function resolveProxyTimezoneFromExitIp({context,proxiedIp,timeoutMs=8000}={}){
  const ip=clean(proxiedIp);
  if(!ip)throw new Error('Proxy exit IP is required for timezone resolution');
  const attempts=[
    [`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city,latitude,longitude,timezone`,normalizeIpWho],
    [`https://ipapi.co/${encodeURIComponent(ip)}/json/`,normalizeIpApiCo],
  ];
  const errors=[];
  for(const [url,normalize] of attempts){
    try{const geo=normalize(await readJsonPage(context,url,timeoutMs));if(geo)return {...geo,proxiedIp:ip};errors.push(`${url}: timezone missing`);}catch(error){if(error?.code==='ORBITQA_TIMEZONE_PROBE_UNAVAILABLE')throw error;errors.push(`${url}: ${error instanceof Error?error.message:String(error)}`);}
  }
  throw new Error(`Could not resolve timezone for proxy exit ${ip}: ${errors.join(' | ')}`);
}

async function applyTimezoneToChromiumContext({context,timezoneId}={}){
  const zone=validTimezoneId(timezoneId);
  if(!zone)throw new Error(`Invalid proxy timezone: ${timezoneId||'missing'}`);
  if(!context||typeof context.newCDPSession!=='function')throw new Error('Chromium CDP timezone override is unavailable');
  const apply=async(page)=>{
    if(!page||page.isClosed?.())return;
    const session=await context.newCDPSession(page);
    try{await session.send('Emulation.setTimezoneOverride',{timezoneId:zone});}
    finally{await session.detach?.().catch(()=>undefined);}
  };
  for(const page of context.pages?.()||[])await apply(page);
  context.__orbitqaProxyTimezoneId=zone;
  if(!context.__orbitqaProxyTimezoneHookInstalled&&typeof context.on==='function'){
    context.__orbitqaProxyTimezoneHookInstalled=true;
    context.on('page',(page)=>{const current=clean(context.__orbitqaProxyTimezoneId);if(current)void apply(page).catch(()=>undefined);});
  }
  return zone;
}

async function synchronizeProxyTimezone({context,browserEngine='chromium',proxiedIp,currentTimezoneId='',timeoutMs=8000}={}){
  const current=validTimezoneId(currentTimezoneId);
  let geo;
  try{geo=await resolveProxyTimezoneFromExitIp({context,proxiedIp,timeoutMs});}
  catch(error){
    if(error?.code==='ORBITQA_TIMEZONE_PROBE_UNAVAILABLE'&&current)return {status:'PASS',changed:false,timezoneId:current,geo:{timezoneId:current,proxiedIp:clean(proxiedIp),provider:'existing-verified-metadata'},probeUnavailable:true};
    throw error;
  }
  const actual=geo.timezoneId;
  if(browserEngine==='chromium'){
    await applyTimezoneToChromiumContext({context,timezoneId:actual});
    return {status:'PASS',changed:current!==actual,timezoneId:actual,geo};
  }
  if(current===actual)return {status:'PASS',changed:false,timezoneId:actual,geo};
  return {status:'FAIL',changed:false,timezoneId:actual,geo,reason:`Proxy exit timezone ${actual} does not match browser timezone ${current||'unset'} and this runtime cannot change it live`};
}

module.exports={validTimezoneId,resolveProxyTimezoneFromExitIp,applyTimezoneToChromiumContext,synchronizeProxyTimezone};
