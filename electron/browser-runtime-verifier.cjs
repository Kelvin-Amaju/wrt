const path = require('node:path');

function looksLikeInstalledGoogleChrome(executablePath) {
  if (!executablePath) return false;
  const normalized = path.win32.normalize(String(executablePath)).toLowerCase();
  return path.win32.basename(normalized) === 'chrome.exe';
}


function looksLikeInstalledBrave(executablePath) {
  if (!executablePath) return false;
  const normalized = path.win32.normalize(String(executablePath)).toLowerCase();
  return path.win32.basename(normalized) === 'brave.exe';
}

function verifyBrowserRuntime(input = {}) {
  const runtimeKind = String(input.runtimeKind || 'chromium-playwright');
  const deviceMode = String(input.deviceMode || 'desktop');
  const browserVersion = input.browserVersion ? String(input.browserVersion) : undefined;
  const executablePath = input.executablePath ? String(input.executablePath) : undefined;
  const base = {
    runtimeKind,
    deviceMode,
    browserVersion,
    executablePath,
    isPhysicalDevice: deviceMode === 'android-avd' || deviceMode === 'real-ios',
    isRealChrome: false,
  };

  if (runtimeKind === 'chrome-installed') {
    const verified = looksLikeInstalledGoogleChrome(executablePath);
    return {
      ...base,
      browserFamily: 'Google Chrome',
      verificationStatus: verified ? 'verified' : 'unverified',
      verificationLabel: verified ? 'REAL INSTALLED GOOGLE CHROME' : 'GOOGLE CHROME RUNTIME UNVERIFIED',
      isRealChrome: verified,
    };
  }
  if (runtimeKind === 'brave-installed') {
    const verified = looksLikeInstalledBrave(executablePath);
    return { ...base, browserFamily:'Brave', verificationStatus:verified?'verified':'unverified', verificationLabel:verified?'REAL INSTALLED BRAVE':'BRAVE RUNTIME UNVERIFIED', isRealChrome:false, isRealBrave:verified };
  }
  if (runtimeKind === 'chromium-playwright') {
    return { ...base, browserFamily: 'Chromium', verificationStatus: 'compatibility', verificationLabel: 'PLAYWRIGHT BUNDLED CHROMIUM' };
  }
  if (runtimeKind === 'firefox-playwright') {
    return { ...base, browserFamily: 'Firefox', verificationStatus: 'compatibility', verificationLabel: 'PLAYWRIGHT FIREFOX' };
  }
  if (runtimeKind === 'webkit-playwright') {
    return { ...base, browserFamily: 'WebKit', verificationStatus: 'compatibility', verificationLabel: 'PLAYWRIGHT WEBKIT' };
  }
  if (runtimeKind === 'android-chrome') {
    const verified = input.packageName === 'com.android.chrome';
    return {
      ...base,
      packageName: input.packageName ? String(input.packageName) : undefined,
      browserFamily: 'Google Chrome Android',
      verificationStatus: verified ? 'verified' : 'unverified',
      verificationLabel: verified ? 'REAL CHROME APP' : 'ANDROID CHROME RUNTIME UNVERIFIED',
      isRealChrome: verified,
      isPhysicalDevice: true,
    };
  }
  if (runtimeKind === 'real-ios-provider') {
    return {
      ...base,
      browserFamily: input.browserFamily ? String(input.browserFamily) : 'Real iOS Provider Browser',
      verificationStatus: 'provider',
      verificationLabel: 'REAL IOS PROVIDER',
      isPhysicalDevice: true,
    };
  }
  return { ...base, browserFamily: 'Unknown', verificationStatus: 'unverified', verificationLabel: 'UNKNOWN BROWSER RUNTIME' };
}

module.exports = { looksLikeInstalledGoogleChrome, looksLikeInstalledBrave, verifyBrowserRuntime };
