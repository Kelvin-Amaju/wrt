const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CACHE_TTL_MS = 30000;
const cache = new Map();

function envValue(env, ...names) {
  if (!env) return '';
  for (const name of names) {
    if (env[name]) return String(env[name]);
    const key = Object.keys(env).find(k => k.toLowerCase() === String(name).toLowerCase());
    if (key && env[key]) return String(env[key]);
  }
  return '';
}

function browserParts(family) {
  return family === 'brave'
    ? ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']
    : ['Google', 'Chrome', 'Application', 'chrome.exe'];
}

function browserLabel(family) { return family === 'brave' ? 'Brave' : 'Google Chrome'; }

function row(executablePath, family, source) {
  if (!executablePath) return null;
  return { executablePath: path.win32.normalize(String(executablePath)), source, browserFamily: family, label: browserLabel(family) };
}

function candidate(root, family, source) {
  if (!root) return null;
  return row(path.win32.join(String(root), ...browserParts(family)), family, source);
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(Boolean).filter(item => {
    const key = String(item.executablePath || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function pathCandidates(family, env = process.env) {
  const override = family === 'brave'
    ? envValue(env, 'BRAVE_PATH', 'BRAVE_EXECUTABLE_PATH')
    : envValue(env, 'CHROME_PATH', 'CHROME_EXECUTABLE_PATH');
  const local = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
  const user = envValue(env, 'USERPROFILE', 'UserProfile');
  const pf = envValue(env, 'PROGRAMFILES', 'ProgramFiles', 'ProgramW6432');
  const pfx86 = envValue(env, 'PROGRAMFILES(X86)', 'ProgramFiles(x86)');
  const rows = [];
  if (override) rows.push(row(override, family, 'environment-override'));
  // Preserve OrbitQA's existing machine-wide preference, then cover per-user installs.
  rows.push(candidate(pf, family, 'program-files'));
  rows.push(candidate(pfx86, family, 'program-files-x86'));
  rows.push(candidate(local, family, 'local-app-data'));
  if (user) rows.push(candidate(path.win32.join(user, 'AppData', 'Local'), family, 'user-profile-local-app-data'));
  // Fallbacks cover Electron environments where ProgramFiles variables are unavailable.
  rows.push(candidate('C:\\Program Files', family, 'default-program-files'));
  rows.push(candidate('C:\\Program Files (x86)', family, 'default-program-files-x86'));
  const pathText = envValue(env, 'PATH', 'Path');
  if (pathText) {
    const exe = family === 'brave' ? 'brave.exe' : 'chrome.exe';
    for (const dir of pathText.split(path.delimiter).filter(Boolean)) rows.push(row(path.win32.join(dir, exe), family, 'path'));
  }
  return uniqueRows(rows);
}

function parseRegistryDefault(output='') {
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/REG_SZ\s+(.+?)\s*$/i);
    if (m && m[1]) return m[1].trim().replace(/^"|"$/g, '');
  }
  return '';
}

function registryCandidates(family, options={}) {
  if ((options.platform || process.platform) !== 'win32') return [];
  const run = options.execFileSync || execFileSync;
  const exe = family === 'brave' ? 'brave.exe' : 'chrome.exe';
  const keys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
  ];
  const rows=[];
  for (const key of keys) {
    try {
      const out = run('reg.exe', ['query', key, '/ve'], { encoding:'utf8', windowsHide:true, timeout:1200, stdio:['ignore','pipe','ignore'] });
      const found = parseRegistryDefault(out);
      if (found) rows.push(row(found, family, 'windows-app-paths-registry'));
    } catch {}
  }
  return uniqueRows(rows);
}

function resolveInstalledFamily(family, options = {}) {
  const useCache = !options.env && !options.existsSync && !options.execFileSync && !options.platform;
  const now = Date.now();
  const cached = cache.get(family);
  if (useCache && cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const candidates = [...pathCandidates(family, env), ...registryCandidates(family, options)];
  for (const item of candidates) {
    try {
      if (existsSync(item.executablePath)) {
        const value={ found: true, ...item };
        if (useCache) cache.set(family,{at:now,value});
        return value;
      }
    } catch {}
  }
  const value={ found: false, browserFamily: family, label: browserLabel(family), checkedPaths:candidates.map(x=>x.executablePath).slice(0,12) };
  if (useCache) cache.set(family,{at:now,value});
  return value;
}

function resolveInstalledChrome(options = {}) { return resolveInstalledFamily('chrome', options); }
function resolveInstalledBrave(options = {}) { return resolveInstalledFamily('brave', options); }
function resolveInstalledChromiumBrowser(runtimeKind = 'chrome-installed', options = {}) {
  return runtimeKind === 'brave-installed' ? resolveInstalledBrave(options) : resolveInstalledChrome(options);
}
function clearBrowserRuntimeResolverCache(){ cache.clear(); }

module.exports = { resolveInstalledChrome, resolveInstalledBrave, resolveInstalledChromiumBrowser, clearBrowserRuntimeResolverCache, pathCandidates, parseRegistryDefault };
