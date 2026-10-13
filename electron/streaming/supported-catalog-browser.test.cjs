const test=require('node:test');
const assert=require('node:assert/strict');

const {createSupportedCatalogBrowserLauncher}=require('./supported-catalog-browser.cjs');

test('catalog browser uses the shared installed Chrome/Edge desktop policy',async()=>{
  let launchOptions=null;
  const browser={close:async()=>{}};
  const chromium={launch:async options=>{launchOptions=options;return browser;}};
  const launcher=createSupportedCatalogBrowserLauncher({
    chromium,
    browserPolicyResolver:async()=>({engine:'chromium',browserLabel:'Google Chrome',executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),
  });
  const result=await launcher.launch({headless:true});
  assert.equal(result.browser,browser);
  assert.equal(result.browserPolicy.browserLabel,'Google Chrome');
  assert.equal(launchOptions.executablePath,'C:/Program Files/Google/Chrome/Application/chrome.exe');
  assert.equal(launchOptions.headless,true);
});

test('catalog browser refuses unsupported embedded Chromium fallback',async()=>{
  const launcher=createSupportedCatalogBrowserLauncher({
    chromium:{launch:async()=>{throw new Error('must not launch');}},
    browserPolicyResolver:async()=>{throw new Error('No supported installed Chrome or Edge browser was found');},
  });
  await assert.rejects(()=>launcher.launch(),/No supported installed Chrome or Edge browser was found/);
});
