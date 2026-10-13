function shouldRest({tracksSinceRest=0,restAfterTracks=0}){const threshold=Math.max(0,Number(restAfterTracks)||0); return threshold>0 && Number(tracksSinceRest)>=threshold;}
module.exports={shouldRest};
