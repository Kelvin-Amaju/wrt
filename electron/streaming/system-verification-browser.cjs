const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {findInstalledChromiumBrowser}=require('./supported-browser-policy.cjs');

function findSystemBrowserExecutable(options={}){
  return findInstalledChromiumBrowser(options)?.executablePath||null;
}

function createSystemVerificationBrowserLauncher({
  platform=process.platform,
  env=process.env,
  existsSync=fs.existsSync,
  spawnImpl=spawn,
  spawn:spawnOverride,
  mkdtempSync=fs.mkdtempSync,
  rmSync=fs.rmSync,
  tmpdir=os.tmpdir,
}={}){
  const spawnFn=spawnOverride||spawnImpl;
  return {
    async open({url,profile={}}={}){
      const browser=findInstalledChromiumBrowser({platform,env,existsSync});
      if(!browser?.executablePath) throw new Error('Google Chrome, Brave, or Microsoft Edge was not found for link verification');
      const viewport=profile.viewport||{width:1280,height:720};
      const userDataDir=mkdtempSync(path.join(tmpdir(),'orbitqa-verify-'));
      const args=[
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`,
        `--window-size=${Math.max(380,Number(viewport.width)||1280)},${Math.max(700,Number(viewport.height)||720)}`,
      ];
      if(profile.userAgent) args.push(`--user-agent=${profile.userAgent}`);
      args.push(String(url));
      const child=spawnFn(browser.executablePath,args,{stdio:'ignore',windowsHide:false});
      let closed=false;
      let closeListener=null;
      let cleaned=false;
      const cleanup=()=>{
        if(cleaned) return;
        cleaned=true;
        try{rmSync(userDataDir,{recursive:true,force:true});}catch{}
      };
      child.once?.('exit',()=>{closed=true;cleanup();closeListener?.();});
      child.once?.('error',()=>{closed=true;cleanup();closeListener?.();});
      return {
        browserLabel:browser.label,
        onClose(callback){closeListener=typeof callback==='function'?callback:null;},
        focus(){},
        close(){
          if(closed){cleanup();return;}
          closed=true;
          try{child.kill?.();}catch{}
          cleanup();
        },
      };
    },
  };
}


function createStreamingVerificationBrowserLauncher({browserFactory}={}){
  if(!browserFactory?.open) throw new Error('Streaming browser factory is required for verification');
  return {
    async open({url,deviceMode='desktop',deviceProfile='Desktop 1280x720',browserRuntime='chrome-installed'}={}){
      const session=await browserFactory.open({
        runId:`stream-link-verify:${Date.now()}`,
        workUnit:{workId:`link-verify:${Date.now()}`,deviceMode,deviceProfile,browserRuntime},
        account:{proxySource:'none'},
        executionMode:'visible',
      });
      await session.page?.goto?.(String(url),{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>undefined);
      let closeListener=null;
      let closed=false;
      const notify=()=>{if(closed)return;closed=true;closeListener?.();};
      session.page?.on?.('close',notify);
      session.browser?.on?.('disconnected',notify);
      return {
        browserLabel:session.browserPolicy?.browserLabel||'Supported browser',
        onClose(callback){closeListener=typeof callback==='function'?callback:null;},
        async focus(){try{await session.page?.bringToFront?.();}catch{}},
        async close(){if(closed){await session.close?.().catch(()=>undefined);return;} closed=true;await session.close?.().catch(()=>undefined);},
      };
    },
  };
}

module.exports={findSystemBrowserExecutable,createSystemVerificationBrowserLauncher,createStreamingVerificationBrowserLauncher};
