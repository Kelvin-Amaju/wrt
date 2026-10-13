const test=require('node:test');
const assert=require('node:assert/strict');

const {findInstalledChromiumBrowser,resolveAutomationBrowserPolicy,buildAndroidChromeUserAgent}=require('./supported-browser-policy.cjs');

test('supported browser discovery prefers installed Chrome before Edge on Windows',()=>{
  const env={LOCALAPPDATA:'C:/Users/user/AppData/Local',PROGRAMFILES:'C:/Program Files','PROGRAMFILES(X86)':'C:/Program Files (x86)'};
  const chrome='C:/Users/user/AppData/Local/Google/Chrome/Application/chrome.exe';
  const edge='C:/Program Files/Microsoft/Edge/Application/msedge.exe';
  const found=findInstalledChromiumBrowser({platform:'win32',env,existsSync:p=>p===chrome||p===edge});
  assert.equal(found.executablePath,chrome);
  assert.equal(found.browserFamily,'chrome');
  assert.match(found.label,/Google Chrome/i);
});

test('supported browser discovery falls back to Microsoft Edge',()=>{
  const env={PROGRAMFILES:'C:/Program Files'};
  const edge='C:/Program Files/Microsoft/Edge/Application/msedge.exe';
  const found=findInstalledChromiumBrowser({platform:'win32',env,existsSync:p=>p===edge});
  assert.equal(found.executablePath,edge);
  assert.equal(found.browserFamily,'edge');
});

test('automation policy uses installed Chromium browser for desktop, Android and iOS mobile compatibility',()=>{
  const system={browserFamily:'chrome',label:'Google Chrome',executablePath:'C:/Chrome/chrome.exe'};
  const desktop=resolveAutomationBrowserPolicy({deviceMode:'desktop',systemBrowser:system});
  const android=resolveAutomationBrowserPolicy({deviceMode:'android',systemBrowser:system});
  const ios=resolveAutomationBrowserPolicy({deviceMode:'ios',systemBrowser:system});
  assert.deepEqual(desktop,{engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false});
  assert.equal(android.engine,'chromium');
  assert.equal(android.executablePath,'C:/Chrome/chrome.exe');
  assert.match(android.browserLabel,/Chrome.*Android/i);
  assert.equal(ios.engine,'chromium');
  assert.equal(ios.executablePath,'C:/Chrome/chrome.exe');
  assert.equal(ios.compatibilityMode,true);
  assert.match(ios.browserLabel,/Chrome.*iOS.*compatibility/i);
});

test('Android user agent reflects the actual installed Chromium major version',()=>{
  const ua=buildAndroidChromeUserAgent({deviceName:'Pixel 7',browserVersion:'153.0.8012.10'});
  assert.match(ua,/Android/);
  assert.match(ua,/Pixel 7/);
  assert.match(ua,/Chrome\/153\.0\.0\.0/);
  assert.doesNotMatch(ua,/Chrome\/140/);
});

test('runtime Chromium compatibility rejects an outdated installed browser instead of silently using it',()=>{
  const {assertSupportedChromiumVersion}=require('./supported-browser-policy.cjs');
  assert.throws(()=>assertSupportedChromiumVersion('Chrome/120.0.0.0'),/update Google Chrome or Microsoft Edge/i);
  assert.doesNotThrow(()=>assertSupportedChromiumVersion('Chrome/153.0.0.0'));
});
