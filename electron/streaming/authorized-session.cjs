async function captureAuthorizedSession(context,capturedAt=new Date().toISOString()){
  if(!context)return '';
  let storageState=null;
  if(typeof context.storageState==='function'){
    try{storageState=await context.storageState({indexedDB:true});}
    catch{
      try{storageState=await context.storageState();}
      catch{storageState=null;}
    }
  }
  if(!storageState){
    let cookies=[];
    try{cookies=typeof context.cookies==='function'?await context.cookies():[];}catch{cookies=[];}
    storageState={cookies:Array.isArray(cookies)?cookies:[],origins:[]};
  }
  const cookies=Array.isArray(storageState?.cookies)?storageState.cookies:[];
  const origins=Array.isArray(storageState?.origins)?storageState.origins:[];
  if(!cookies.length&&!origins.length)return '';
  return JSON.stringify({version:2,kind:'playwright-storage-state',capturedAt:String(capturedAt||new Date().toISOString()),storageState:{...storageState,cookies,origins}});
}
module.exports={captureAuthorizedSession};
