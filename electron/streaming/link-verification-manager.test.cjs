const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');

const {createLinkVerificationManager}=require('./link-verification-manager.cjs');

class FakeWebContents{
  constructor(){this.userAgent='';this.loaded=[];}
  setUserAgent(value){this.userAgent=value;}
}
class FakeWindow extends EventEmitter{
  static instances=[];
  constructor(options){super();this.options=options;this.webContents=new FakeWebContents();this.destroyed=false;this.focused=false;FakeWindow.instances.push(this);}
  async loadURL(url){this.webContents.loaded.push(url);}
  isDestroyed(){return this.destroyed;}
  focus(){this.focused=true;}
  destroy(){this.destroyed=true;this.emit('closed');}
}

function resolver(mode,name){
  const map={
    desktop:{viewport:{width:1280,height:720},userAgent:null},
    android:{viewport:{width:412,height:915},userAgent:'Android-UA'},
    ios:{viewport:{width:390,height:844},userAgent:'iPhone-UA'},
  };
  return map[mode]||map.desktop;
}

test('verification window opens the exact URL with selected device profile and refuses close while pending',async()=>{
  FakeWindow.instances=[];
  const manager=createLinkVerificationManager({BrowserWindow:FakeWindow,deviceProfileResolver:resolver});
  const started=await manager.start({targetKey:'collection:c1',url:'https://music.youtube.com/watch?v=abc&si=keep',deviceMode:'android',deviceProfile:'Pixel 7'});
  assert.ok(started.sessionId);
  const win=FakeWindow.instances[0];
  assert.deepEqual(win.webContents.loaded,['https://music.youtube.com/watch?v=abc&si=keep']);
  assert.equal(win.webContents.userAgent,'Android-UA');
  assert.ok(win.options.width>=412);
  assert.ok(win.options.height>=700);
  let prevented=false;
  win.emit('close',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(win.destroyed,false);
  assert.equal(win.focused,true);
});

test('starting the same target focuses the existing verification window instead of opening another',async()=>{
  FakeWindow.instances=[];
  const manager=createLinkVerificationManager({BrowserWindow:FakeWindow,deviceProfileResolver:resolver});
  const first=await manager.start({targetKey:'track:c1:t1',url:'https://example.com/song',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'});
  const second=await manager.start({targetKey:'track:c1:t1',url:'https://example.com/song',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'});
  assert.equal(first.sessionId,second.sessionId);
  assert.equal(FakeWindow.instances.length,1);
  assert.equal(FakeWindow.instances[0].focused,true);
});

test('complete unlocks and closes the verification window and returns verification metadata',async()=>{
  FakeWindow.instances=[];
  const manager=createLinkVerificationManager({BrowserWindow:FakeWindow,deviceProfileResolver:resolver,now:()=>new Date('2026-09-18T12:00:00.000Z')});
  const started=await manager.start({targetKey:'collection:c2',url:'https://tidal.com/album/1',deviceMode:'ios',deviceProfile:'iPhone 13'});
  const result=await manager.complete(started.sessionId);
  assert.equal(result.status,'verified');
  assert.equal(result.verifiedAt,'2026-09-18T12:00:00.000Z');
  assert.equal(result.verifiedUrl,'https://tidal.com/album/1');
  assert.equal(result.verifiedDeviceMode,'ios');
  assert.equal(result.verifiedDeviceProfile,'iPhone 13');
  assert.equal(FakeWindow.instances[0].destroyed,true);
});

test('verification prefers supported system browser launcher over Electron BrowserWindow',async()=>{
  FakeWindow.instances=[];
  const opens=[];
  const handle={onClose(){},focus(){this.focused=true;},close(){this.closed=true;}};
  const verificationBrowserLauncher={open:async(payload)=>{opens.push(payload);return handle;}};
  const manager=createLinkVerificationManager({BrowserWindow:FakeWindow,deviceProfileResolver:resolver,verificationBrowserLauncher});
  const started=await manager.start({targetKey:'collection:deezer1',url:'https://www.deezer.com/en/album/123',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'});
  assert.ok(started.sessionId);
  assert.equal(opens.length,1);
  assert.equal(opens[0].url,'https://www.deezer.com/en/album/123');
  assert.equal(FakeWindow.instances.length,0);
});

test('system verification browser is reopened if user closes it before MARK VERIFIED',async()=>{
  const callbacks=[];
  const handles=[];
  const verificationBrowserLauncher={open:async()=>{
    const index=handles.length;
    const handle={onClose(cb){callbacks[index]=cb;},focus(){},close(){this.closed=true;}};
    handles.push(handle); return handle;
  }};
  const manager=createLinkVerificationManager({BrowserWindow:FakeWindow,deviceProfileResolver:resolver,verificationBrowserLauncher,reopenDelayMs:0});
  const started=await manager.start({targetKey:'collection:c3',url:'https://www.deezer.com/en/album/456',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'});
  assert.equal(handles.length,1);
  callbacks[0]();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(handles.length,2);
  const result=await manager.complete(started.sessionId);
  assert.equal(result.status,'verified');
  assert.equal(handles[1].closed,true);
});

test('does not fall back to unsupported Electron when configured supported-browser launcher fails',async()=>{
  FakeWindow.instances=[];
  const manager=createLinkVerificationManager({
    BrowserWindow:FakeWindow,
    deviceProfileResolver:resolver,
    verificationBrowserLauncher:{open:async()=>{throw new Error('Supported Chrome/Edge could not start');}},
  });
  await assert.rejects(()=>manager.start({targetKey:'collection:strict',url:'https://www.deezer.com/album/1',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'}),/Supported Chrome\/Edge could not start/);
  assert.equal(FakeWindow.instances.length,0);
});
