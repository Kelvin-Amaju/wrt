const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./free-proxy-provider.cjs'); } catch {}

test('parses and deduplicates supported ProxyScrape-style candidates', () => {
  assert.equal(typeof mod.parseProxyScrapeText, 'function');
  const rows = mod.parseProxyScrapeText('http://1.2.3.4:8080\n1.2.3.4:8080\nsocks5://5.6.7.8:1080\nsocks4://9.9.9.9:1080\nbad');
  assert.deepEqual(rows.map((r)=>`${r.protocol}://${r.hostname}:${r.port}`), ['http://1.2.3.4:8080','socks5://5.6.7.8:1080']);
});

test('parses Geonode-style JSON and ignores unsupported or malformed candidates', () => {
  assert.equal(typeof mod.parseGeonodeJson, 'function');
  const rows = mod.parseGeonodeJson({ data:[
    {ip:'10.0.0.1',port:'8000',protocols:['http']},
    {ip:'10.0.0.2',port:'1080',protocols:['socks5']},
    {ip:'10.0.0.3',port:'1080',protocols:['socks4']},
    {ip:'',port:'1',protocols:['http']},
  ]});
  assert.deepEqual(rows.map((r)=>r.protocol), ['http','socks5']);
});

test('fetchFreeProxyCandidates merges successful feeds when another feed fails', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('proxyscrape')) return { ok:true, text:async()=> 'http://1.2.3.4:8080\n' };
    throw new Error('secondary unavailable');
  };
  const result = await mod.fetchFreeProxyCandidates({ fetchImpl, timeoutMs:100 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.sources.some((s)=>s.ok === false), true);
  assert.equal(calls.length >= 2, true);
});

test('candidate fetch enforces the requested validation cap across public sources', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('proxyscrape')) return { ok:true, text:async()=> 'http://1.1.1.1:80\nhttp://2.2.2.2:80\nhttp://3.3.3.3:80' };
    return { ok:true, text:async()=> JSON.stringify({data:[{ip:'4.4.4.4',port:80,protocols:['http']},{ip:'5.5.5.5',port:80,protocols:['http']} ]}) };
  };
  const result = await mod.fetchFreeProxyCandidates({ fetchImpl, limit:3 });
  assert.equal(result.candidates.length, 3);
});
