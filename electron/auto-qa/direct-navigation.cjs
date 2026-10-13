const { spawn } = require('node:child_process');

let nativeAddressQueue = Promise.resolve();

function normalizeTargetUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch { return null; }
}

function sameTargetHost(actual, expected) {
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    return a.hostname.toLowerCase() === e.hostname.toLowerCase();
  } catch { return false; }
}

function waitForTargetNavigation(page, targetUrl, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const current = typeof page?.url === 'function' ? page.url() : '';
        if (sameTargetHost(current, targetUrl)) return resolve(current);
        if (Date.now() - started >= timeoutMs) return reject(new Error('Typed Direct route did not reach the requested target before timeout'));
        await page?.waitForTimeout?.(120).catch(() => undefined);
        setImmediate(check);
      } catch (error) { reject(error); }
    };
    check();
  });
}

function humanDelayMs(random = Math.random) {
  const value = Number(random());
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
  return 95 + Math.floor(normalized * 76); // 95-170ms per character
}

function runPowerShellAddressTyping({ titleToken, targetUrl, timeoutMs = 12000, minDelayMs = 95, maxDelayMs = 170 }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok:false, reason:'native address-bar typing is Windows-only' });
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrbitQANativeWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@
$needle = $env:ORBITQA_WINDOW_TOKEN
$target = $env:ORBITQA_TYPED_TARGET
$minDelay = [Math]::Max(60,[int]$env:ORBITQA_TYPE_MIN_MS)
$maxDelay = [Math]::Max($minDelay,[int]$env:ORBITQA_TYPE_MAX_MS)
$found = [IntPtr]::Zero
$matches = 0
$callback = [OrbitQANativeWindow+EnumWindowsProc]{ param([IntPtr]$h,[IntPtr]$l)
  if (-not [OrbitQANativeWindow]::IsWindowVisible($h)) { return $true }
  $b = New-Object System.Text.StringBuilder 1024
  [void][OrbitQANativeWindow]::GetWindowText($h,$b,$b.Capacity)
  if ($b.ToString().Contains($needle)) { $script:found = $h; $script:matches += 1 }
  return $true
}
[void][OrbitQANativeWindow]::EnumWindows($callback,[IntPtr]::Zero)
if ($matches -ne 1 -or $found -eq [IntPtr]::Zero) { Write-Output "WINDOW_MATCH_COUNT=$matches"; exit 2 }
$previous = [OrbitQANativeWindow]::GetForegroundWindow()
[void][OrbitQANativeWindow]::ShowWindowAsync($found,9)
[void][OrbitQANativeWindow]::SetForegroundWindow($found)
Start-Sleep -Milliseconds 220
function Assert-WorkerWindow() {
  $current = [OrbitQANativeWindow]::GetForegroundWindow()
  if ($current -ne $script:found) { Write-Output 'FOCUS_LOST'; exit 3 }
}
function Escape-SendKeys([string]$value) {
  $out = New-Object System.Text.StringBuilder
  foreach ($ch in $value.ToCharArray()) {
    switch ($ch) {
      '+' { [void]$out.Append('{+}') }
      '^' { [void]$out.Append('{^}') }
      '%' { [void]$out.Append('{%}') }
      '~' { [void]$out.Append('{~}') }
      '(' { [void]$out.Append('{(}') }
      ')' { [void]$out.Append('{)}') }
      '[' { [void]$out.Append('{[}') }
      ']' { [void]$out.Append('{]}') }
      '{' { [void]$out.Append('{{}') }
      '}' { [void]$out.Append('{}}') }
      default { [void]$out.Append($ch) }
    }
  }
  return $out.ToString()
}
Assert-WorkerWindow
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 160
foreach ($ch in $target.ToCharArray()) {
  Assert-WorkerWindow
  [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys ([string]$ch)))
  Start-Sleep -Milliseconds (Get-Random -Minimum $minDelay -Maximum ($maxDelay + 1))
}
Assert-WorkerWindow
Start-Sleep -Milliseconds 90
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 120
if ($previous -ne [IntPtr]::Zero -and $previous -ne $found -and [OrbitQANativeWindow]::IsWindow($previous)) {
  [void][OrbitQANativeWindow]::SetForegroundWindow($previous)
}
Write-Output 'OK'
`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide:true,
      env:{
        ...process.env,
        ORBITQA_WINDOW_TOKEN:titleToken,
        ORBITQA_TYPED_TARGET:targetUrl,
        ORBITQA_TYPE_MIN_MS:String(minDelayMs),
        ORBITQA_TYPE_MAX_MS:String(maxDelayMs),
      },
      stdio:['ignore','pipe','pipe'],
    });
    let out=''; let err=''; let settled=false; let timer=null;
    const finish=(result)=>{ if(settled)return; settled=true; if(timer) clearTimeout(timer); resolve(result); };
    child.stdout?.on('data',(d)=>{ out += String(d); });
    child.stderr?.on('data',(d)=>{ err += String(d); });
    child.once('error',(error)=>finish({ok:false,reason:error.message||String(error)}));
    child.once('exit',(code)=>{
      const text=out.trim();
      const reason = /FOCUS_LOST/.test(text)
        ? 'worker browser lost foreground focus; typing was stopped before it could reach another window'
        : (/WINDOW_MATCH_COUNT=(\d+)/.exec(text)?.[0] || err.trim() || text || `PowerShell exit ${code}`);
      finish({ok:code===0 && /(^|\r?\n)OK(\r?\n|$)/.test(out),reason:code===0?'':reason});
    });
    timer=setTimeout(()=>{ try{child.kill();}catch{} finish({ok:false,reason:'native address-bar typing timed out'}); }, Math.max(2500,Math.min(20000,timeoutMs)));
  });
}

async function nativeAddressBarNavigate({ page, targetUrl, timeoutMs = 30000, log = () => {}, random = Math.random }) {
  if (process.platform !== 'win32') return { ok:false, reason:'not-windows' };
  const token = `OrbitQA-Direct-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  return nativeAddressQueue = nativeAddressQueue.catch(() => undefined).then(async () => {
    try {
      await page.goto('about:blank', { waitUntil:'domcontentloaded', timeout:Math.min(timeoutMs,10000) }).catch(() => undefined);
      if (typeof page.evaluate !== 'function') return {ok:false,reason:'browser page cannot expose a unique worker-window title'};
      await page.evaluate((title) => { document.title = title; }, token);
      await page.bringToFront?.();
      await page.waitForTimeout?.(320).catch(() => undefined);
      const delayA=humanDelayMs(random), delayB=humanDelayMs(random);
      const minDelayMs=Math.min(delayA,delayB), maxDelayMs=Math.max(delayA,delayB);
      const typed = await runPowerShellAddressTyping({ titleToken:token, targetUrl, timeoutMs:Math.min(timeoutMs,16000), minDelayMs, maxDelayMs });
      if (!typed.ok) return typed;
      const finalUrl = await waitForTargetNavigation(page, targetUrl, timeoutMs);
      log(`Referrer QA: Direct · typed target into the real address bar of this worker browser · ${targetUrl}`);
      return { ok:true, finalUrl };
    } catch (error) {
      return { ok:false, reason:error?.message || String(error) };
    }
  });
}

// Deliberately disabled. The typed Direct route must use the real browser omnibox or not type at all.
async function pageTypedDirectNavigate() {
  throw new Error('fake in-page Direct entry is disabled; OrbitQA only uses the real browser address bar');
}

async function navigateDirectRandomized({ page, targetUrl, executionMode = 'visible', timeoutMs = 30000, log = () => {}, random = Math.random, autoType = false, nativeNavigateImpl = nativeAddressBarNavigate }) {
  const requested = normalizeTargetUrl(targetUrl);
  if (!requested) throw new Error('Direct Referrer QA requires a valid http(s) target URL');


  if (executionMode === 'background') {
    log('Referrer QA: Direct · Background Activity stays invisible; using normal direct navigation without foregrounding the native omnibox');
    await page.goto(requested.toString(), { waitUntil:'domcontentloaded', timeout:timeoutMs });
    return { page, finalUrl:typeof page.url === 'function' ? page.url() : requested.toString(), mode:'direct', directRoute:'background-direct-navigation', referralUrl:null };
  }

  if (!autoType) {
    log('Referrer QA: Direct · Auto Type is OFF; using normal direct navigation');
    await page.goto(requested.toString(), { waitUntil:'domcontentloaded', timeout:timeoutMs });
    return { page, finalUrl:typeof page.url === 'function' ? page.url() : requested.toString(), mode:'direct', directRoute:'direct-navigation', referralUrl:null };
  }

  const typedRoute = Number(random()) >= 0.5;
  if (!typedRoute) {
    log('Referrer QA: Direct · Auto Type is ON; randomly selected normal direct navigation');
    await page.goto(requested.toString(), { waitUntil:'domcontentloaded', timeout:timeoutMs });
    return { page, finalUrl:typeof page.url === 'function' ? page.url() : requested.toString(), mode:'direct', directRoute:'direct-navigation', referralUrl:null };
  }

  log('Referrer QA: Direct · Auto Type is ON; randomly selected real browser address-bar typing');
  const typed = await nativeNavigateImpl({ page, targetUrl:requested.toString(), timeoutMs, log, random }).catch((error)=>({ok:false,reason:error?.message||String(error)}));
  if (typed?.ok) {
    return { page, finalUrl:typed.finalUrl || (typeof page.url === 'function' ? page.url() : requested.toString()), mode:'direct', directRoute:'typed-address-bar', referralUrl:null };
  }

  log(`Referrer QA: Direct · real address-bar typing unavailable or unsafe (${typed?.reason || 'unknown reason'}); using normal direct navigation for this worker`);
  await page.goto(requested.toString(), { waitUntil:'domcontentloaded', timeout:timeoutMs });
  return { page, finalUrl:typeof page.url === 'function' ? page.url() : requested.toString(), mode:'direct', directRoute:'direct-navigation-fallback', referralUrl:null };
}

module.exports = {
  normalizeTargetUrl,
  sameTargetHost,
  humanDelayMs,
  runPowerShellAddressTyping,
  nativeAddressBarNavigate,
  pageTypedDirectNavigate,
  navigateDirectRandomized,
};
