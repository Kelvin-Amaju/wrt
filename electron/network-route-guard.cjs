const activeProxyAllocations=new Map();

function beginProxyAllocation(allocationId,meta={}){
  const id=String(allocationId||'').trim();
  if(!id) throw new Error('Proxy allocation id is required');
  activeProxyAllocations.set(id,{...meta,startedAt:Date.now()});
  return id;
}
function endProxyAllocation(allocationId){
  activeProxyAllocations.delete(String(allocationId||''));
}
function proxyNetworkActive(){return activeProxyAllocations.size>0;}
function activeProxyCount(){return activeProxyAllocations.size;}
function assertDirectNetworkAllowed(operation='Direct network request'){
  if(proxyNetworkActive()){
    const error=new Error(`${operation} blocked while proxied QA sessions are active; direct-route fallback is disabled`);
    error.code='ORBITQA_DIRECT_NETWORK_BLOCKED';
    throw error;
  }
}
function createGuardedFetch(fetchImpl=globalThis.fetch){
  if(typeof fetchImpl!=='function') throw new Error('fetch implementation is required');
  return async function guardedFetch(...args){
    assertDirectNetworkAllowed('Backend Internet request');
    return await fetchImpl(...args);
  };
}
function resetForTests(){activeProxyAllocations.clear();}
module.exports={beginProxyAllocation,endProxyAllocation,proxyNetworkActive,activeProxyCount,assertDirectNetworkAllowed,createGuardedFetch,_test:{resetForTests}};
