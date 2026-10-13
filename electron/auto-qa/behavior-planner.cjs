const { isSafeEditableField, isSafeSurveyControl, isSafeAction, isAdLike } = require('./safety-policy.cjs');

function hashSeed(value) {
  let h = 2166136261;
  const text = String(value || 'orbitqa');
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFromSeed(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(list, rng) { return list?.length ? list[Math.floor(rng() * list.length) % list.length] : null; }

function planBehavior({ analysis = {}, remainingMs = 0, settings = {}, seed = 'orbitqa', deviceMode = 'desktop' }) {
  const rng = rngFromSeed(`${seed}:${analysis.kind}:${Math.floor(remainingMs / 1000)}`);
  const plan = [{ type:'observe', durationMs: settings.readingPace === 'slow' ? 2200 : settings.readingPace === 'fast' ? 700 : 1400 }];
  if (remainingMs < 2500) return plan;

  const addRead = (count = 1) => {
    for (let i = 0; i < count; i += 1) plan.push({ type:'read-scroll', direction:'down', seed:`${seed}:read:${i}`, deviceMode });
  };
  const safeLinks = (analysis.sameOriginLinks || []).filter((item) => !isAdLike(item));
  const articleLinks = safeLinks.filter((item) => item.articleLike);
  const byPageOrder = (items) => [...items].sort((a, b) => Number(a.domOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.domOrder ?? Number.MAX_SAFE_INTEGER));
  const recentArticleLinks = byPageOrder(articleLinks.filter((item) => item.recentLike));
  const datedArticleLinks = [...articleLinks]
    .filter((item) => Number.isFinite(Number(item.publishedTimeMs)))
    .sort((a, b) => Number(b.publishedTimeMs) - Number(a.publishedTimeMs));
  const homeLinks = safeLinks.filter((item) => item.homeLike);
  const readMoreLinks = safeLinks.filter((item) => item.readMoreLike);
  const safeFields = (analysis.editableFields || []).filter(isSafeEditableField);
  const safeSurveyControls = (analysis.editableFields || []).filter(isSafeSurveyControl);
  const safeActions = (analysis.safeActions || []).filter(isSafeAction);
  const preferredSafeActions = (analysis.preferredSafeActions || []).filter(isSafeAction);
  const safeButtonActions = safeActions.filter((item) => String(item.role || '').toLowerCase() !== 'link' && !item.href);
  const preferredButtonActions = preferredSafeActions.filter((item) => String(item.role || '').toLowerCase() !== 'link' && !item.href);
  const enoughForAction = remainingMs >= 5500;
  const enoughForNavigation = remainingMs >= 6500;

  switch (analysis.kind) {
    case 'article':
      addRead(remainingMs >= 20000 ? 2 : 1);
      if (enoughForNavigation && readMoreLinks.length) plan.push({ type:'open-link', candidate:pick(readMoreLinks, rng) });
      else if (enoughForNavigation && homeLinks.length) plan.push({ type:'return-home', candidate:pick(homeLinks, rng) });
      break;
    case 'blog-index':
      addRead(2);
      if (enoughForNavigation && articleLinks.length) {
        const candidate = datedArticleLinks[0] || recentArticleLinks[0] || byPageOrder(articleLinks)[0];
        if (candidate) plan.push({ type:'open-link', candidate });
      }
      break;
    case 'form-tool':
    case 'shortlink':
    case 'downloader':
    case 'generator':
    case 'search-listing':
      addRead(1);
      if (settings.safeFormActions !== false && enoughForAction && safeFields.length && safeActions.length) {
        const urlFields = safeFields.filter((field) => String(field.type || '').toLowerCase() === 'url' || /url|link|website|destination/i.test(`${field.label || ''} ${field.name || ''} ${field.placeholder || ''}`));
        const field = (analysis.kind === 'shortlink' || analysis.kind === 'downloader') && urlFields.length ? urlFields[0] : pick(safeFields, rng);
        const relatedActions = field?.formKey ? safeActions.filter((item) => item.formKey === field.formKey) : [];
        const intentOrder = analysis.kind === 'shortlink' ? ['shorten','submit','generic']
          : analysis.kind === 'downloader' ? ['download','submit','generic']
            : analysis.kind === 'generator' ? ['generate','submit','generic']
              : analysis.kind === 'search-listing' ? ['search','submit','generic'] : ['submit','generic'];
        const pool = relatedActions.length ? relatedActions : safeActions;
        const preferred = intentOrder.map((intent) => pool.find((item) => item.actionIntent === intent)).find(Boolean) || preferredSafeActions.find((item) => pool.includes(item)) || pool[0];
        plan.push({ type:'fill-field', candidate:field });
        plan.push({ type:'activate', candidate:preferred });
      } else if (enoughForAction) {
        plan.push({ type:'no-safe-action' });
      }
      break;
    case 'temp-mail': {
      addRead(1);
      if (enoughForAction && safeActions.length) {
        const order = ['copy','refresh','new-mail','generic'];
        const candidate = order.map((intent) => preferredSafeActions.find((item) => item.actionIntent === intent) || safeActions.find((item) => item.actionIntent === intent)).find(Boolean) || safeActions[0];
        plan.push({ type:'activate', candidate });
      } else if (enoughForAction) plan.push({ type:'no-safe-action' });
      break;
    }
    case 'survey':
      addRead(1);
      if (settings.safeFormActions !== false && enoughForAction && safeActions.length) {
        const field = safeSurveyControls.length ? pick(safeSurveyControls, rng) : pick(safeFields, rng);
        if (field) {
          const relatedActions = field.formKey ? safeActions.filter((item) => item.formKey === field.formKey) : [];
          plan.push({ type:safeSurveyControls.length ? 'choose-survey-control' : 'fill-field', candidate:field, neutralOnly:true });
          plan.push({ type:'activate', candidate:pick(relatedActions.length ? relatedActions : safeActions, rng), neutralOnly:true });
        }
      }
      break;
    case 'landing-redirect':
      addRead(1);
      if (enoughForNavigation && safeLinks.length) plan.push({ type:'open-link', candidate:byPageOrder(safeLinks)[0] });
      else if (enoughForAction && safeActions.length) plan.push({ type:'activate', candidate:preferredSafeActions[0] || safeActions[0] });
      else if (enoughForAction) plan.push({ type:'no-safe-action' });
      break;
    case 'generic':
      addRead(2);
      if (enoughForAction && safeActions.length) {
        const buttonPool = preferredButtonActions.length ? preferredButtonActions : safeButtonActions.length ? safeButtonActions : preferredSafeActions.length ? preferredSafeActions : safeActions;
        plan.push({ type:'activate', candidate:pick(buttonPool, rng) });
      }
      else if (enoughForNavigation && safeLinks.length) plan.push({ type:'open-link', candidate:pick(safeLinks, rng) });
      else if (enoughForAction) plan.push({ type:'no-safe-action' });
      break;
    default:
      addRead(remainingMs >= 8000 ? 1 : 0);
      plan.push({ type:'no-safe-action' });
      break;
  }
  return plan;
}

module.exports = { planBehavior, hashSeed, rngFromSeed };
