const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveInstalledBrave,pathCandidates,parseRegistryDefault}=require('./chrome-runtime-resolver.cjs');

test('Brave resolver accepts Windows environment names case-insensitively and user-local installs',()=>{
  const expected=path.win32.normalize('C:/Users/Ava/AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe');
  const result=resolveInstalledBrave({platform:'win32',env:{UserProfile:'C:/Users/Ava',Path:''},existsSync:p=>path.win32.normalize(p).toLowerCase()===expected.toLowerCase(),execFileSync:()=>{throw new Error('no registry')}});
  assert.equal(result.found,true);
  assert.equal(result.executablePath.toLowerCase(),expected.toLowerCase());
});

test('Brave resolver honors explicit BRAVE_PATH for nonstandard installations',()=>{
  const expected=path.win32.normalize('D:/Apps/Brave/brave.exe');
  const result=resolveInstalledBrave({platform:'win32',env:{BRAVE_PATH:expected,Path:''},existsSync:p=>path.win32.normalize(p).toLowerCase()===expected.toLowerCase(),execFileSync:()=>{throw new Error('no registry')}});
  assert.equal(result.found,true);
  assert.equal(result.source,'environment-override');
});

test('registry parser extracts App Paths executable without changing it',()=>{
  const out='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe\r\n    (Default)    REG_SZ    C:\\Custom\\Brave\\brave.exe\r\n';
  assert.equal(parseRegistryDefault(out),'C:\\Custom\\Brave\\brave.exe');
});

test('account proxy UI lazy-loads static proxies only when picker opens',()=>{
  for(const file of ['src/components/StreamingAccountsPanel.tsx','src/components/SocialAccountsPanel.tsx']){
    const src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(src,/listProxies\?\.\('static'\)[\s\S]{0,160}\},\[accounts\]\)/);
    assert.match(src,/async function openProxyAssignment[\s\S]*listProxies\?\.\('static'\)/);
  }
  const bundle=fs.readFileSync(path.join(__dirname,'..','dist/assets/index-manual.js'),'utf8');
  assert.doesNotMatch(bundle,/listProxies\?\.\('static'\)[\s\S]{0,160}\}, \[accounts\]\)/);
});
