function createSchedulerTaskExecutor({
  getRunRegistry,
  getProxyPoolService,
  streamingAccountStore,
  verifyStreamingSavedAccount,
  streamingAdapterRegistry,
  streamingBrowserFactory,
  streamingRunPreparer,
  socialAccountStore,
  socialAccountVerificationManager,
  androidService,
  realIosService,
  getBrowserRuntimeStatus,
}={}){
  return async function executeScheduledTask(task={}){
    const action=String(task?.action||'');const targetId=String(task?.targetId||'');
    if(action==='qa-rerun'){
      const registry=getRunRegistry?.();const run=registry?.getRun?.(targetId);if(!run)throw new Error('Scheduled Run no longer exists');
      if((run.runKind||'qa')!=='qa')throw new Error('Only controlled Run can be scheduled from this action');
      const result=await registry.rerunRun(targetId);if(!result?.rerun)throw new Error(result?.reason||'Run could not be started');return{message:`Started Run ${targetId}`};
    }
    if(action==='proxy-check-all'){
      const service=getProxyPoolService?.();const records=await service.list();const ids=records.filter(x=>x.enabled).map(x=>x.id);if(!ids.length)return{message:'No enabled proxies to check'};await service.checkMany(ids);return{message:`Checked ${ids.length} enabled prox${ids.length===1?'y':'ies'}`};
    }
    if(action==='proxy-recheck-dead'){const rows=await getProxyPoolService?.().recheckDead();return{message:`Rechecked ${Array.isArray(rows)?rows.length:0} dead proxies`};}
    if(action==='streaming-account-verify'){
      if(targetId==='all'){const rows=streamingAccountStore?.list?.()||[];let ok=0;for(const row of rows){const result=await verifyStreamingSavedAccount?.({accountId:row.id,accountStore:streamingAccountStore,adapterRegistry:streamingAdapterRegistry,browserFactory:streamingBrowserFactory}).catch(()=>null);if(result?.ok)ok++;}return{message:`Verified ${ok}/${rows.length} streaming accounts`};}
      const result=await verifyStreamingSavedAccount?.({accountId:targetId,accountStore:streamingAccountStore,adapterRegistry:streamingAdapterRegistry,browserFactory:streamingBrowserFactory});if(!result?.ok)throw new Error(result?.reason||'Streaming account verification failed');return{message:'Streaming account verified'};
    }
    if(action==='streaming-refresh-library'){
      if(!streamingRunPreparer)throw new Error('Streaming library is still starting');const result=await streamingRunPreparer.refreshStaleSavedArtists({reason:'hub-open'});return{message:`Refreshed ${result.refreshedArtistIds?.length||0} stale saved artists`};
    }
    if(action==='social-account-verify'){
      if(targetId==='all'){const rows=socialAccountStore?.list?.()||[];let ok=0;for(const row of rows){const result=await socialAccountVerificationManager?.verifySaved?.(row.id).catch(()=>null);if(result?.ok)ok++;}return{message:`Verified ${ok}/${rows.length} social accounts`};}
      const result=await socialAccountVerificationManager?.verifySaved?.(targetId);if(!result?.ok)throw new Error(result?.reason||'Social account verification failed');return{message:'Social account verified'};
    }
    if(action==='mobile-launch-avd'){if(!targetId)throw new Error('Choose an Android virtual device');const result=await androidService?.launchAvd?.(targetId);return{message:`Android device ${result?.serial||targetId} is ${result?.state||'running'}`};}
    if(action==='real-ios-check'){const result=await realIosService?.checkConnection?.();if(result?.ok===false)throw new Error(result?.reason||'Real iOS provider connection failed');return{message:'Real iOS provider connection check completed'};}
    if(action==='browser-runtime-check'){const status=getBrowserRuntimeStatus?.();if(!status?.found)throw new Error('Supported Chrome runtime was not found');return{message:`Browser runtime ready (${status.source||'installed Chrome'})`};}
    throw new Error('Unsupported scheduler action');
  };
}
module.exports={createSchedulerTaskExecutor};
