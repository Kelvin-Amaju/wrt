const SECRET_KEYS = new Set(['password','sessionSecret','token','cookies','cookie','secret','secretBlob']);
function sanitizeStreamingAccount(record = {}) {
  const out = {};
  for (const [key,value] of Object.entries(record || {})) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = value;
  }
  out.hasPassword = Boolean(record.password || record.hasPassword);
  out.hasSessionSecret = Boolean(record.sessionSecret || record.cookies || record.token || record.hasSessionSecret);
  return out;
}
module.exports = { sanitizeStreamingAccount };
