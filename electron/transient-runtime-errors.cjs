function classifyTransientRuntimeError(value=''){
  const text=String(value?.message||value||'').trim();
  if(!text)return null;
  // Certificate faults are usually the proxy or a local TLS-inspecting product presenting a
  // foreign certificate. Verification is relaxed for proxied sessions, so a certificate error
  // that still surfaces is transient: keep the account and retry the required action.
  if(/ERR_CERT_[A-Z_]+|ERR_SSL_[A-Z_]+|ERR_BAD_SSL_CLIENT_AUTH_CERT|net::ERR_CERT|certificate is not valid|SSL certificate problem/i.test(text))return {kind:'certificate',transient:true,reason:text};
  if(/No such device\.?/i.test(text))return {kind:'player-device-lost',transient:true,playerRecovery:true,reason:text};
  if(/In-flight timeout exceeded/i.test(text))return {kind:'in-flight-timeout',transient:true,playerRecovery:true,reason:text};
  if(/^Timed out\.?$/i.test(text)||/(?:Navigation|page\.goto|page\.reload).*Timeout/i.test(text))return {kind:'page-timeout',transient:true,reason:text};
  if(/ERR_SOCKET_NOT_CONNECTED/i.test(text))return {kind:'socket-not-connected',transient:true,reason:text};
  if(/ERR_CONNECTION_(?:CLOSED|RESET|TIMED_OUT)/i.test(text))return {kind:'connection-interrupted',transient:true,reason:text};
  if(/AbortError:\s*signal is aborted without reason|signal is aborted without reason/i.test(text))return {kind:'internal-abort',transient:true,reason:text};
  return null;
}
function transientRuntimeMessage(issue,{platform='platform'}={}){
  const label=String(platform||'platform').replace(/[-_]+/g,' ');
  if(!issue)return '';
  if(issue.kind==='certificate')return `${label} was served a certificate the browser did not accept (${issue.reason}); OrbitQA keeps the account profile, tolerates the certificate for this session and retries the required action`;
  if(issue.kind==='player-device-lost')return `${label} temporarily lost its playback-device registration; OrbitQA will rebuild the player state and retry the selected content`;
  if(issue.kind==='in-flight-timeout')return `${label} reported a temporary in-flight request timeout; OrbitQA will retry the required action without changing the saved account state`;
  if(issue.kind==='endpoint-resolution-timeout')return `${label} endpoint discovery timed out; OrbitQA will continue through the platform/browser fallback path unless the required action also fails`;
  if(issue.kind==='internal-abort')return `${label} cancelled an internal request; OrbitQA will continue unless the required action also fails`;
  if(issue.kind==='resource-chunk-load')return `${label} web resources did not finish loading; OrbitQA will allow the normal page/action recovery path to retry`;
  return `${label} reported a temporary network/page condition (${issue.reason}); OrbitQA will preserve the account and retry the required action`;
}
module.exports={classifyTransientRuntimeError,transientRuntimeMessage};