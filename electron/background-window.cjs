const { spawn } = require('node:child_process');

let concealQueue = Promise.resolve();

function backgroundWindowArgs({ browserEngine, executionMode }) {
  if (browserEngine !== 'chromium' || executionMode !== 'background') return [];
  // Keep a real headed renderer, but place it off-screen immediately to avoid a visible launch flash.
  // The native Windows conceal step below then removes the worker window from the desktop/taskbar.
  return ['--window-position=-32000,-32000','--window-size=1280,720'];
}

function runPowerShellConceal({ titleToken, timeoutMs = 5000 }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok:false, reason:'background window concealment is Windows-only' });
  const script = String.raw`
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrbitQABackgroundWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$needle = $env:ORBITQA_BG_WINDOW_TOKEN
$found = [IntPtr]::Zero
$matches = 0
$callback = [OrbitQABackgroundWindow+EnumWindowsProc]{ param([IntPtr]$h,[IntPtr]$l)
  if (-not [OrbitQABackgroundWindow]::IsWindowVisible($h)) { return $true }
  $b = New-Object System.Text.StringBuilder 1024
  [void][OrbitQABackgroundWindow]::GetWindowText($h,$b,$b.Capacity)
  if ($b.ToString().Contains($needle)) { $script:found = $h; $script:matches += 1 }
  return $true
}
[void][OrbitQABackgroundWindow]::EnumWindows($callback,[IntPtr]::Zero)
if ($matches -ne 1 -or $found -eq [IntPtr]::Zero) { Write-Output "WINDOW_MATCH_COUNT=$matches"; exit 2 }
# SW_HIDE = 0. This keeps the headed renderer alive but removes its top-level window from the desktop/taskbar.
[void][OrbitQABackgroundWindow]::ShowWindowAsync($found,0)
Write-Output 'OK'
`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], {
      windowsHide:true,
      env:{...process.env,ORBITQA_BG_WINDOW_TOKEN:titleToken},
      stdio:['ignore','pipe','pipe'],
    });
    let out=''; let err=''; let settled=false; let timer=null;
    const finish=(value)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolve(value);};
    child.stdout?.on('data',(d)=>{out+=String(d);});
    child.stderr?.on('data',(d)=>{err+=String(d);});
    child.once('error',(error)=>finish({ok:false,reason:error.message||String(error)}));
    child.once('exit',(code)=>finish({ok:code===0&&/(^|\r?\n)OK(\r?\n|$)/.test(out),reason:code===0?'':(err.trim()||out.trim()||`PowerShell exit ${code}`)}));
    timer=setTimeout(()=>{try{child.kill();}catch{}finish({ok:false,reason:'background window concealment timed out'});},Math.max(1500,Math.min(10000,timeoutMs)));
  });
}

async function concealBackgroundWorkerWindow({ page, browserEngine='chromium', executionMode='visible', timeoutMs=5000, log=()=>{}, nativeConcealImpl=runPowerShellConceal }) {
  if (browserEngine !== 'chromium' || executionMode !== 'background') return { applied:false, ok:true, reason:'not-background-chromium' };
  if (process.platform !== 'win32') return { applied:false, ok:true, reason:'non-windows-runtime' };
  if (!page || typeof page.evaluate !== 'function') return { applied:true, ok:false, reason:'worker page unavailable for exact window identification' };
  return concealQueue = concealQueue.catch(()=>undefined).then(async()=>{
    const token=`OrbitQA-BG-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    try {
      await page.goto?.('about:blank',{waitUntil:'domcontentloaded',timeout:Math.min(5000,timeoutMs)}).catch(()=>undefined);
      await page.evaluate((title)=>{document.title=title;},token);
      await page.waitForTimeout?.(120).catch(()=>undefined);
      const result=await nativeConcealImpl({titleToken:token,timeoutMs});
      if(result?.ok){log('Background Activity: worker browser concealed; headed renderer remains active at full-speed policy');return {applied:true,ok:true};}
      log(`Background Activity: native concealment could not confirm the exact window (${result?.reason||'unknown'}); off-screen launch containment remains active`);
      return {applied:true,ok:false,reason:result?.reason||'native-conceal-failed'};
    } catch(error){
      return {applied:true,ok:false,reason:error?.message||String(error)};
    }
  });
}

module.exports={backgroundWindowArgs,runPowerShellConceal,concealBackgroundWorkerWindow};
