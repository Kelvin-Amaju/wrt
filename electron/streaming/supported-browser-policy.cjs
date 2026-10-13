const fs=require('node:fs');
const { resolveInstalledChrome, resolveInstalledBrave }=require('../chrome-runtime-resolver.cjs');
const MIN_SUPPORTED_CHROMIUM_MAJOR=126;

function cleanBase(value){return String(value||'').replace(/[\\/]+$/,'');}
function joinPortable(base,suffix){return `${cleanBase(base)}/${suffix}`;}

function browserCandidates({platform=process.platform,env=process.env}={}){
  const rows=[];
  const add=(browserFamily,label,executablePath)=>{if(executablePath)rows.push({browserFamily,label,executablePath});};
  if(platform==='win32'){
    if(env.LOCALAPPDATA) add('chrome','Google Chrome',joinPortable(env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'));
    if(env.LOCALAPPDATA) add('brave','Brave',joinPortable(env.LOCALAPPDATA,'BraveSoftware/Brave-Browser/Application/brave.exe'));
    if(env.PROGRAMFILES) add('chrome','Google Chrome',joinPortable(env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'));
    if(env.PROGRAMFILES) add('brave','Brave',joinPortable(env.PROGRAMFILES,'BraveSoftware/Brave-Browser/Application/brave.exe'));
    if(env['PROGRAMFILES(X86)']) add('chrome','Google Chrome',joinPortable(env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'));
    if(env['PROGRAMFILES(X86)']) add('brave','Brave',joinPortable(env['PROGRAMFILES(X86)'],'BraveSoftware/Brave-Browser/Application/brave.exe'));
    if(env.PROGRAMFILES) add('edge','Microsoft Edge',joinPortable(env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe'));
    if(env['PROGRAMFILES(X86)']) add('edge','Microsoft Edge',joinPortable(env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'));
  }else if(platform==='darwin'){
    add('chrome','Google Chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('brave','Brave','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    add('edge','Microsoft Edge','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  }else{
    add('chrome','Google Chrome','/usr/bin/google-chrome');
    add('chrome','Google Chrome','/usr/bin/google-chrome-stable');
    add('brave','Brave','/usr/bin/brave-browser');
    add('brave','Brave','/usr/bin/brave-browser-stable');
    add('brave','Brave','/snap/bin/brave');
    add('edge','Microsoft Edge','/usr/bin/microsoft-edge');
    add('edge','Microsoft Edge','/usr/bin/microsoft-edge-stable');
  }
  return rows;
}

function findInstalledChromiumBrowser({platform=process.platform,env=process.env,existsSync=fs.existsSync,preferredFamily=''}={}){
  // Use the same robust resolver as Run so Streaming/Social never disagree about Brave.
  const useRuntimeDefaults=platform===process.platform&&env===process.env&&existsSync===fs.existsSync;
  if(preferredFamily==='brave'){const resolved=useRuntimeDefaults?resolveInstalledBrave():resolveInstalledBrave({platform,env,existsSync});if(resolved?.found)return resolved;}
  if(preferredFamily==='chrome'){const resolved=useRuntimeDefaults?resolveInstalledChrome():resolveInstalledChrome({platform,env,existsSync});if(resolved?.found)return resolved;}
  const rows=browserCandidates({platform,env});
  return rows.find(row=>existsSync(row.executablePath))||null;
}

function resolveAutomationBrowserPolicy(input={}){
  const deviceMode=typeof input==='string'?input:String(input?.deviceMode||'desktop');
  const systemBrowser=typeof input==='object'&&input?input.systemBrowser:undefined;
  const browserRuntime=typeof input==='object'&&input?String(input.browserRuntime||''):'';
  const preferredFamily=browserRuntime==='brave-installed'?'brave':browserRuntime==='chrome-installed'?'chrome':'';
  const installed=systemBrowser||findInstalledChromiumBrowser({preferredFamily});
  if(!installed?.executablePath) throw new Error(preferredFamily==='brave'?'Brave was not found for this Streaming/Social worker':'Google Chrome, Brave, or Microsoft Edge is required for Streaming Hub desktop and mobile sessions');
  if(deviceMode==='ios'){
    return {engine:'chromium',browserFamily:installed.browserFamily,browserLabel:`${installed.label} · iOS mobile compatibility`,executablePath:installed.executablePath,compatibilityMode:true};
  }
  if(deviceMode==='android'){
    return {engine:'chromium',browserFamily:installed.browserFamily,browserLabel:`${installed.label} · Android compatibility`,executablePath:installed.executablePath,compatibilityMode:true};
  }
  return {engine:'chromium',browserFamily:installed.browserFamily,browserLabel:installed.label,executablePath:installed.executablePath,compatibilityMode:false};
}

function chromiumMajor(version){
  const major=String(version||'').match(/(\d{2,3})/)?.[1];
  return major||String(MIN_SUPPORTED_CHROMIUM_MAJOR);
}

function assertSupportedChromiumVersion(version,{minimumMajor=MIN_SUPPORTED_CHROMIUM_MAJOR}={}){
  const match=String(version||'').match(/(\d{2,3})/);
  if(!match) return null;
  const major=Number(match[1]);
  if(major<Number(minimumMajor||MIN_SUPPORTED_CHROMIUM_MAJOR)){
    throw new Error(`Installed Chromium browser is version ${major}. Update Google Chrome or Microsoft Edge before using Streaming Hub (minimum supported major: ${minimumMajor}).`);
  }
  return major;
}


function buildAndroidChromeUserAgent({deviceName='Android',browserVersion='',androidVersion='14'}={}){
  const major=chromiumMajor(browserVersion);
  return `Mozilla/5.0 (Linux; Android ${androidVersion}; ${deviceName}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
}

module.exports={MIN_SUPPORTED_CHROMIUM_MAJOR,browserCandidates,findInstalledChromiumBrowser,resolveAutomationBrowserPolicy,buildAndroidChromeUserAgent,assertSupportedChromiumVersion};
