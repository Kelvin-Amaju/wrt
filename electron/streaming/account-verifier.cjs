const {captureAuthorizedSession}=require('./authorized-session.cjs');
function publicSafe(account){
  if(!account) return null;
  const {password,sessionSecret,...safe}=account;
  return safe;
}
function verificationStatus(result,current='ready'){
  if(result?.status==='NEEDS_VERIFICATION') return 'needs-verification';
  if(result?.status==='FAILED'&&!result?.transient) return 'failed';
  return current||'ready';
}
function requiresManualChallenge(result={}){return Boolean(result?.challenge)||/captcha|mfa|multi[- ]factor|two[- ]factor|verification code|security check|verify you are human|manual verification/i.test(String(result?.reason||''));}
function verificationReason(result,fallback){return String(result?.reason||fallback);}
async function verifyStreamingSavedAccount({accountId,accountStore,adapterRegistry,browserFactory}){
  const account=accountStore?.getInternal?.(String(accountId||''));
  if(!account) return {ok:false,reason:'Saved streaming account was not found'};
  const adapter=adapterRegistry?.get?.(account.platform);
  if(!adapter) return {ok:false,reason:`Streaming platform adapter unavailable: ${account.platform}`};
  if(typeof adapter.authenticate!=='function') return {ok:false,reason:`${account.platform} does not support saved-session verification`};
  // Persistent streaming profiles may hold a valid live login even when the encrypted snapshot is
  // missing or stale. Verification must check the durable profile itself instead of requiring a
  // snapshot before launch.
  if(!browserFactory?.open) return {ok:false,reason:'Streaming browser factory is unavailable'};
  let session;
  try{
    const sessionOnlyAccount={...account,authMode:'session',username:'',password:''};
    session=await browserFactory.open({runId:`stream-account-verify:${account.id}`,workUnit:{workId:`verify:${account.id}`,browserRuntime:account.defaultBrowserRuntime||'chrome-installed',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'},account:sessionOnlyAccount,executionMode:'background',usePersistentProfile:true,geoConsistencyFromProxy:true});
    let auth=await adapter.authenticate({page:session.page,context:session.context,account:sessionOnlyAccount});
    if(auth?.status!=='PASS'&&!auth?.transient&&!requiresManualChallenge(auth)&&account.username&&account.password){
      auth=await adapter.authenticate({page:session.page,context:session.context,account:{...account,authMode:'credentials'}});
    }
    if(auth?.status!=='PASS'){
      const reason=verificationReason(auth,'Account authentication needs attention');
      const updated=accountStore.save({id:account.id,status:verificationStatus(auth,account.status),lastVerifiedAt:auth?.status==='NEEDS_VERIFICATION'?new Date().toISOString():account.lastVerifiedAt,lastVerificationReason:reason});
      return {ok:false,transient:Boolean(auth?.transient),needsVerification:auth?.status==='NEEDS_VERIFICATION',reason,account:publicSafe(updated)};
    }
    const verification=typeof adapter.verifySession==='function' ? await adapter.verifySession({page:session.page,account}) : {status:'PASS'};
    if(verification?.status!=='PASS'){
      const reason=verificationReason(verification,'Authenticated session could not be verified');
      const updated=accountStore.save({id:account.id,status:verificationStatus(verification,account.status),lastVerifiedAt:verification?.status==='NEEDS_VERIFICATION'?new Date().toISOString():account.lastVerifiedAt,lastVerificationReason:reason});
      return {ok:false,transient:Boolean(verification?.transient),needsVerification:verification?.status==='NEEDS_VERIFICATION',reason,account:publicSafe(updated)};
    }
    const verifiedAt=new Date().toISOString();
    const sessionSecret=await captureAuthorizedSession(session.context,verifiedAt);
    const reason='Authorized streaming session verified';
    const savePayload={id:account.id,status:'ready',lastVerifiedAt:verifiedAt,lastVerificationReason:reason};
    if(sessionSecret) savePayload.sessionSecret=sessionSecret;
    const updated=accountStore.save(savePayload);
    return {ok:true,account:publicSafe(updated),reason};
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    const updated=accountStore.save({id:account.id,status:account.status||'ready',lastVerifiedAt:account.lastVerifiedAt,lastVerificationReason:reason});
    return {ok:false,transient:true,reason,account:publicSafe(updated)};
  }finally{await session?.close?.().catch(()=>undefined);}
}
module.exports={verifyStreamingSavedAccount};
