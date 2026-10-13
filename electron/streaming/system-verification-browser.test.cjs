const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');

const {findSystemBrowserExecutable,createSystemVerificationBrowserLauncher}=require('./system-verification-browser.cjs');

test('finds installed Chrome before Edge on Windows',()=>{
  const env={LOCALAPPDATA:'C:/Users/user/AppData/Local',PROGRAMFILES:'C:/Program Files','PROGRAMFILES(X86)':'C:/Program Files (x86)'};
  const chrome='C:/Users/user/AppData/Local/Google/Chrome/Application/chrome.exe';
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const found=findSystemBrowserExecutable({platform:'win32',env,existsSync:(p)=>p===chrome||p===edge});
  assert.equal(found,chrome);
});

test('launcher opens exact URL in installed browser with selected device window and mobile UA',async()=>{
  const calls=[];
  class Proc extends EventEmitter{kill(){this.killed=true;this.emit('exit',0);}}
  const proc=new Proc();
  const launcher=createSystemVerificationBrowserLauncher({
    platform:'win32',
    env:{LOCALAPPDATA:'C:/Users/user/AppData/Local'},
    existsSync:(p)=>p.endsWith('Google/Chrome/Application/chrome.exe'),
    spawn:(exe,args,opts)=>{calls.push({exe,args,opts});return proc;},
    mkdtempSync:()=> 'C:/Temp/orbitqa-verify-abc',
    rmSync:()=>{},
  });
  const handle=await launcher.open({url:'https://www.deezer.com/en/album/123?x=1',profile:{viewport:{width:412,height:915},userAgent:'Android-UA'}});
  assert.match(calls[0].exe,/chrome\.exe$/i);
  assert.ok(calls[0].args.includes('https://www.deezer.com/en/album/123?x=1'));
  assert.ok(calls[0].args.includes('--window-size=412,915'));
  assert.ok(calls[0].args.includes('--user-agent=Android-UA'));
  let closed=false; handle.onClose(()=>{closed=true;});
  proc.emit('exit',0);
  assert.equal(closed,true);
});

test('streaming verification launcher reuses the supported browser factory so iOS gets WebKit compatibility',async()=>{
  const calls=[];
  const listeners={};
  const page={on:(name,cb)=>{listeners[name]=cb;},bringToFront:async()=>{page.focused=true;}};
  const session={page,browserPolicy:{browserLabel:'iOS WebKit compatibility'},close:async()=>{session.closed=true;}};
  const browserFactory={open:async payload=>{calls.push(payload);return session;}};
  const {createStreamingVerificationBrowserLauncher}=require('./system-verification-browser.cjs');
  const launcher=createStreamingVerificationBrowserLauncher({browserFactory});
  const handle=await launcher.open({url:'https://music.youtube.com/watch?v=abc',deviceMode:'ios',deviceProfile:'iPhone 13'});
  assert.equal(calls[0].workUnit.deviceMode,'ios');
  assert.equal(calls[0].workUnit.deviceProfile,'iPhone 13');
  assert.equal(calls[0].executionMode,'visible');
  assert.equal(handle.browserLabel,'iOS WebKit compatibility');
  let closed=false;handle.onClose(()=>{closed=true;});
  listeners.close();
  assert.equal(closed,true);
  await handle.focus();assert.equal(page.focused,true);
  await handle.close();assert.equal(session.closed,true);
});
