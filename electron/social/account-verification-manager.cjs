const {randomUUID}=require('node:crypto');
const {getSocialPlatform}=require('./platforms.cjs');
const {verifySocialSession}=require('./page-inspector.cjs');
const {recoverSocialSessionWithCredentials}=require('./credential-recovery.cjs');
const {captureAuthorizedSession}=require('../streaming/authorized-session.cjs');
async function wait(ms){await new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function createSocialAccountVerificationManager({accountStore,browserFactory,now=()=>new Date()}={}){
  if(!accountStore?.getInternal||!accountStore?.save)throw new Error('Social account store is required');
  if(!browserFactory?.open||!browserFactory?.openManualLogin)throw new Error('Social browser factory is required');
  const sessions=new Map();
  async function closeEntry(entry){await entry?.session?.close?.().catch(()=>undefined);await entry?.manualBrowser?.close?.().catch(()=>undefined);}
  async function start({accountId}={}){
    const account=accountStore.getInternal(String(accountId||''));if(!account)throw new Error('Saved social account was not found');const config=getSocialPlatform(account.platform);if(!config)throw new Error('Unsupported social platform');
    for(const [id,pending] of sessions.entries())if(pending.accountId===account.id){sessions.delete(id);await closeEntry(pending);}
    const sessionId=randomUUID();const verificationAccount={...account};const hasSaved=account.status==='ready'||Boolean(account.sessionSecret);const target=hasSaved?config.homeUrl:config.loginUrl;const profileDir=browserFactory.getAccountProfileDir?.(verificationAccount)||'';
    const manualBrowser=await browserFactory.openManualLogin({account:verificationAccount,url:target,profileToken:sessionId,profileDir,freshProfile:false});
    const entry={sessionId,accountId:account.id,account,config,manualBrowser,manualProfileDir:manualBrowser.profileDir,openedAt:now().toISOString()};sessions.set(sessionId,entry);
    return {sessionId,accountId:account.id,platform:account.platform,status:'pending',reason:hasSaved?`Saved ${config.label} profile opened at the main site. Confirm the correct account is signed in, then click MARK VERIFIED.`:`Sign in to ${config.label} yourself. Complete any CAPTCHA/MFA manually, then click MARK VERIFIED.`,browserLabel:manualBrowser.browserLabel||'Google Chrome / Microsoft Edge',proxySource:account.proxySource||'none',browserRuntime:verificationAccount.defaultBrowserRuntime||'chrome-installed',browserRuntime:account.defaultBrowserRuntime||'chrome-installed',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',openedAt:entry.openedAt};
  }
  async function openCapture(entry){
    const verificationAccount={...entry.account};let last=null;
    for(let attempt=0;attempt<4;attempt++){try{return await browserFactory.open({runId:`social-account-capture:${entry.accountId}:${Date.now()}`,workUnit:{workId:`social-account-capture:${entry.accountId}`,deviceMode:'desktop',deviceProfile:'Desktop 1280x720'},account:verificationAccount,executionMode:'visible',ignoreStoredSession:true,usePersistentProfile:true,profileDirOverride:entry.manualProfileDir,restoreStoredSession:false});}catch(error){last=error;if(attempt<3)await wait(500*(attempt+1));}}
    throw last||new Error('OrbitQA could not reopen the social account profile');
  }
  async function reopen(entry,reason){entry.manualBrowser=await browserFactory.openManualLogin({account:{...entry.account},url:entry.config.loginUrl,profileToken:entry.sessionId,profileDir:entry.manualProfileDir,freshProfile:false});return {ok:false,pending:true,reason};}
  async function complete(sessionId){
    const entry=sessions.get(String(sessionId||''));if(!entry)throw new Error('Social account verification session was not found');await entry.manualBrowser?.close?.().catch(()=>undefined);entry.manualBrowser=null;
    try{
      entry.session=await openCapture(entry);const page=entry.session.page;await page.goto(entry.config.homeUrl,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>undefined);await wait(650);let verified=await verifySocialSession({page,platform:entry.account.platform});if(verified.status!=='PASS'&&entry.account.username&&entry.account.password&&!verified?.challenge){verified=await recoverSocialSessionWithCredentials({page,account:entry.account,interactionMode:'cursor'});}if(verified.status!=='PASS'){await entry.session.close().catch(()=>undefined);entry.session=null;return await reopen(entry,verified.reason||`${entry.config.label} session could not be confirmed`);}
      const sessionSecret=await captureAuthorizedSession(entry.session.context,now().toISOString());const saved=accountStore.save({id:entry.account.id,platform:entry.account.platform,label:entry.account.label,username:entry.account.username||'',proxySource:entry.account.proxySource||'none',status:'ready',lastVerifiedAt:now().toISOString(),lastVerificationReason:verified.reason,lastVerificationBrowser:entry.session.browserPolicy?.browserLabel||'Google Chrome / Microsoft Edge',...(sessionSecret?{sessionSecret}:{})});
      sessions.delete(entry.sessionId);await entry.session.close().catch(()=>undefined);entry.session=null;return {ok:true,account:saved,reason:verified.reason};
    }catch(error){await entry.session?.close?.().catch(()=>undefined);entry.session=null;return await reopen(entry,error instanceof Error?error.message:String(error));}
  }
  async function cancel(sessionId){const entry=sessions.get(String(sessionId||''));if(!entry)return {cancelled:false};sessions.delete(entry.sessionId);await closeEntry(entry);return {cancelled:true,accountId:entry.accountId};}
  async function verifySaved(accountId){
    const account=accountStore.getInternal(String(accountId||''));if(!account)throw new Error('Saved social account was not found');const config=getSocialPlatform(account.platform);if(!config)throw new Error('Unsupported social platform');let session=null;
    try{session=await browserFactory.open({runId:`social-account-check:${account.id}:${Date.now()}`,workUnit:{workId:`social-account-check:${account.id}`,deviceMode:'desktop',deviceProfile:'Desktop 1280x720'},account,executionMode:'visible',usePersistentProfile:true,restoreStoredSession:true});await session.page.goto(config.homeUrl,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>undefined);await wait(650);let result=await verifySocialSession({page:session.page,platform:account.platform});if(result?.transient){await session.page.reload?.({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>undefined);await wait(650);result=await verifySocialSession({page:session.page,platform:account.platform});}if(result.status!=='PASS'&&account.username&&account.password&&!result?.challenge){result=await recoverSocialSessionWithCredentials({page:session.page,account,interactionMode:'cursor'});}const ready=result.status==='PASS';const definitiveLogout=result.status==='NEEDS_VERIFICATION'&&result.definitive===true;const nextStatus=ready?'ready':definitiveLogout?'needs-verification':(account.status||'ready');const refreshedSecret=ready?await captureAuthorizedSession(session.context,now().toISOString()).catch(()=> ''):'';const saved=accountStore.save({id:account.id,platform:account.platform,label:account.label,username:account.username||'',proxySource:account.proxySource||'none',status:nextStatus,lastVerifiedAt:ready?now().toISOString():account.lastVerifiedAt,lastVerificationReason:result.reason,lastVerificationBrowser:session.browserPolicy?.browserLabel||account.lastVerificationBrowser||'',...(refreshedSecret?{sessionSecret:refreshedSecret}:{})});return {ok:ready,transient:Boolean(result?.transient),needsVerification:definitiveLogout,autoRecovered:Boolean(result?.autoRecovered),reason:result.reason,account:saved};}
    finally{await session?.close?.().catch(()=>undefined);}
  }
  async function closeAll(){for(const entry of sessions.values())await closeEntry(entry);sessions.clear();}
  return {start,complete,cancel,verifySaved,closeAll};
}
module.exports={createSocialAccountVerificationManager};
