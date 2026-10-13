const {randomUUID}=require('node:crypto');
const {getPlatformAuthConfig}=require('./adapters/_auth.cjs');
const {captureAuthorizedSession}=require('./authorized-session.cjs');

function publicSafe(account){
  if(!account)return null;
  const {password,sessionSecret,...safe}=account;
  return safe;
}
function reasonOf(result,fallback){return String(result?.reason||fallback);}
async function waitBrief(page){try{await page?.waitForTimeout?.(300);}catch{}}
async function waitMs(ms){await new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
async function safeGoto(page,url){if(!url)return false;try{await page?.goto?.(url,{waitUntil:'domcontentloaded',timeout:30000});return true;}catch{return false;}}
async function safeReload(page){try{await page?.reload?.({waitUntil:'domcontentloaded',timeout:30000});return true;}catch{return false;}}
async function verifyStableSession(adapter,session,account){
  let first=await adapter.verifySession({page:session.page,account});
  if(first?.transient){
    await safeReload(session.page);
    await waitBrief(session.page);
    first=await adapter.verifySession({page:session.page,account});
  }
  if(first?.status!=='PASS')return first;
  await waitBrief(session.page);
  const second=await adapter.verifySession({page:session.page,account});
  return second?.status==='PASS'?second:second||first;
}
function createAccountVerificationManager({accountStore,adapterRegistry,browserFactory,now=()=>new Date()}={}){
  if(!accountStore?.getInternal||!accountStore?.save)throw new Error('Streaming account store is required');
  if(!adapterRegistry?.get)throw new Error('Streaming adapter registry is required');
  if(!browserFactory?.open)throw new Error('Streaming browser factory is required');
  if(!browserFactory?.openManualLogin)throw new Error('Normal Chrome/Brave/Edge manual login is required');
  const sessions=new Map();

  async function closeEntry(entry){
    await entry?.session?.close?.().catch(()=>undefined);
    await entry?.manualBrowser?.close?.().catch(()=>undefined);
  }

  async function start({accountId}={}){
    const account=accountStore.getInternal(String(accountId||''));
    if(!account)throw new Error('Saved streaming account was not found');
    const adapter=adapterRegistry.get(account.platform);
    if(!adapter||typeof adapter.verifySession!=='function')throw new Error(`${account.platform} does not support saved-session verification`);
    const authConfig=getPlatformAuthConfig(account.platform);
    if(!authConfig?.loginUrl)throw new Error(`Manual login URL is unavailable for ${account.platform}`);

    for(const [pendingId,pending] of sessions.entries()){
      if(pending.accountId!==account.id)continue;
      sessions.delete(pendingId);
      await closeEntry(pending);
    }

    const id=randomUUID();
    const verificationAccount={...account};
    const hasSavedLogin=Boolean(account.status==='ready'||account.sessionSecret);
    const targetUrl=hasSavedLogin?(authConfig.homeUrl||authConfig.loginUrl):authConfig.loginUrl;
    const stableProfileDir=browserFactory.getAccountProfileDir?.(verificationAccount)||'';
    const manualBrowser=await browserFactory.openManualLogin({
      account:verificationAccount,
      url:targetUrl,
      profileToken:id,
      profileDir:stableProfileDir,
      freshProfile:false,
    });
    const openedAt=now().toISOString();
    const entry={
      sessionId:id,
      accountId:account.id,
      platform:account.platform,
      account,
      adapter,
      session:null,
      manualBrowser,
      manualProfileDir:manualBrowser.profileDir,
      proxySource:account.proxySource||'none',
      deviceMode:'desktop',
      deviceProfile:'Desktop 1280x720',
      browserLabel:manualBrowser.browserLabel||'Google Chrome / Brave / Microsoft Edge',
      openedAt,
      authResult:{status:'NEEDS_VERIFICATION',reason:hasSavedLogin?`Saved ${authConfig.label} account profile opened at the main account page for confirmation.`:`Normal ${authConfig.label} login opened in the dedicated browser profile for this account.`},
    };
    sessions.set(id,entry);
    return {
      sessionId:id,
      accountId:account.id,
      platform:account.platform,
      status:'pending',
      reason:hasSavedLogin?`Your saved ${authConfig.label} profile has been reopened at the main site. Confirm the correct account is still signed in, then click MARK VERIFIED to refresh the saved session.`:`Sign in to ${authConfig.label} yourself in this normal Chrome/Edge window. Complete any CAPTCHA or MFA there, then click MARK VERIFIED. OrbitQA will keep this dedicated account profile for future checks and QA runs.`,
      browserLabel:entry.browserLabel,
      proxySource:account.proxySource||'none',
      deviceMode:'desktop',
      deviceProfile:'Desktop 1280x720',
      openedAt,
    };
  }

  async function openVerificationProfile(entry){
    const verificationAccount={...entry.account};
    let lastError=null;
    for(let attempt=0;attempt<4;attempt++){
      try{
        return await browserFactory.open({
          runId:`stream-account-manual-capture:${entry.accountId}:${Date.now()}`,
          workUnit:{workId:`manual-capture:${entry.accountId}`,deviceMode:'desktop',deviceProfile:'Desktop 1280x720'},
          account:verificationAccount,
          executionMode:'visible',
          ignoreStoredSession:true,
          usePersistentProfile:true,
          profileDirOverride:entry.manualProfileDir,
          restoreStoredSession:false,
          geoConsistencyFromProxy:true,
        });
      }catch(error){
        lastError=error;
        if(attempt<3)await waitMs(650*(attempt+1));
      }
    }
    throw lastError||new Error('OrbitQA could not reopen the isolated manual-login profile');
  }

  async function reopenManual(entry,reason){
    const authConfig=getPlatformAuthConfig(entry.platform);
    entry.manualBrowser=await browserFactory.openManualLogin({
      account:{...entry.account},
      url:authConfig?.homeUrl||authConfig?.loginUrl,
      profileDir:entry.manualProfileDir,
      freshProfile:false,
    }).catch(()=>null);
    entry.session=null;
    return {ok:false,pending:true,sessionId:entry.sessionId,reason:String(reason||`The ${authConfig?.label||entry.platform} session is not confirmed yet. Finish signing in in the reopened normal browser, then click MARK VERIFIED again.`)};
  }

  async function complete(sessionId){
    const id=String(sessionId||'');
    const entry=sessions.get(id);
    if(!entry)return {ok:false,pending:false,reason:'Account verification session was not found'};

    await entry.manualBrowser?.close?.().catch(()=>undefined);
    entry.manualBrowser=null;
    await waitMs(500);

    let verificationSession=null;
    try{
      verificationSession=await openVerificationProfile(entry);
      entry.session=verificationSession;
    }catch(error){
      return reopenManual(entry,error instanceof Error?`${error.message}. Close the login browser completely if it is still open, then click MARK VERIFIED again.`:String(error));
    }

    const authConfig=getPlatformAuthConfig(entry.platform);
    if(authConfig?.homeUrl)await safeGoto(verificationSession.page,authConfig.homeUrl);

    let verification;
    try{
      verification=await verifyStableSession(entry.adapter,verificationSession,{...entry.account});
    }catch(error){
      verification={status:'WARNING',reason:error instanceof Error?error.message:String(error)};
    }
    if(verification?.status!=='PASS'){
      await verificationSession.close?.().catch(()=>undefined);
      entry.session=null;
      return reopenManual(entry,`${reasonOf(verification,'The account is not confirmed signed in yet')} Finish the login in the normal browser, then click MARK VERIFIED again.`);
    }

    const verifiedAt=now().toISOString();
    const sessionSecret=await captureAuthorizedSession(verificationSession.context,verifiedAt);
    if(!sessionSecret){
      await verificationSession.close?.().catch(()=>undefined);
      entry.session=null;
      return reopenManual(entry,'OrbitQA could not capture the authenticated browser session. The normal login browser has been reopened; confirm you are still signed in, then click MARK VERIFIED again.');
    }

    const payload={
      id:entry.accountId,
      sessionSecret,
      status:'ready',
      lastVerifiedAt:verifiedAt,
      lastVerificationReason:'Manual browser login confirmed; dedicated account profile and authorized session are saved for this account',
      lastVerificationBrowser:entry.browserLabel,
      lastVerificationDeviceMode:'desktop',
      lastVerificationDeviceProfile:'Desktop 1280x720',
      lastVerificationProxySource:entry.account.proxySource||'none',
    };
    const saved=accountStore.save(payload);
    sessions.delete(id);
    await verificationSession.close?.().catch(()=>undefined);
    entry.session=null;
    return {ok:true,pending:false,reason:payload.lastVerificationReason,account:publicSafe(saved)};
  }

  async function cancel(sessionId){
    const id=String(sessionId||'');
    const entry=sessions.get(id);
    if(!entry)return {cancelled:false};
    sessions.delete(id);
    await closeEntry(entry);
    return {cancelled:true,accountId:entry.accountId};
  }

  function get(sessionId){
    const entry=sessions.get(String(sessionId||''));
    if(!entry)return null;
    return {sessionId:entry.sessionId,accountId:entry.accountId,platform:entry.platform,status:'pending',reason:reasonOf(entry.authResult,'Finish signing in in the normal browser, then click MARK VERIFIED.'),browserLabel:entry.browserLabel,proxySource:entry.account.proxySource||'none',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',openedAt:entry.openedAt};
  }

  async function closeAll(){
    const rows=[...sessions.values()];
    sessions.clear();
    await Promise.all(rows.map(entry=>closeEntry(entry)));
  }

  return {start,complete,cancel,get,closeAll};
}

module.exports={createAccountVerificationManager};
