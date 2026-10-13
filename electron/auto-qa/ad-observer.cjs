async function wait(page, lifetime, ms) {
  if (ms <= 0) return;
  if (lifetime?.wait) return lifetime.wait(ms);
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
}

function safePointNear(rect = {}) {
  const width = Math.max(1, Number(rect.width || 0));
  const height = Math.max(1, Number(rect.height || 0));
  const x = Math.max(6, Number(rect.x || 0) + Math.min(18, width * 0.08));
  const y = Math.max(6, Number(rect.y || 0) + Math.min(18, height * 0.08));
  return { x, y };
}

function adIdentity(ad = {}) {
  if (ad.selectorHint) return `selector:${ad.frameUrl || ''}:${ad.selectorHint}`;
  const rect = ad.rect || {};
  const rounded = [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(Number(value || 0) / 4) * 4).join(':');
  return `geom:${ad.frameUrl || ''}:${rounded}:${String(ad.kind || '')}:${String(ad.text || '').slice(0, 40)}`;
}

function classifyAdType(ad = {}) {
  const rect = ad.rect || {};
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  const text = `${ad.text || ''} ${ad.kind || ''} ${ad.frameUrl || ''}`.toLowerCase();
  const fixed = String(ad.position || '').toLowerCase() === 'fixed' || String(ad.position || '').toLowerCase() === 'sticky';
  const viewportLike = width >= 280 && height >= 300;
  if (fixed && viewportLike) return 'interstitialVignette';
  if (fixed && (height <= 140 || width >= 300)) return 'stickyAnchor';
  if (/sponsored|promoted|native/.test(text) && String(ad.kind || '').toLowerCase() !== 'iframe') return 'nativeSponsored';
  if (String(ad.kind || '').toLowerCase() === 'iframe' || /doubleclick|googlesyndication|adservice|adsystem/.test(text)) return 'iframeNetwork';
  if ((width >= 250 && height <= 160) || /banner/.test(text)) return 'banner';
  return 'unknownAd';
}

function normalizeVisibleAds(ads = []) {
  const deduped = new Map();
  for (const ad of Array.isArray(ads) ? ads : []) {
    if (!ad?.rect || Number(ad.rect.width) <= 1 || Number(ad.rect.height) <= 1) continue;
    const key = adIdentity(ad);
    if (!deduped.has(key)) deduped.set(key, { ...ad, adType: classifyAdType(ad) });
  }
  return [...deduped.values()];
}

function emptyByType() {
  return { banner:0, stickyAnchor:0, interstitialVignette:0, nativeSponsored:0, iframeNetwork:0, unknownAd:0 };
}

async function observeAds({ page, ads = [], indicator = null, mode = 'desktop', lifetime = null, budgetMs = 0, log = () => {} } = {}) {
  const visible = normalizeVisibleAds(ads);
  const byType = emptyByType();
  for (const ad of visible) byType[ad.adType] = (byType[ad.adType] || 0) + 1;
  log(`Visible advertisements detected: ${visible.length}`);
  const labels = {
    banner:'Banner', stickyAnchor:'Sticky/Anchor', interstitialVignette:'Interstitial/Vignette',
    nativeSponsored:'Native/Sponsored', iframeNetwork:'Iframe/Network ad', unknownAd:'Unknown ad format',
  };
  for (const [key, count] of Object.entries(byType)) if (count > 0) log(`Ad type ${labels[key]}: ${count}`);
  if (!visible.length || budgetMs <= 0) {
    log('Advertisement regions observed: 0');
    return { detected:visible.length, observed:0, byType, ads:visible, status:visible.length ? 'partial' : 'none' };
  }
  const cap = Math.min(visible.length, Math.max(1, Math.min(8, Math.floor(Number(budgetMs) / 180) || 1)));
  const perAd = Math.max(140, Math.min(2500, Math.floor(Number(budgetMs) / cap)));
  let observed = 0;
  for (const ad of visible.slice(0, cap)) {
    const remaining = Number(lifetime?.remainingMs?.());
    if (Number.isFinite(remaining) && remaining <= 250) break;
    const point = safePointNear(ad.rect);
    if (indicator?.moveToPoint) await indicator.moveToPoint(page, point, { mode }).catch?.(() => undefined);
    await wait(page, lifetime, perAd);
    ad.observed = true;
    ad.dwellMs = perAd;
    observed += 1;
  }
  log(`Advertisement regions observed: ${observed}`);
  return { detected:visible.length, observed, byType, ads:visible, status:observed === visible.length ? 'pass' : 'partial' };
}

module.exports = { observeAds, safePointNear, classifyAdType, normalizeVisibleAds, adIdentity };
