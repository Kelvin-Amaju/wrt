const { profileForCountry } = require('./social/geo-profile.cjs');
const { buildAndroidChromeUserAgent } = require('./streaming/supported-browser-policy.cjs');

function clean(value){return String(value ?? '').trim();}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}

function resolveProxyGeo(allocation = {}, fallback = {}) {
  const countryCode = clean(allocation.countryCode || fallback.countryCode).toUpperCase();
  const countryProfile = countryCode ? profileForCountry(countryCode) : null;
  const timezoneId = clean(allocation.timezoneId || countryProfile?.timezoneId || fallback.timezoneId);
  const locale = clean(allocation.locale || countryProfile?.locale || fallback.locale || '');
  const languageHeader = clean(allocation.languageHeader || countryProfile?.languageHeader || fallback.languageHeader || (locale ? `${locale},en;q=0.8` : ''));
  const latitude = finite(allocation.latitude ?? fallback.latitude);
  const longitude = finite(allocation.longitude ?? fallback.longitude);
  const city = clean(allocation.city || fallback.city);
  const region = clean(allocation.region || fallback.region);
  const country = clean(allocation.country || fallback.country);
  return {
    countryCode,
    country,
    region,
    city,
    timezoneId,
    locale,
    languageHeader,
    latitude,
    longitude,
    hasCoordinates: latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180,
  };
}

function buildConsistentWorkerContext({
  profile = {},
  deviceMode = 'desktop',
  browserEngine = 'chromium',
  browserVersion = '',
  allocation = null,
  fallbackLocale = '',
  fallbackTimezoneId = '',
  base = {},
  exposeProxyGeolocation = false,
} = {}) {
  const geo = resolveProxyGeo(allocation || {}, { locale:fallbackLocale, timezoneId:fallbackTimezoneId });
  const options = {
    ...base,
    ...(profile.viewport ? { viewport:profile.viewport } : {}),
    ...(profile.screen ? { screen:profile.screen } : profile.viewport ? { screen:profile.viewport } : {}),
    ...(Number.isFinite(Number(profile.deviceScaleFactor)) ? { deviceScaleFactor:Number(profile.deviceScaleFactor) } : {}),
    ...(typeof profile.isMobile === 'boolean' ? { isMobile:profile.isMobile } : {}),
    ...(typeof profile.hasTouch === 'boolean' ? { hasTouch:profile.hasTouch } : {}),
    ...(geo.locale || fallbackLocale ? {locale:geo.locale || fallbackLocale} : {}),
    permissions:Array.isArray(base.permissions) ? [...base.permissions] : [],
    serviceWorkers:base.serviceWorkers || 'allow',
    extraHTTPHeaders:{...(base.extraHTTPHeaders || {}), ...(geo.languageHeader ? {'Accept-Language':geo.languageHeader} : {})},
    ...(geo.timezoneId ? { timezoneId:geo.timezoneId } : {}),
  };

  // Android compatibility can be represented coherently in Chromium using the selected
  // viewport/touch/DPR and an Android Chromium UA aligned to the installed browser major.
  // iOS compatibility in installed Chromium deliberately remains labelled compatibility mode;
  // OrbitQA does not forge a physical iPhone/Safari GPU/OS runtime.
  if (deviceMode === 'android' || deviceMode === 'android-emulation') {
    options.userAgent = clean(profile.userAgent) || buildAndroidChromeUserAgent({
      deviceName:profile.deviceName || 'Android',
      androidVersion:profile.androidVersion || '14',
      browserVersion,
    });
  } else if (browserEngine === 'webkit' && clean(profile.userAgent)) {
    options.userAgent = clean(profile.userAgent);
  } else if (deviceMode === 'ios-emulation' && clean(profile.userAgent)) {
    options.userAgent = clean(profile.userAgent);
  }

  if (exposeProxyGeolocation && geo.hasCoordinates) {
    options.geolocation = { latitude:geo.latitude, longitude:geo.longitude, accuracy:Math.max(20, finite(allocation?.geoAccuracyMeters) || 5000) };
    if (!options.permissions.includes('geolocation')) options.permissions.push('geolocation');
  }

  return { options, geo };
}

function validateWorkerContext({ profile = {}, deviceMode = 'desktop', contextOptions = {}, allocation = null, compatibilityMode = false } = {}) {
  const issues=[];
  const warnings=[];
  const mobile = ['android','android-emulation','ios','ios-emulation'].includes(String(deviceMode));
  if (mobile) {
    if (!contextOptions.viewport || !contextOptions.screen) issues.push('mobile viewport/screen missing');
    if (contextOptions.deviceScaleFactor == null) issues.push('mobile DPR missing');
    if (contextOptions.hasTouch !== true) issues.push('mobile touch capability missing');
    if (contextOptions.isMobile !== true) warnings.push('mobile profile is not marked isMobile');
  }
  if (allocation) {
    if (!clean(allocation.countryCode)) issues.push('proxy country metadata missing');
    if (!clean(contextOptions.timezoneId)) issues.push('proxy timezone context missing');
    if (!clean(contextOptions.locale)) issues.push('proxy locale context missing');
    if (!clean(contextOptions.extraHTTPHeaders?.['Accept-Language'])) issues.push('proxy language header missing');
  }
  if ((deviceMode === 'android' || deviceMode === 'android-emulation') && !/Android/i.test(clean(contextOptions.userAgent))) {
    (compatibilityMode ? warnings : issues).push('Android compatibility runtime retains the installed browser user agent');
  }
  if (deviceMode === 'ios' && !/iPhone|iPad/i.test(clean(contextOptions.userAgent))) warnings.push('iOS compatibility user agent mismatch');
  return { ok:issues.length===0, issues, warnings, status:issues.length?'fail':warnings.length?'warning':'pass' };
}

module.exports={resolveProxyGeo,buildConsistentWorkerContext,validateWorkerContext};
