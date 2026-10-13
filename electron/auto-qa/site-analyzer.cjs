const { isAdLike, isVerificationChallenge, isSensitiveOrConsequential, isSafeEditableField, isSafeSurveyControl, isSafeAction } = require('./safety-policy.cjs');

function clampConfidence(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }


function isAdFrameEvidence(frame = {}) {
  const meta = `${frame.url || ''} ${frame.title || ''} ${frame.bodyText || ''}`;
  return /(doubleclick|googlesyndication|googleadservices|adservice|adsystem|adnxs|taboola|outbrain|propellerads|profitableratecpm|advertisement|sponsored|promoted|ads?)/i.test(meta);
}


function inferActionIntent(candidate = {}) {
  if (candidate.actionIntent) return String(candidate.actionIntent);
  const text = [candidate.text, candidate.label, candidate.name, candidate.placeholder].filter(Boolean).join(' ').toLowerCase();
  if (/\b(shorten|short url|create link)\b/.test(text)) return 'shorten';
  if (/\b(download|convert|save)\b/.test(text)) return 'download';
  if (/\b(copy|copy email|copy address)\b/.test(text)) return 'copy';
  if (/\b(refresh|reload|check inbox)\b/.test(text)) return 'refresh';
  if (/\b(get mail|new mail|new email|new address|generate email|change email)\b/.test(text)) return 'new-mail';
  if (/\b(generate|create)\b/.test(text)) return 'generate';
  if (/\b(search|find)\b/.test(text)) return 'search';
  if (/\b(submit|go|check|run|start)\b/.test(text)) return 'submit';
  return 'generic';
}

function classifySiteSnapshot(snapshot = {}) {
  const body = String(snapshot.bodyText || '').toLowerCase();
  const title = String(snapshot.title || '').toLowerCase();
  const links = Array.isArray(snapshot.sameOriginLinks) ? snapshot.sameOriginLinks : [];
  const fields = (Array.isArray(snapshot.editableFields) ? snapshot.editableFields : []).filter((item) => isSafeEditableField(item) || isSafeSurveyControl(item));
  const actions = (Array.isArray(snapshot.actions) ? snapshot.actions : []).filter((item) => isSafeAction(item) && !isAdLike(item) && !(String(item.role || '').toLowerCase() === 'link' && item.sameOrigin === false)).map((item) => ({ ...item, actionIntent: inferActionIntent(item) }));
  const articleLinks = links.filter((link) => link.articleLike && !isAdLike(link) && !isSensitiveOrConsequential(link));
  const textSize = String(snapshot.bodyText || '').length;
  let kind = 'unknown';
  let confidence = 0.35;

  const surveyEvidence = /\b(survey|questionnaire|feedback form|poll)\b/.test(`${title} ${body}`) || Number(snapshot.radioCount || 0) + Number(snapshot.checkboxCount || 0) >= 3;
  const urlLikeFields = fields.filter((field) => String(field.type || '').toLowerCase() === 'url' || /url|link|website|destination|media/i.test(`${field.label || ''} ${field.name || ''} ${field.placeholder || ''}`));
  const shortlinkEvidence = fields.length > 0 && (/\b(url shortener|shorten (?:a |your )?(?:long )?url|short link|link shortener)\b/.test(`${title} ${body}`) || (urlLikeFields.length > 0 && actions.some((item) => item.actionIntent === 'shorten')));
  const tempMailEvidence = /\b(temp(?:orary)? mail|temporary e-?mail|disposable e-?mail|throwaway e-?mail|inbox)\b/.test(`${title} ${body}`) && actions.some((item) => ['copy','refresh','new-mail'].includes(item.actionIntent));
  const generatorEvidence = /\b(generate|generator|create (?:an |a )?(?:image|text|video|name|content)|prompt)\b/.test(`${title} ${body}`) && fields.length > 0;
  const downloaderEvidence = fields.length > 0 && (/\b(download|downloader|save video|paste (?:a )?url|video url|media url)\b/.test(`${title} ${body}`) || (urlLikeFields.length > 0 && actions.some((item) => item.actionIntent === 'download')));
  const searchEvidence = fields.some((field) => String(field.type).toLowerCase() === 'search' || /search/i.test(`${field.label || ''} ${field.placeholder || ''}`));
  const articleCount = Number(snapshot.articleCount || 0);
  const blogIndexEvidence = articleLinks.length >= 2 || articleCount >= 2 || /\b(latest posts?|recent posts?|blog|articles|latest news|headlines)\b/.test(`${title} ${body}`) && links.length >= 2;
  const articleEvidence = articleCount === 1 && textSize >= 1200;
  const formToolEvidence = Number(snapshot.formCount || 0) > 0 && fields.length > 0 && actions.length > 0;
  const finalUrl = String(snapshot.url || '').toLowerCase();
  const redirectUrlEvidence = /(redirect|tracking|track|click|cpm|ratecpm|adserver|adnetwork|profitableratecpm)/i.test(finalUrl);
  const landingRedirectEvidence = ((links.length > 0 && /\b(continue|proceed|destination|redirect|next page|visit site|go to)\b/.test(`${title} ${body}`)) || redirectUrlEvidence) && !articleEvidence && !blogIndexEvidence && !formToolEvidence;

  if (surveyEvidence && Number(snapshot.formCount || 0) > 0) { kind = 'survey'; confidence = 0.9; }
  else if (shortlinkEvidence) { kind = 'shortlink'; confidence = 0.93; }
  else if (tempMailEvidence) { kind = 'temp-mail'; confidence = 0.92; }
  else if (downloaderEvidence) { kind = 'downloader'; confidence = 0.92; }
  else if (generatorEvidence) { kind = 'generator'; confidence = 0.9; }
  else if (blogIndexEvidence) { kind = 'blog-index'; confidence = 0.86; }
  else if (articleEvidence) { kind = 'article'; confidence = 0.86; }
  else if (searchEvidence && links.length >= 4) { kind = 'search-listing'; confidence = 0.78; }
  else if (formToolEvidence) { kind = 'form-tool'; confidence = 0.78; }
  else if (landingRedirectEvidence) { kind = 'landing-redirect'; confidence = 0.74; }
  else if ((snapshot.mainPresent || Number(snapshot.headingCount || 0) > 0) && (textSize >= 120 || links.length > 0)) { kind = 'generic'; confidence = 0.62; }

  const riskFlags = Array.isArray(snapshot.riskFlags) ? [...snapshot.riskFlags] : [];
  for (const item of [...(snapshot.actions || []), ...(snapshot.editableFields || [])]) {
    if (isVerificationChallenge(item) && !riskFlags.includes('verification-challenge')) riskFlags.push('verification-challenge');
    if (isSensitiveOrConsequential(item) && !riskFlags.includes('protected-action')) riskFlags.push('protected-action');
  }

  const preferredSafeActions = actions.filter((item) => ['copy','refresh','new-mail','shorten','download','generate','search','submit'].includes(item.actionIntent));

  return {
    kind,
    confidence: clampConfidence(confidence),
    title: String(snapshot.title || ''),
    finalUrl: String(snapshot.url || ''),
    sameOriginLinks: links.filter((link) => !isAdLike(link) && !isVerificationChallenge(link) && !isSensitiveOrConsequential(link)),
    editableFields: fields,
    safeActions: actions,
    preferredSafeActions,
    blockers: Array.isArray(snapshot.blockers) ? snapshot.blockers : [],
    adLikeElements: Array.isArray(snapshot.adLikeElements) ? snapshot.adLikeElements : [],
    riskFlags,
  };
}

async function analyzeSite(page) {
  const snapshot = await page.evaluate(() => {
    const indicatorSelector = '[data-orbitqa-indicator-root],#orbitqa-interaction-indicator';
    let tokenCounter = 0;
    const visible = (el) => {
      if (!(el instanceof Element) || el.matches(indicatorSelector) || el.closest(indicatorSelector)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 1 && rect.height > 1;
    };
    const tokenFor = (el) => {
      const existing = el.getAttribute('data-orbitqa-autoqa-token');
      if (existing) return `[data-orbitqa-autoqa-token="${existing}"]`;
      tokenCounter += 1;
      const token = `aq-${Date.now().toString(36)}-${tokenCounter}`;
      el.setAttribute('data-orbitqa-autoqa-token', token);
      return `[data-orbitqa-autoqa-token="${token}"]`;
    };
    const textOf = (el) => String(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
    const adPattern = /(^|\b)(advertisement|advert|sponsored|promoted|affiliate|adchoices|adsense|doubleclick|smart\s*link|paid\s+promotion)(\b|$)/i;
    const verificationPattern = /(captcha|recaptcha|hcaptcha|turnstile|verify\s+(?:that\s+)?you\s+are\s+human|human\s+verification|security\s+challenge)/i;
    const current = new URL(location.href);
    const sameOriginLinks = [];
    const adLikeElements = [];
    for (const [domOrder, a] of Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0, 250).entries()) {
      let href = '';
      try { href = new URL(a.href, location.href).href; } catch { continue; }
      const text = textOf(a).slice(0, 220);
      const meta = `${text} ${a.id || ''} ${a.className || ''} ${a.getAttribute('rel') || ''}`;
      const adLike = adPattern.test(meta);
      const selectorHint = tokenFor(a);
      if (adLike) { const r=a.getBoundingClientRect(); adLikeElements.push({ selectorHint, text, href, kind:'link', position:getComputedStyle(a).position, rect:{x:r.left,y:r.top,width:r.width,height:r.height} }); }
      try {
        const u = new URL(href);
        if (u.origin !== current.origin) continue;
      } catch { continue; }
      const contentCard = a.closest('article,[class*="post" i],[class*="story" i],[class*="article" i],[class*="news" i],[class*="headline" i]');
      const cardText = textOf(contentCard || a).slice(0, 420);
      const articleLike = Boolean(contentCard) || /\b(post|article|story|news|read more|continue reading|latest|headline)\b/i.test(meta) || /\/\d{4}\/\d{1,2}\//.test(href);
      const recentContainer = a.closest('[class*="latest" i],[class*="recent" i],[id*="latest" i],[id*="recent" i]');
      const timeEl = contentCard?.querySelector?.('time[datetime]') || a.closest('article')?.querySelector?.('time[datetime]');
      const publishedTimeMs = timeEl?.getAttribute?.('datetime') ? Date.parse(timeEl.getAttribute('datetime')) : Number.NaN;
      const recentLike = /\b(latest|recent|new|today|just published|minutes? ago|hours? ago)\b/i.test(`${meta} ${cardText}`) || Boolean(recentContainer);
      const readMoreLike = /\b(read more|continue reading|next(?: article| post| story)?|more stories|older posts?)\b/i.test(meta);
      const homeLike = /^(home|homepage)$/i.test(text) || a.getAttribute('rel') === 'home' || href === current.origin + '/' || a.querySelector('img[alt*="logo" i]');
      sameOriginLinks.push({ selectorHint, text, href, role:'link', articleLike, recentLike, readMoreLike, homeLike, domOrder, publishedTimeMs:Number.isFinite(publishedTimeMs) ? publishedTimeMs : null });
    }

    const seenAdSelectors = new Set(adLikeElements.map((item) => item.selectorHint));
    const adCandidates = Array.from(document.querySelectorAll('iframe,[id],[class],[data-ad],[data-ad-slot],[aria-label]')).slice(0, 1800);
    for (const el of adCandidates) {
      if (!visible(el)) continue;
      const meta = `${el.id || ''} ${el.className || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('data-ad') || ''} ${el.getAttribute?.('data-ad-slot') || ''} ${el.getAttribute?.('src') || ''}`;
      const iframeAd = el.tagName === 'IFRAME' && /(doubleclick|googlesyndication|adservice|adsystem|advert|sponsor|banner)/i.test(meta);
      const semanticAd = /(^|[\s_-])(ad|ads|advert|advertisement|sponsored|promo|banner)([\s_-]|$)/i.test(meta);
      if (!iframeAd && !semanticAd) continue;
      const selectorHint = tokenFor(el);
      if (seenAdSelectors.has(selectorHint)) continue;
      seenAdSelectors.add(selectorHint);
      const rect = el.getBoundingClientRect();
      adLikeElements.push({ selectorHint, text:textOf(el).slice(0,220), href:'', kind:el.tagName === 'IFRAME' ? 'iframe' : 'banner', position:getComputedStyle(el).position, rect:{x:rect.left,y:rect.top,width:rect.width,height:rect.height} });
    }

    const editableFields = [];
    for (const el of Array.from(document.querySelectorAll('input,textarea,select')).filter(visible).slice(0, 120)) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'textarea' ? 'textarea' : tag === 'select' ? String(el.multiple ? 'select-multiple' : 'select-one') : String(el.getAttribute('type') || 'text').toLowerCase();
      const labelEl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label');
      const form = el.closest('form');
      const formKey = form ? tokenFor(form) : '';
      const label = textOf(labelEl || el).slice(0, 180);
      const options = tag === 'select' ? Array.from(el.options || []).slice(0, 30).map((option, index) => ({ index, text:textOf(option).slice(0, 120), disabled:Boolean(option.disabled), value:String(option.value || '') })) : [];
      const preferredOption = options.find((option, index) => index > 0 && !option.disabled && option.value && !/select|choose|please/i.test(option.text)) || options.find((option) => !option.disabled && option.value && !/select|choose|please/i.test(option.text));
      editableFields.push({ selectorHint: tokenFor(el), type, name:String(el.getAttribute('name') || ''), label, placeholder:String(el.getAttribute('placeholder') || ''), role:String(el.getAttribute('role') || ''), formKey, options, preferredOptionIndex:preferredOption?.index });
    }

    const actions = [];
    for (const el of Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a[href]')).filter(visible).slice(0, 250)) {
      const text = textOf(el).slice(0, 180);
      const href = el.tagName === 'A' ? String(el.href || '') : '';
      const form = el.closest('form');
      const formKey = form ? tokenFor(form) : '';
      let sameOrigin = true;
      if (href) { try { sameOrigin = new URL(href, location.href).origin === current.origin; } catch { sameOrigin = false; } }
      const actionMeta = `${text} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase();
      const actionIntent = /\b(shorten|short url|create link)\b/.test(actionMeta) ? 'shorten'
        : /\b(download|convert|save)\b/.test(actionMeta) ? 'download'
          : /\b(copy|copy email|copy address)\b/.test(actionMeta) ? 'copy'
            : /\b(refresh|reload|check inbox)\b/.test(actionMeta) ? 'refresh'
              : /\b(get mail|new mail|new email|new address|generate email|change email)\b/.test(actionMeta) ? 'new-mail'
                : /\b(generate|create)\b/.test(actionMeta) ? 'generate'
                  : /\b(search|find)\b/.test(actionMeta) ? 'search'
                    : /\b(submit|go|check|run|start)\b/.test(actionMeta) ? 'submit' : 'generic';
      actions.push({ selectorHint: tokenFor(el), text, href, sameOrigin, formKey, role: el.tagName === 'A' ? 'link' : String(el.getAttribute('role') || 'button'), type:String(el.getAttribute('type') || ''), actionIntent });
    }

    const blockers = [];
    for (const el of Array.from(document.querySelectorAll('[role="dialog"],dialog,[aria-modal="true"],.modal,.popup,.overlay')).filter(visible).slice(0, 40)) {
      const text = textOf(el).slice(0, 500);
      blockers.push({ kind: verificationPattern.test(text) ? 'verification' : adPattern.test(text) ? 'ad' : 'overlay', selectorHint: tokenFor(el), text });
    }

    const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
    const riskFlags = [];
    if (verificationPattern.test(bodyText)) riskFlags.push('verification-challenge');
    return {
      title: document.title || '', url: location.href, bodyText,
      articleCount: document.querySelectorAll('article').length,
      headingCount: document.querySelectorAll('h1,h2,h3').length,
      mainPresent: Boolean(document.querySelector('main,[role="main"],article')),
      formCount: document.forms?.length || document.querySelectorAll('form').length,
      radioCount: document.querySelectorAll('input[type="radio"]').length,
      checkboxCount: document.querySelectorAll('input[type="checkbox"]').length,
      selectCount: document.querySelectorAll('select').length,
      sameOriginLinks, editableFields, actions, blockers, adLikeElements, riskFlags,
    };
  });

  // Inspect child frames independently. Playwright can evaluate inside a frame
  // even when the page origin differs, which lets OrbitQA recognize network ads
  // without clicking or dispatching hover events into the advertisement.
  if (typeof page.frames === 'function') {
    const frames = page.frames();
    for (let index = 1; index < frames.length; index += 1) {
      const frame = frames[index];
      try {
        const frameMeta = await frame.evaluate(() => ({
          title: document.title || '',
          bodyText: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        }));
        const evidence = { url: typeof frame.url === 'function' ? frame.url() : '', ...frameMeta };
        if (!isAdFrameEvidence(evidence)) continue;
        let rect = { x:0, y:0, width:1, height:1 };
        try {
          const element = await frame.frameElement();
          const box = await element.boundingBox();
          if (box) rect = box;
          var framePosition = await element.evaluate((el) => getComputedStyle(el).position).catch(() => '');
        } catch {}
        snapshot.adLikeElements.push({
          selectorHint:`frame:${index}`,
          text:`${frameMeta.title || ''} ${frameMeta.bodyText || ''}`.trim().slice(0,220),
          href:evidence.url,
          kind:'iframe',
          position:typeof framePosition === 'string' ? framePosition : '',
          rect,
        });
      } catch {}
    }
  }
  return classifySiteSnapshot(snapshot);
}

module.exports = { analyzeSite, classifySiteSnapshot, inferActionIntent, isAdFrameEvidence };
