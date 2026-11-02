const test=require('node:test');
const assert=require('node:assert');
const { isCertificateError, certificateErrorCode, certificateLaunchArgs, certificateContextOptions, describeCertificateError, attachCertificateDiagnostics }=require('./streaming-certificate-policy.cjs');
const { classifyTransientRuntimeError, transientRuntimeMessage }=require('../transient-runtime-errors.cjs');

test('recognises the reported certificate failure',()=>{
  assert.equal(isCertificateError('Failed to load resource: net::ERR_CERT_COMMON_NAME_INVALID'),true);
  assert.equal(certificateErrorCode('Failed to load resource: net::ERR_CERT_COMMON_NAME_INVALID'),'ERR_CERT_COMMON_NAME_INVALID');
});

test('recognises authority, date and protocol failures',()=>{
  for(const code of ['ERR_CERT_AUTHORITY_INVALID','ERR_CERT_DATE_INVALID','ERR_SSL_PROTOCOL_ERROR','ERR_CERT_REVOKED']){
    assert.equal(isCertificateError(`net::${code}`),true,code);
  }
});

test('ignores non-certificate network failures',()=>{
  assert.equal(isCertificateError('net::ERR_CONNECTION_RESET'),false);
  assert.equal(isCertificateError('net::ERR_SOCKET_NOT_CONNECTED'),false);
  assert.equal(isCertificateError(''),false);
  assert.equal(isCertificateError(undefined),false);
});

test('relaxes verification only for proxied sessions',()=>{
  assert.deepEqual(certificateLaunchArgs({proxyRequired:true}),['--ignore-certificate-errors']);
  assert.deepEqual(certificateLaunchArgs({proxyRequired:false}),[]);
  assert.deepEqual(certificateLaunchArgs(),[]);
});

test('always sets the per-request context option',()=>{
  assert.deepEqual(certificateContextOptions(),{ignoreHTTPSErrors:true});
});

test('describes the failure with an actionable hint',()=>{
  assert.match(describeCertificateError('net::ERR_CERT_COMMON_NAME_INVALID'),/ERR_CERT_COMMON_NAME_INVALID/);
  assert.match(describeCertificateError('net::ERR_CERT_COMMON_NAME_INVALID'),/different hostname/);
  assert.match(describeCertificateError('unknown'),/could not verify/);
});

test('certificate faults are transient and retryable',()=>{
  const issue=classifyTransientRuntimeError('net::ERR_CERT_COMMON_NAME_INVALID');
  assert.equal(issue.kind,'certificate');
  assert.equal(issue.transient,true);
  assert.match(transientRuntimeMessage(issue,{platform:'spotify'}),/tolerates the certificate/);
});

test('certificate classification precedes connection classification',()=>{
  assert.equal(classifyTransientRuntimeError('net::ERR_CONNECTION_CLOSED').kind,'connection-interrupted');
});

test('diagnostics are inert without a CDP-capable context',async()=>{
  const diagnostics=await attachCertificateDiagnostics({context:{},page:{}});
  assert.deepEqual(diagnostics.snapshot(),[]);
  assert.doesNotThrow(()=>diagnostics.detach());
});

test('diagnostics collect and de-duplicate protocol events',async()=>{
  let handler=null;
  const context={newCDPSession:async()=>({on:(name,fn)=>{if(name==='Security.certificateError')handler=fn;},off:()=>{},send:async()=>undefined,detach:async()=>undefined})};
  const diagnostics=await attachCertificateDiagnostics({context,page:{},workId:'w1'});
  handler({errorType:'ERR_CERT_COMMON_NAME_INVALID',requestURL:'https://open.spotify.com/track/x'});
  handler({errorType:'ERR_CERT_COMMON_NAME_INVALID',requestURL:'https://open.spotify.com/track/x'});
  handler({errorType:'ERR_CERT_AUTHORITY_INVALID',requestURL:'https://open.spotifycdn.com/a.js'});
  assert.equal(diagnostics.snapshot().length,2);
  assert.equal(diagnostics.snapshot()[0].workId,'w1');
  diagnostics.detach();
});