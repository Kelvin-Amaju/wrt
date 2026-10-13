const test = require('node:test');
const assert = require('node:assert/strict');
const { createProxyPoolService } = require('./proxy-pool-service.cjs');

function iso(ms) { return new Date(ms).toISOString(); }

function fakeStore(initial = []) {
  const records = initial.map((r) => ({ enabled: true, health: 'live', failureCount: 0, username: '', hasPassword: false, countryCode:'US', timezoneId:'America/New_York', createdAt: iso(0), updatedAt: iso(0), ...r }));
  return {
    records,
    async list(kind) { return records.filter((r) => !kind || r.kind === kind).map((r) => ({ ...r })); },
    async get(id) { const r = records.find((x) => x.id === id); return r ? { ...r } : null; },
    async getRuntimeProxy(id) { const r = records.find((x) => x.id === id); if (!r) throw new Error('not found'); return { ...r, password: r._password || '' }; },
    async saveHealth(id, result) { const r = records.find((x) => x.id === id); Object.assign(r, result, { lastCheckedAt: result.checkedAt || r.lastCheckedAt }); return { ...r }; },
    async markUsed(id, at) { const r = records.find((x) => x.id === id); r.lastUsedAt = at; return { ...r }; },
    async importMany(parsed, opts) { return { accepted: [], duplicates: [], parsed, opts }; },
    async update(id, patch) { const r = records.find((x) => x.id === id); Object.assign(r, patch); return { ...r }; },
    async remove(ids) { for (const id of ids) { const i = records.findIndex((x) => x.id === id); if (i >= 0) records.splice(i, 1); } },
    async setEnabled(ids, enabled) { records.forEach((r) => { if (ids.includes(r.id)) r.enabled = enabled; }); return this.list(); },
    async acceptStaticIp(id) { const r = records.find((x) => x.id === id); r.expectedStaticIp = r.pendingStaticIp; delete r.pendingStaticIp; r.staticIpChangePending = false; return { ...r }; },
  };
}

function live(id, kind, overrides = {}) {
  return {
    id, kind, protocol: 'http', hostname: `${id}.proxy.test`, port: 8080,
    lastCheckedAt: iso(950_000), nextCheckAt: iso(1_550_000), ...overrides,
  };
}

function serviceFixture(records, options = {}) {
  const store = fakeStore(records);
  let healthCalls = 0;
  let active = 0;
  let maxActive = 0;
  const healthChecker = options.healthChecker || {
    async checkProxy(runtime) {
      healthCalls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (options.healthDelay) await new Promise((resolve) => setTimeout(resolve, options.healthDelay));
      active -= 1;
      return { health: 'live', latencyMs: 50, observedIp: `203.0.113.${healthCalls}`, failureCount: 0, checkedAt: iso(1_000_000), nextCheckAt: iso(1_600_000) };
    },
  };
  const service = createProxyPoolService({
    store,
    healthChecker,
    directIpProvider: async () => '198.51.100.10',
    now: () => 1_000_000,
    random: options.random || Math.random,
    setTimer: options.setTimer || ((fn) => ({ fn })),
    clearTimer: options.clearTimer || (() => {}),
  });
  return { service, store, healthCalls: () => healthCalls, maxActive: () => maxActive };
}

test('rotating allocation uses round robin across live fresh gateways', async () => {
  const { service } = serviceFixture([live('r1', 'rotating'), live('r2', 'rotating')]);
  const a = await service.allocate('rotating', 'session-1');
  await service.release(a.allocationId);
  const b = await service.allocate('rotating', 'session-2');
  assert.equal(a.proxyId, 'r1');
  assert.equal(b.proxyId, 'r2');
});



test('verified slow proxies are automatic fallback when no live route is available', async () => {
  const { service } = serviceFixture([live('slow-only', 'rotating', { health: 'slow' })]);
  const allocation = await service.allocate('rotating', 'default-session');
  assert.equal(allocation.proxyId, 'slow-only');
});

test('proxy summary reports live and verified-slow eligibility per pool', async () => {
  const { service } = serviceFixture([
    live('r-live', 'rotating'),
    live('r-slow', 'rotating', { health: 'slow' }),
    live('s-live', 'static'),
    live('s-slow', 'static', { health: 'slow' }),
  ]);
  const summary = await service.getSummary();
  assert.equal(summary.rotatingLive, 1);
  assert.equal(summary.rotatingSlow, 1);
  assert.equal(summary.staticLive, 1);
  assert.equal(summary.staticSlow, 1);
});
test('static allocation is least recently used and reserves concurrently', async () => {
  const { service } = serviceFixture([live('s1', 'static'), live('s2', 'static')]);
  const a = await service.allocate('static', 'session-1');
  const b = await service.allocate('static', 'session-2');
  assert.notEqual(a.proxyId, b.proxyId);
  await assert.rejects(() => service.allocate('static', 'session-3'), /No eligible static proxy/i);
});

test('stale candidate is retested before allocation', async () => {
  const { service, healthCalls } = serviceFixture([live('r1', 'rotating', { lastCheckedAt: iso(1) })]);
  const allocation = await service.allocate('rotating', 'session-1');
  assert.equal(allocation.proxyId, 'r1');
  assert.equal(healthCalls(), 1);
});

test('coalesces concurrent health checks for the same proxy id', async () => {
  const { service, healthCalls } = serviceFixture([live('p1', 'rotating', { health: 'pending' })], { healthDelay: 20 });
  const [a, b] = await Promise.all([service.check('p1'), service.check('p1')]);
  assert.equal(healthCalls(), 1);
  assert.deepEqual(a, b);
});

test('skips ineligible records and pending static IP changes', async () => {
  const { service } = serviceFixture([
    live('slow', 'rotating', { health: 'slow' }),
    live('dead', 'rotating', { health: 'dead' }),
    live('off', 'rotating', { enabled: false }),
    live('good', 'rotating'),
  ]);
  assert.equal((await service.allocate('rotating', 'x')).proxyId, 'good');

  const staticFixture = serviceFixture([live('s1', 'static', { staticIpChangePending: true })]);
  await assert.rejects(() => staticFixture.service.allocate('static', 'x'), /No eligible static proxy/i);
});

test('failed stale candidate tries the next eligible proxy', async () => {
  const store = fakeStore([live('r1', 'rotating', { lastCheckedAt: iso(1) }), live('r2', 'rotating')]);
  let calls = 0;
  const service = createProxyPoolService({
    store,
    healthChecker: { checkProxy: async () => { calls += 1; return { health: 'dead', failureCount: 1, checkedAt: iso(1_000_000), nextCheckAt: iso(1_120_000), error: 'failed' }; } },
    directIpProvider: async () => '198.51.100.10',
    now: () => 1_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const allocation = await service.allocate('rotating', 'x');
  assert.equal(calls, 1);
  assert.equal(allocation.proxyId, 'r2');
});

test('rotating runtime route failure confirms the gateway on a fresh route before poisoning the shared pool entry', async () => {
  const { service, store, healthCalls } = serviceFixture([live('r1', 'rotating')]);
  await service.reportRuntimeFailure('r1', 'one session route failed');
  const record = await store.get('r1');
  assert.equal(healthCalls(), 1);
  assert.equal(record.health, 'live');
  assert.equal(record.failureCount, 0);
});

test('static runtime failure still marks the specific proxy failed and schedules a retest', async () => {
  const { service, store } = serviceFixture([live('s1', 'static')]);
  await service.reportRuntimeFailure('s1', 'route failed');
  const record = await store.get('s1');
  assert.equal(record.health, 'dead');
  assert.equal(record.failureCount, 1);
  assert.equal(record.nextCheckAt, iso(1_120_000));
});

test('background and manual health work never exceed concurrency three', async () => {
  const records = Array.from({ length: 7 }, (_, i) => live(`r${i}`, 'rotating', { health: 'pending' }));
  const { service, maxActive } = serviceFixture(records, { healthDelay: 15 });
  await service.checkMany(records.map((r) => r.id));
  assert.equal(maxActive(), 3);
});

test('stop clears scheduled timer and prevents later scheduler callbacks from scheduling checks', async () => {
  let scheduled;
  let cleared = 0;
  const { service } = serviceFixture([live('r1', 'rotating', { health: 'pending' })], {
    setTimer: (fn) => { scheduled = fn; return 123; },
    clearTimer: () => { cleared += 1; },
  });
  service.start();
  service.stop();
  assert.equal(cleared, 1);
  assert.equal(typeof scheduled, 'function');
});

test('activity and safe export never include passwords', async () => {
  const { service, store } = serviceFixture([live('r1', 'rotating', { username: 'alice', _password: 'secret', hasPassword: true })]);
  await service.reportRuntimeFailure('r1', 'alice secret failed');
  assert.equal(JSON.stringify(service.getActivity()).includes('secret'), false);
  const exported = await service.exportSafe({ kind: 'rotating', includeUsernames: true });
  assert.equal(exported.includes('secret'), false);
  assert.match(exported, /alice@r1\.proxy\.test:8080/);
});

test('import results returned to renderer mask credentials in invalid and duplicate lines', async () => {
  const store = fakeStore([]);
  store.importMany = async (parsed) => ({
    accepted: [],
    duplicates: parsed.map((record) => ({ line: record.sourceLine, existingId: 'existing', passwordChanged: false })),
  });
  const service = createProxyPoolService({
    store,
    healthChecker: { checkProxy: async () => ({ health: 'live', failureCount: 0, checkedAt: iso(1_000_000), nextCheckAt: iso(1_600_000) }) },
    directIpProvider: async () => '198.51.100.10',
    now: () => 1_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const duplicate = await service.importText({ text: 'http://alice:secret@proxy.test:8080', kind: 'rotating' });
  assert.equal(JSON.stringify(duplicate).includes('secret'), false);
  assert.equal(JSON.stringify(duplicate).includes('alice'), false);

  const invalid = await service.importText({ text: 'proxy.test:8080:alice:secret:extra', kind: 'rotating' });
  assert.equal(JSON.stringify(invalid).includes('secret'), false);
  assert.equal(JSON.stringify(invalid).includes('alice'), false);
});

test('proxy health checks never call the host direct-IP provider in strict proxy mode', async () => {
  const store = fakeStore([live('r1', 'rotating', { health: 'dead', failureCount: 2, nextCheckAt: iso(1_000_000) })]);
  let proxyChecks = 0;
  let directCalls = 0;
  const service = createProxyPoolService({
    store,
    healthChecker: { checkProxy: async (_runtime, directIp) => { proxyChecks += 1; assert.equal(directIp, undefined); return { health: 'live', failureCount: 0, checkedAt: iso(1_000_000), nextCheckAt: iso(1_600_000), observedIp:'203.0.113.20' }; } },
    directIpProvider: async () => { directCalls += 1; return '198.51.100.10'; },
    now: () => 1_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });

  const result = await service.check('r1');
  assert.equal(proxyChecks, 1);
  assert.equal(directCalls, 0);
  assert.equal(result.health, 'live');
});


test('getDirectIp is disabled while proxy service is operating in strict proxy mode', async () => {
  let calls = 0;
  const service = createProxyPoolService({
    store: fakeStore([]),
    healthChecker: { checkProxy: async () => ({ health: 'live' }) },
    directIpProvider: async () => { calls += 1; return '198.51.100.10'; },
    now: () => 1_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });

  assert.equal(await service.getDirectIp(), null);
  assert.equal(calls, 0);
});

test('one failed fresh-route confirmation does not make a shared rotating gateway unavailable to all concurrent work', async () => {
  const store = fakeStore([live('r1', 'rotating')]);
  const service = createProxyPoolService({
    store,
    healthChecker: { checkProxy: async () => ({ health:'dead', failureCount:1, checkedAt:iso(1_000_000), nextCheckAt:iso(1_120_000), error:'one fresh route failed' }) },
    directIpProvider: async () => '198.51.100.10',
    now: () => 1_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  await service.reportRuntimeFailure('r1', 'one session route failed');
  const record = await store.get('r1');
  assert.equal(record.health, 'live');
  const allocation = await service.allocate('rotating', 'next-concurrent-session');
  assert.equal(allocation.proxyId, 'r1');
});

test('legacy fetched-free records are excluded from list, summary, and static allocation', async () => {
  const { service } = serviceFixture([
    live('legacy-free', 'static', { source:'fetched-free', health:'live' }),
    live('manual-live', 'static', { source:'manual', health:'live' }),
  ]);
  const listed = await service.list('static');
  assert.deepEqual(listed.map((record) => record.id), ['manual-live']);
  const summary = await service.getSummary();
  assert.equal(summary.total, 1);
  assert.equal(summary.staticLive, 1);
  const allocation = await service.allocate('static', 'session-static');
  assert.equal(allocation.proxyId, 'manual-live');
  await assert.rejects(() => service.allocate('fetched-free', 'legacy-owner'), /rotating or static/i);
});

test('smart mix uses rotating when it is the only eligible pool and accepts verified slow routes', async () => {
  const { service } = serviceFixture([
    live('r-slow', 'rotating', { health: 'slow' }),
    live('s-dead', 'static', { health: 'dead' }),
  ], { random: () => 0.9 });
  const allocation = await service.allocate('smart-mix', 'mix-1');
  assert.equal(allocation.proxyKind, 'rotating');
  assert.equal(allocation.proxyId, 'r-slow');
});

test('smart mix uses static when rotating has no eligible route', async () => {
  const { service } = serviceFixture([
    live('r-dead', 'rotating', { health: 'dead' }),
    live('s-live', 'static'),
  ], { random: () => 0.1 });
  const allocation = await service.allocate('smart-mix', 'mix-2');
  assert.equal(allocation.proxyKind, 'static');
  assert.equal(allocation.proxyId, 's-live');
});

test('smart mix randomly chooses between healthy rotating and static pools per allocation', async () => {
  const rotatingFirst = serviceFixture([
    live('r1', 'rotating'),
    live('s1', 'static'),
  ], { random: () => 0.1 }).service;
  const staticFirst = serviceFixture([
    live('r1', 'rotating'),
    live('s1', 'static'),
  ], { random: () => 0.9 }).service;

  assert.equal((await rotatingFirst.allocate('smart-mix', 'mix-r')).proxyKind, 'rotating');
  assert.equal((await staticFirst.allocate('smart-mix', 'mix-s')).proxyKind, 'static');
});

test('smart mix falls back to the other pool when its preferred stale candidate fails revalidation', async () => {
  const store = fakeStore([
    live('r1', 'rotating', { lastCheckedAt: iso(1) }),
    live('s1', 'static'),
  ]);
  const service = createProxyPoolService({
    store,
    healthChecker: { checkProxy: async () => ({ health:'dead', failureCount:1, checkedAt:iso(1_000_000), nextCheckAt:iso(1_120_000), error:'failed' }) },
    directIpProvider: async () => '198.51.100.10',
    now: () => 1_000_000,
    random: () => 0.1,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const allocation = await service.allocate('smart-mix', 'mix-fallback');
  assert.equal(allocation.proxyKind, 'static');
  assert.equal(allocation.proxyId, 's1');
});

test('allocation carries the proxy record country code into Test Run runtime metadata', async () => {
  const { service } = serviceFixture([live('r-country', 'rotating', { countryCode: 'NG' })]);
  const allocation = await service.allocate('rotating', 'country-session');
  assert.equal(allocation.countryCode, 'NG');
});

test('static allocation honors permanent preferred proxy and excludes proxies pinned to other accounts',async()=>{
  const rows=[
    {id:'s1',kind:'static',protocol:'http',hostname:'one',port:8001,enabled:true,health:'live',source:'manual',countryCode:'US',timezoneId:'America/New_York',lastCheckedAt:iso(950_000)},
    {id:'s2',kind:'static',protocol:'http',hostname:'two',port:8002,enabled:true,health:'live',source:'manual',countryCode:'US',timezoneId:'America/New_York',lastCheckedAt:iso(950_000)},
  ];
  const store={async list(kind){return rows.filter(r=>!kind||r.kind===kind)},async get(id){return rows.find(r=>r.id===id)},async getRuntimeProxy(id){return {...rows.find(r=>r.id===id),password:''}},async markUsed(){},async saveHealth(id){return rows.find(r=>r.id===id)}};
  const svc=createProxyPoolService({store,healthChecker:{async checkProxy(){return {health:'live'}}},directIpProvider:async()=> '1.1.1.1'});
  const first=await svc.allocate('static','acct-a',{preferredProxyId:'s2',excludeProxyIds:['s1']});
  assert.equal(first.proxyId,'s2');await svc.release(first.allocationId);
  const second=await svc.allocate('static','acct-b',{excludeProxyIds:['s2']});
  assert.equal(second.proxyId,'s1');await svc.release(second.allocationId);
});

test('static proxy reservations are unique within one platform scope but reusable across different platform scopes', async () => {
  const { service } = serviceFixture([live('s1', 'static'), live('s2', 'static')]);
  const spotifyA = await service.allocate('static', 'spotify-a', { reservationScope:'platform:spotify' });
  const spotifyB = await service.allocate('static', 'spotify-b', { reservationScope:'platform:spotify' });
  assert.notEqual(spotifyA.proxyId, spotifyB.proxyId);
  const youtubeA = await service.allocate('static', 'youtube-a', { reservationScope:'platform:youtube' });
  assert.equal(youtubeA.proxyId, spotifyA.proxyId);
  await assert.rejects(() => service.allocate('static', 'spotify-c', { reservationScope:'platform:spotify' }), /No eligible static proxy/i);
  await service.release(spotifyA.allocationId);
  const spotifyC = await service.allocate('static', 'spotify-c', { reservationScope:'platform:spotify' });
  assert.equal(spotifyC.proxyId, spotifyA.proxyId);
  await service.release(spotifyB.allocationId);
  await service.release(spotifyC.allocationId);
  await service.release(youtubeA.allocationId);
});

test('Test Run static policy randomizes a healthy LIVE cycle without reuse until the cycle completes', async () => {
  let n=0;const sequence=[0.2,0.8,0.4,0.6,0.1,0.9];
  const {service}=serviceFixture([
    live('fast-a','static',{latencyMs:80}),
    live('fast-b','static',{latencyMs:120}),
    live('fast-c','static',{latencyMs:180}),
    live('slow-fallback','static',{health:'slow',latencyMs:5000}),
  ],{random:()=>sequence[(n++)%sequence.length]});
  const ids=[];
  for(let i=0;i<4;i++){
    const a=await service.allocate('static',`test-${i}`,{selectionPolicy:'healthy-random-cycle',rotationScope:'test-run:static'});
    ids.push(a.proxyId);await service.release(a.allocationId);
  }
  assert.equal(new Set(ids.slice(0,3)).size,3);
  assert.ok(ids.slice(0,3).every(id=>id.startsWith('fast-')));
  assert.ok(ids[3].startsWith('fast-'));
  assert.notEqual(ids.slice(0,3).includes('slow-fallback'),true);
});

test('Test Run static policy falls back to verified SLOW proxies only when no LIVE route exists', async () => {
  const {service}=serviceFixture([
    live('slow-a','static',{health:'slow',latencyMs:4000}),
    live('slow-b','static',{health:'slow',latencyMs:6000}),
  ],{random:()=>0.3});
  const a=await service.allocate('static','slow-test',{selectionPolicy:'healthy-random-cycle',rotationScope:'test-run:static'});
  assert.ok(['slow-a','slow-b'].includes(a.proxyId));
});

test('manual sticky assignment can share the same static proxy across concurrent accounts', async () => {
  const {service}=serviceFixture([live('shared-static','static',{latencyMs:90})]);
  const first=await service.allocate('static','account-a',{preferredProxyId:'shared-static',excludeProxyIds:[],allowSharedStatic:true,reservationScope:'platform:spotify'});
  const second=await service.allocate('static','account-b',{preferredProxyId:'shared-static',excludeProxyIds:[],allowSharedStatic:true,reservationScope:'platform:spotify'});
  assert.equal(first.proxyId,'shared-static');
  assert.equal(second.proxyId,'shared-static');
  await service.release(first.allocationId);
  await service.release(second.allocationId);
});
