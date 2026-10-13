const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');

test('sidebar and app expose a dedicated Accounts subpage below Music Library',()=>{
  const sidebar=read('src/components/Sidebar.tsx');
  const app=read('src/App.tsx');
  assert.match(sidebar,/streaming-accounts/);
  assert.match(sidebar,/Accounts/);
  const libraryIndex=sidebar.indexOf('Music Library');
  const accountIndex=sidebar.indexOf('Accounts');
  assert.ok(accountIndex>libraryIndex);
  assert.match(app,/streaming-accounts/);
});

test('Accounts UI manages all platforms with explicit manual login and saved-session checking',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  for(const label of ['Spotify','YouTube Music','SoundCloud','Deezer','TIDAL','Audiomack','Pandora']) assert.match(source,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(source,/selectedPlatforms/);
  assert.match(source,/EDIT/i);
  assert.match(source,/LOGIN MANUALLY/i);
  assert.match(source,/CHECK SAVED SESSION/i);
  assert.match(source,/DELETE/i);
  assert.match(source,/Default QA proxy/i);
  assert.match(source,/lastVerifiedAt|Last verified/i);
  assert.doesNotMatch(source,/TEST LOGIN/i);
});

test('Streaming Hub no longer renders platform tabs or the account form in the execution view',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  assert.doesNotMatch(hub,/<StreamingPlatformTabs\b/);
  assert.match(hub,/view==='accounts'/);
  assert.match(hub,/StreamingAccountsPanel/);
});

test('saving an account does not silently start website login; LOGIN MANUALLY is explicit',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  const start=source.indexOf('async function save()');
  const end=source.indexOf('async function switchProxy',start);
  const saveBody=source.slice(start,end);
  assert.match(source,/LOGIN MANUALLY/i);
  assert.match(source,/onStartVerification/);
  assert.doesNotMatch(saveBody,/onStartVerification/);
  assert.doesNotMatch(saveBody,/onVerify/);
});

test('Streaming Hub execution view does not render the old clickable platform tab row',()=>{
  const source=read('src/pages/StreamingHub.tsx');
  assert.doesNotMatch(source,/<StreamingPlatformTabs\b/);
  assert.doesNotMatch(source,/className="stream-platform-tabs"/);
});

test('account page separates QA proxy from manual-login network and forces manual login direct',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  assert.match(source,/Default QA proxy/);
  assert.match(source,/Manual login network/i);
  assert.match(source,/Direct \/ No proxy/);
  assert.match(source,/QA proxy applies later during QA runs/i);
  assert.doesNotMatch(source,/checkProxyByAccount/);
  assert.doesNotMatch(source,/Test login with/i);
});

test('pending manual account login renders card confirmation surface with MARK VERIFIED and CANCEL',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  const css=read('src/styles.css');
  assert.match(source,/MARK VERIFIED/);
  assert.match(source,/CANCEL VERIFICATION/);
  assert.match(source,/MANUAL LOGIN OPEN · ACCOUNT-SPECIFIC PROFILE/);
  assert.match(source,/stream-verification-confirm-card/);
  assert.match(css,/stream-verification-confirm-card/);
});

test('manual account login uses normal desktop browser and exposes no automated login device selector',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  assert.match(source,/dedicated normal Chrome\/Brave\/Edge profile saved for that account/i);
  assert.match(source,/OrbitQA does not type your password into the streaming website/i);
  assert.match(source,/deviceMode:'desktop'/);
  assert.match(source,/deviceProfile:'Desktop 1280x720'/);
  assert.doesNotMatch(source,/testDeviceByAccount/);
  assert.doesNotMatch(source,/Test device/i);
});

test('imported sessions have an explicit saved-session check and never trigger credential login from account save',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  assert.match(source,/onCheckSavedSession/);
  assert.match(source,/Imported sessions can be checked separately with CHECK SAVED SESSION/i);
  const start=source.indexOf('async function save()');
  const end=source.indexOf('async function switchProxy',start);
  const saveBody=source.slice(start,end);
  assert.doesNotMatch(saveBody,/onStartVerification/);
  assert.doesNotMatch(saveBody,/authenticate/);
});

test('proxy-only account edits do not trigger automatic credential login',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  const start=source.indexOf('async function switchProxy');
  const end=source.indexOf('const canSave',start)>start?source.indexOf('const canSave',start):source.length;
  const body=source.slice(start,end);
  assert.match(body,/await onSave/);
  assert.doesNotMatch(body,/onStartVerification/);
});

test('Accounts library is compact searchable and keeps grouping out of account cards',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  const css=read('src/styles.css');
  assert.match(source,/accountSearch/);
  assert.match(source,/Search accounts/i);
  assert.match(source,/accounts\.length/);
  assert.match(source,/grouping is configured separately in Streaming Hub/i);
  assert.doesNotMatch(source,/selectedIds\.length/);
  assert.match(source,/stream-account-library-toolbar/);
  assert.match(css,/stream-account-card-grid/);
  assert.match(css,/minmax\(260px,1fr\)/);
  assert.match(css,/stream-account-card--compact/);
});

test('Accounts library does not own run selection or account groups',()=>{
  const source=read('src/components/StreamingAccountsPanel.tsx');
  const groupPanel=read('src/components/StreamingGroupPlanPanel.tsx');
  assert.doesNotMatch(source,/SELECT ALL VISIBLE/i);
  assert.doesNotMatch(source,/CLEAR SELECTION/i);
  assert.doesNotMatch(source,/Use for QA/i);
  assert.doesNotMatch(source,/qaGroup/);
  assert.match(groupPanel,/ACCOUNT GROUPS/);
  assert.match(groupPanel,/\+ ADD GROUP/);
  assert.match(groupPanel,/accountIds/);
});

test('compact account cards remain readable instead of shrinking text to tiny sizes',()=>{
  const css=read('src/styles.css');
  const start=css.indexOf('/* v0.17.3 persistent account streaming + dense account library */');
  assert.ok(start>=0);
  const block=css.slice(start);
  const width=block.match(/stream-account-card-grid\{[^}]*minmax\((\d+)px,1fr\)/)?.[1];
  assert.ok(Number(width)>=240,`account card minimum width should be at least 240px, got ${width}`);
  const compactRules=[...block.matchAll(/\.stream-account-card--compact[^{}]*\{[^}]*font-size:(\d+)px[^}]*\}/g)].map(match=>Number(match[1]));
  assert.ok(compactRules.length>0);
  assert.ok(Math.min(...compactRules)>=10,`compact account text must stay at least 10px, got ${Math.min(...compactRules)}px`);
});
