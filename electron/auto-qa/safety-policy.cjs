const AD_PATTERN = /(^|\b)(advertisement|advert|sponsored|promoted|affiliate|adchoices|adsense|doubleclick|smart\s*link|paid\s+promotion)(\b|$)/i;
const VERIFY_PATTERN = /(captcha|recaptcha|hcaptcha|turnstile|verify\s+(?:that\s+)?you\s+are\s+human|human\s+verification|security\s+challenge|anti[- ]?bot)/i;
const SENSITIVE_PATTERN = /(password|passcode|pin\b|one[- ]?time|\botp\b|verification\s*code|card\s*(?:number)?|credit\s*card|debit\s*card|\bcvv\b|\bcvc\b|bank|routing\s*number|account\s*number|social\s*security|national\s*id|passport|government\s*id)/i;
const CONSEQUENTIAL_PATTERN = /(buy\s*now|purchase|checkout|place\s*order|pay\b|payment|subscribe|donate|transfer|send\s+money|delete|remove\s+account|close\s+account|change\s+password|reset\s+password|sign\s*in|log\s*in|login|sign\s*up|register|create\s+account|confirm\s+order|book\s+now|consent|agree\s+(?:to\s+)?(?:terms|marketing)|accept\s+(?:the\s+)?terms)/i;
const SAFE_FIELD_TYPES = new Set(['text', 'search', 'url', 'email', 'textarea']);

function joined(candidate = {}) {
  return [candidate.text, candidate.label, candidate.name, candidate.placeholder, candidate.role, candidate.type, candidate.href, candidate.metadata]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function classifyCandidateText(text) {
  const value = String(text || '');
  return {
    adLike: AD_PATTERN.test(value),
    verification: VERIFY_PATTERN.test(value),
    sensitive: SENSITIVE_PATTERN.test(value),
    consequential: CONSEQUENTIAL_PATTERN.test(value),
  };
}

function isAdLike(candidate) {
  return candidate?.adLike === true || AD_PATTERN.test(joined(candidate));
}

function isVerificationChallenge(candidate) {
  return candidate?.verification === true || VERIFY_PATTERN.test(joined(candidate));
}

function isSensitiveOrConsequential(candidate) {
  const type = String(candidate?.type || '').toLowerCase();
  if (['password', 'file', 'hidden'].includes(type)) return true;
  const text = joined(candidate);
  return SENSITIVE_PATTERN.test(text) || CONSEQUENTIAL_PATTERN.test(text);
}

function isSafeEditableField(candidate) {
  if (!candidate || isAdLike(candidate) || isVerificationChallenge(candidate) || isSensitiveOrConsequential(candidate)) return false;
  const type = String(candidate.type || 'text').toLowerCase();
  return SAFE_FIELD_TYPES.has(type);
}


function isSafeSurveyControl(candidate) {
  if (!candidate || isAdLike(candidate) || isVerificationChallenge(candidate) || isSensitiveOrConsequential(candidate)) return false;
  const type = String(candidate.type || '').toLowerCase();
  return ['radio', 'checkbox', 'select-one', 'select-multiple'].includes(type);
}

function isSafeAction(candidate) {
  if (!candidate || isAdLike(candidate) || isVerificationChallenge(candidate) || isSensitiveOrConsequential(candidate)) return false;
  const role = String(candidate.role || '').toLowerCase();
  const type = String(candidate.type || '').toLowerCase();
  if (type === 'reset') return false;
  if (['button', 'link', 'submit', ''].includes(role) || ['button', 'submit', ''].includes(type)) return true;
  return Boolean(candidate.text || candidate.label);
}

module.exports = {
  classifyCandidateText,
  isAdLike,
  isVerificationChallenge,
  isSensitiveOrConsequential,
  isSafeEditableField,
  isSafeSurveyControl,
  isSafeAction,
};
