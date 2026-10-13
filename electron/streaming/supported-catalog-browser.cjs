const {resolveAutomationBrowserPolicy,assertSupportedChromiumVersion}=require('./supported-browser-policy.cjs');
const {buildRuntimePerformanceLaunchPolicy}=require('../qa-runner.cjs');

function createSupportedCatalogBrowserLauncher({chromium,browserPolicyResolver=resolveAutomationBrowserPolicy}={}){
  if(!chromium?.launch) throw new Error('Chromium launcher is required');
  return {
    async launch({headless=true}={}){
      const browserPolicy=await browserPolicyResolver({deviceMode:'desktop'});
      if(browserPolicy?.engine!=='chromium'||!browserPolicy?.executablePath){
        throw new Error('A supported installed Chrome or Edge browser is required for catalog browsing');
      }
      const performancePolicy=buildRuntimePerformanceLaunchPolicy({browserEngine:'chromium'});
      const browser=await chromium.launch({headless:Boolean(headless),executablePath:browserPolicy.executablePath,args:performancePolicy.args});
      try{assertSupportedChromiumVersion(browser.version?.()||'');}catch(error){await browser.close?.().catch(()=>undefined);throw error;}
      return {browser,browserPolicy};
    },
  };
}
module.exports={createSupportedCatalogBrowserLauncher};
