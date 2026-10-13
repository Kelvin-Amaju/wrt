const {assertDirectNetworkAllowed}=require('../network-route-guard.cjs');
const {randomUUID}=require('node:crypto');

function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||min));}

function createLinkVerificationManager({BrowserWindow,deviceProfileResolver,verificationBrowserLauncher=null,now=()=>new Date(),reopenDelayMs=150}={}){
  if(typeof BrowserWindow!=='function') throw new Error('BrowserWindow is required for link verification');
  if(typeof deviceProfileResolver!=='function') throw new Error('deviceProfileResolver is required for link verification');
  const sessions=new Map();
  const byTarget=new Map();

  function publicSession(session){
    return {
      sessionId:session.sessionId,
      targetKey:session.targetKey,
      url:session.url,
      deviceMode:session.deviceMode,
      deviceProfile:session.deviceProfile,
      browserRuntime:session.browserRuntime,
      openedAt:session.openedAt,
    };
  }

  async function openElectronWindow(session,profile){
    const viewport=profile.viewport||{width:1280,height:720};
    const width=clamp(viewport.width,380,1280);
    const height=clamp(viewport.height,700,920);
    const win=new BrowserWindow({
      width,
      height,
      minWidth:Math.min(width,380),
      minHeight:Math.min(height,600),
      title:`OrbitQA Link Verification - ${session.deviceProfile}`,
      show:true,
      autoHideMenuBar:true,
      backgroundColor:'#080b14',
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false},
    });
    if(profile.userAgent) win.webContents?.setUserAgent?.(profile.userAgent);
    session.win=win;
    session.browserHandle=null;
    win.on?.('close',(event)=>{
      if(session.allowClose) return;
      event?.preventDefault?.();
      win.focus?.();
    });
    win.on?.('closed',()=>{
      if(session.allowClose){
        sessions.delete(session.sessionId);
        if(byTarget.get(session.targetKey)===session.sessionId) byTarget.delete(session.targetKey);
      }
    });
    try{await win.loadURL(session.url);}catch(error){session.navigationError=error instanceof Error?error.message:String(error);}
  }

  async function openSupportedBrowser(session,profile){
    if(!verificationBrowserLauncher?.open) return false;
    let handle;
    try{
      handle=await verificationBrowserLauncher.open({url:session.url,profile,deviceMode:session.deviceMode,deviceProfile:session.deviceProfile,browserRuntime:session.browserRuntime});
    }catch(error){
      session.systemBrowserError=error instanceof Error?error.message:String(error);
      return false;
    }
    session.browserHandle=handle;
    session.win=null;
    handle?.onClose?.(()=>{
      if(session.allowClose) return;
      if(session.browserHandle!==handle) return;
      session.browserHandle=null;
      setTimeout(async()=>{
        if(session.allowClose || !sessions.has(session.sessionId)) return;
        const reopened=await openSupportedBrowser(session,profile);
        if(!reopened && !verificationBrowserLauncher && !session.allowClose && sessions.has(session.sessionId)) await openElectronWindow(session,profile);
      },Math.max(0,Number(reopenDelayMs)||0));
    });
    return true;
  }

  async function start({targetKey,url,deviceMode='desktop',deviceProfile='Desktop 1280x720',browserRuntime='chrome-installed'}={}){
    assertDirectNetworkAllowed('Direct link verification browser');
    const key=String(targetKey||'').trim();
    const exactUrl=String(url||'').trim();
    if(!key) throw new Error('Verification target is required');
    if(!/^https?:\/\//i.test(exactUrl)) throw new Error('A valid http(s) link is required for verification');
    const existingId=byTarget.get(key);
    const existing=existingId?sessions.get(existingId):null;
    if(existing){
      if(existing.browserHandle){existing.browserHandle.focus?.();return publicSession(existing);}
      if(existing.win && !existing.win.isDestroyed?.()){existing.win.focus?.();return publicSession(existing);}
    }
    if(existingId){sessions.delete(existingId);byTarget.delete(key);}

    const mode=['android','ios'].includes(deviceMode)?deviceMode:'desktop';
    const profile=deviceProfileResolver(mode,deviceProfile)||deviceProfileResolver('desktop','Desktop 1280x720')||{};
    const session={
      sessionId:randomUUID(),
      targetKey:key,
      url:exactUrl,
      deviceMode:mode,
      deviceProfile:String(deviceProfile||'Desktop 1280x720'),
      browserRuntime:String(browserRuntime||'chrome-installed'),
      openedAt:now().toISOString(),
      allowClose:false,
      win:null,
      browserHandle:null,
    };
    sessions.set(session.sessionId,session);
    byTarget.set(key,session.sessionId);

    const opened=await openSupportedBrowser(session,profile);
    if(!opened){
      if(verificationBrowserLauncher){
        sessions.delete(session.sessionId);
        if(byTarget.get(key)===session.sessionId) byTarget.delete(key);
        throw new Error(session.systemBrowserError||'A supported Chrome, Brave, Edge, or WebKit verification browser could not be opened');
      }
      await openElectronWindow(session,profile);
    }
    return publicSession(session);
  }

  async function complete(sessionId){
    const id=String(sessionId||'');
    const session=sessions.get(id);
    if(!session) throw new Error('Verification session not found');
    const verification={
      status:'verified',
      verifiedAt:now().toISOString(),
      verifiedUrl:session.url,
      verifiedDeviceMode:session.deviceMode,
      verifiedDeviceProfile:session.deviceProfile,
    };
    session.allowClose=true;
    sessions.delete(id);
    if(byTarget.get(session.targetKey)===id) byTarget.delete(session.targetKey);
    try{session.browserHandle?.close?.();}catch{}
    if(session.win && !session.win.isDestroyed?.()) session.win.destroy?.();
    return verification;
  }

  function get(sessionId){
    const session=sessions.get(String(sessionId||''));
    return session?publicSession(session):null;
  }

  function closeAll(){
    for(const session of sessions.values()){
      session.allowClose=true;
      try{session.browserHandle?.close?.();}catch{}
      try{if(session.win && !session.win.isDestroyed?.()) session.win.destroy?.();}catch{}
    }
    sessions.clear();
    byTarget.clear();
  }

  return {start,complete,get,closeAll};
}

module.exports={createLinkVerificationManager};
