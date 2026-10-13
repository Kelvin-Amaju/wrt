function normalizeCountry(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return raw.slice(0, 64);
}

function createIpCountryResolver({ lookup, concurrency = 1 } = {}) {
  if (typeof lookup !== 'function') throw new Error('IP country lookup function is required');
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < limit && queue.length > 0) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => lookup(item.ip))
        .then((country) => normalizeCountry(country))
        .catch(() => 'Unknown')
        .then((country) => {
          cache.set(item.ip, country);
          pending.delete(item.ip);
          item.resolve(country);
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const resolve = (ip) => {
    const key = String(ip || '').trim();
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key);
    const promise = new Promise((resolvePromise) => {
      queue.push({ ip:key, resolve:resolvePromise });
      pump();
    });
    pending.set(key, promise);
    return promise;
  };

  return {
    resolve,
    getCached(ip) { return cache.get(String(ip || '').trim()); },
    seed(ip, country) { cache.set(String(ip || '').trim(), normalizeCountry(country)); },
    snapshot() { return Object.fromEntries(cache); },
  };
}

module.exports = { createIpCountryResolver, normalizeCountry };
