const FIXED = {
  'google-simulated': ['https://www.google.com/', 'Simulated Google'],
  'facebook-simulated': ['https://www.facebook.com/', 'Simulated Facebook'],
  'pinterest-simulated': ['https://www.pinterest.com/', 'Simulated Pinterest'],
};
function resolveSimulatedReferrer(settings = {}) {
  const mode = settings.referrerMode || 'direct';
  if (mode === 'direct') return { mode:'direct', value:undefined, label:'Direct', applicable:true, simulated:false };
  if (FIXED[mode]) return { mode, value:FIXED[mode][0], label:FIXED[mode][1], applicable:true, simulated:true };
  if (mode === 'custom-simulated') {
    const value = String(settings.customReferrer || '').trim();
    let url;
    try { url = new URL(value); } catch { throw new Error('Custom simulated referrer must be a valid https:// URL'); }
    if (url.protocol !== 'https:') throw new Error('Custom simulated referrer must use https://');
    return { mode, value:url.toString(), label:'Simulated Custom', applicable:true, simulated:true };
  }
  return { mode:'direct', value:undefined, label:'Direct', applicable:true, simulated:false };
}
module.exports = { resolveSimulatedReferrer };
