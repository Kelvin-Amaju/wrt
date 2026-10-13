const test=require('node:test'); const assert=require('node:assert/strict'); const {listPlatformAdapters,getPlatformAdapter}=require('./platform-adapter.cjs');
test('all platform adapters expose same conservative contract',()=>{const adapters=listPlatformAdapters(); assert.deepEqual(adapters.map(a=>a.id).sort(),['apple-music','audiomack','deezer','pandora','soundcloud','spotify','tidal','youtube-music'].sort()); for(const a of adapters){for(const key of ['classifyInput','normalizeTrack','resolveCatalog','verifySession','openMusicSelection','locateTrack','playbackControls']) assert.equal(typeof a[key],'function',`${a.id}.${key}`);}});
test('representative URLs classify without starting playback',()=>{assert.equal(getPlatformAdapter('spotify').classifyInput('https://open.spotify.com/artist/abc'),'artist'); assert.equal(getPlatformAdapter('youtube-music').classifyInput('https://music.youtube.com/playlist?list=x'),'playlist'); assert.equal(getPlatformAdapter('soundcloud').classifyInput('test query'),'search');});

test('platform adapters build platform-appropriate catalog search URLs',()=>{
  assert.match(getPlatformAdapter('spotify').buildSearchUrl('tems higher'),/^https:\/\/open\.spotify\.com\/search\//);
  assert.match(getPlatformAdapter('youtube-music').buildSearchUrl('tems higher'),/^https:\/\/music\.youtube\.com\/search\?/);
  assert.match(getPlatformAdapter('soundcloud').buildSearchUrl('tems higher'),/^https:\/\/soundcloud\.com\/search\?/);
});

test('catalog warm-up scrolls collection pages to reveal lazy-loaded tracks without clicking anything',async()=>{
  const {warmCatalogPage}=require('./adapters/_factory.cjs');
  const actions=[];
  const page={evaluate:async(fn,arg)=>{actions.push(String(fn).includes('scrollTo')?'scroll':'evaluate');},waitForTimeout:async ms=>actions.push(`wait:${ms}`)};
  await warmCatalogPage(page,'artist');
  assert.ok(actions.filter(x=>x==='scroll').length>=2);
  assert.equal(actions.some(x=>String(x).startsWith('wait:')),true);
});

test('session verification warns when platform still exposes a visible login control',async()=>{
  const adapter=getPlatformAdapter('spotify');
  const visible={first:()=>({isVisible:async()=>true})};
  const page={url:()=> 'https://open.spotify.com/track/x',getByRole:()=>visible};
  const out=await adapter.verifySession({page,account:{authMode:'session'}});
  assert.equal(out.status,'WARNING');
});

test('generic catalog link filter accepts real track URLs and rejects album or navigation URLs',()=>{
  const {isTrackLikeUrl}=require('./adapters/_factory.cjs');
  const yes=[
    ['spotify','https://open.spotify.com/track/abc123'],
    ['youtube-music','https://music.youtube.com/watch?v=abc123'],
    ['soundcloud','https://soundcloud.com/artist-name/song-name'],
    ['deezer','https://www.deezer.com/en/track/12345'],
    ['tidal','https://tidal.com/browse/track/12345'],
    ['audiomack','https://audiomack.com/artist/song/song-name'],
    ['pandora','https://www.pandora.com/artist/name/track/song/TR123'],
  ];
  for(const [platform,url] of yes) assert.equal(isTrackLikeUrl(platform,url),true,`${platform} should accept ${url}`);
  const no=[
    ['spotify','https://open.spotify.com/album/abc123'],
    ['youtube-music','https://music.youtube.com/playlist?list=abc123'],
    ['soundcloud','https://soundcloud.com/artist-name'],
    ['deezer','https://www.deezer.com/en/album/12345'],
    ['tidal','https://tidal.com/browse/album/12345'],
    ['audiomack','https://audiomack.com/artist/album/album-name'],
    ['pandora','https://www.pandora.com/artist/name/album/AL123'],
  ];
  for(const [platform,url] of no) assert.equal(isTrackLikeUrl(platform,url),false,`${platform} should reject ${url}`);
});

test('direct track import preserves the exact pasted URL even when the page exposes no other track anchors',async()=>{
  const adapter=getPlatformAdapter('deezer');
  const input='https://www.deezer.com/en/track/12345';
  const page={evaluate:async()=> 'Track Title'};
  const result=await adapter.resolveCatalog({input,page});
  assert.equal(result.kind,'track');
  assert.equal(result.tracks.length,1);
  assert.equal(result.tracks[0].url,input);
});

test('SoundCloud direct song and set URLs classify correctly and preserve a pasted song URL',async()=>{
  const adapter=getPlatformAdapter('soundcloud');
  const song='https://soundcloud.com/artist-name/song-name';
  const set='https://soundcloud.com/artist-name/sets/playlist-name';
  assert.equal(adapter.classifyInput(song),'track');
  assert.equal(adapter.classifyInput(set),'playlist');
  const page={evaluate:async()=> 'SoundCloud Song'};
  const result=await adapter.resolveCatalog({input:song,page});
  assert.equal(result.kind,'track');
  assert.deepEqual(result.tracks.map(t=>t.url),[song]);
});

test('every streaming platform adapter exposes an account authenticate function',()=>{
  for(const adapter of listPlatformAdapters()) assert.equal(typeof adapter.authenticate,'function',`${adapter.id}.authenticate`);
});

test('playback control treats an already-playing track as PASS when a visible Pause control is present',async()=>{
  const invisible={first:()=>({isVisible:async()=>false})};
  const pause={first:()=>({isVisible:async()=>true})};
  const page={
    getByRole:(_role,{name}={})=>String(name).includes('pause')?pause:invisible,
    locator:()=>invisible,
    evaluate:async()=>false,
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
});

test('platform adapters know the primary Play control shapes for all supported services and confirm playback actually started',async()=>{
  const expected={
    spotify:'button[data-testid="control-button-playpause"]',
    'youtube-music':'#play-pause-button',
    soundcloud:'.playControl',
    deezer:'button[data-testid*="play" i]',
    tidal:'button[data-test*="play" i]',
    audiomack:'button[aria-label*="play" i]',
    pandora:'button[data-qa*="play" i]',
  };
  for(const [platform,selector] of Object.entries(expected)){
    let clicked=false; let playing=false;
    const hidden={first:()=>({isVisible:async()=>false})};
    const visible={first:()=>({isVisible:async()=>true,click:async()=>{clicked=true;playing=true;}})};
    const page={
      bringToFront:async()=>{},
      getByRole:(_role,{name}={})=>String(name).includes('pause')&&playing?{first:()=>({isVisible:async()=>true})}:hidden,
      locator:value=>String(value)===selector?visible:hidden,
      evaluate:async()=>playing,
      waitForTimeout:async()=>{},
    };
    const controls=await getPlatformAdapter(platform).playbackControls({page});
    const result=await controls.play();
    assert.equal(result.status,'PASS',platform);
    assert.equal(clicked,true,`${platform} should click its primary Play control`);
    assert.match(result.reason||'',/confirmed|active/i,`${platform} should only pass after playback evidence`);
  }
});

test('Play click is not reported as PASS when the player remains paused',async()=>{
  let clicked=0;
  const hidden={first:()=>({isVisible:async()=>false})};
  const visible={first:()=>({isVisible:async()=>true,click:async()=>{clicked++;}})};
  const page={
    bringToFront:async()=>{},
    getByRole:()=>hidden,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?visible:hidden,
    evaluate:async()=>false,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.ok(clicked>=1,'OrbitQA should attempt the visible Play control');
  assert.notEqual(result.status,'PASS','a click without playback evidence must not be counted as playing');
  assert.match(result.reason||'',/did not start|not.*start|paused/i);
});

test('Play activation tries another safe Play control when the first visible control does not start audio',async()=>{
  let primaryClicks=0; let roleClicks=0; let playing=false;
  const hidden={first:()=>({isVisible:async()=>false})};
  const primary={first:()=>({isVisible:async()=>true,click:async()=>{primaryClicks++;}})};
  const rolePlay={first:()=>({isVisible:async()=>true,click:async()=>{roleClicks++;playing=true;}})};
  const pause={first:()=>({isVisible:async()=>playing})};
  const page={
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>String(name).includes('pause')?pause:rolePlay,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?primary:hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.equal(primaryClicks,1);
  assert.equal(roleClicks,1,'OrbitQA should try another safe Play control after an ineffective click');
  assert.equal(result.status,'PASS');
  assert.equal(playing,true);
});

test('QA music selection opens the saved album link first, finds a saved song on that page, and opens that song before playback',async()=>{
  const adapter=getPlatformAdapter('spotify');
  const albumUrl='https://open.spotify.com/album/album123';
  const song1='https://open.spotify.com/track/song111';
  const song2='https://open.spotify.com/track/song222';
  let currentUrl='about:blank';
  const gotos=[];
  const clicks=[];
  const anchors=[
    {href:'/track/song111',visible:true},
    {href:'/track/song222',visible:true},
  ];
  const anchorLocator={
    count:async()=>anchors.length,
    nth:index=>({
      getAttribute:async name=>name==='href'?anchors[index].href:null,
      isVisible:async()=>anchors[index].visible,
      click:async()=>{const absolute=new URL(anchors[index].href,currentUrl).toString(); clicks.push(absolute); currentUrl=absolute;},
    }),
  };
  const page={
    url:()=>currentUrl,
    goto:async url=>{currentUrl=String(url);gotos.push(currentUrl);},
    locator:selector=>selector==='a[href]'?anchorLocator:{first:()=>({isVisible:async()=>false})},
    getByRole:()=>({first:()=>({isVisible:async()=>false})}),
    waitForTimeout:async()=>{},
    evaluate:async fn=>{
      const source=String(fn);
      if(source.includes('document.querySelectorAll(\'a[href]\')')) return {title:'Album',bodyText:'',links:anchors.map(row=>({href:new URL(row.href,currentUrl).toString(),text:'Saved song'})),json:[]};
      return undefined;
    },
  };
  const selection={id:'album-1',name:'Saved Album',platform:'spotify',sourceKind:'album',sourceInput:albumUrl,tracks:[
    {id:'s1',platform:'spotify',title:'Song 1',url:song1},
    {id:'s2',platform:'spotify',title:'Song 2',url:song2},
  ]};
  const result=await adapter.openMusicSelection({page,selection,preferredTrack:selection.tracks[1]});
  assert.equal(gotos[0],albumUrl,'the saved QA MUSIC SELECTION link must open before a song');
  assert.equal(result.status,'PASS');
  assert.equal(result.track.id,'s2');
  assert.deepEqual(clicks,[song2],'OrbitQA should choose a saved song link from inside the opened album page');
  assert.equal(currentUrl,song2);
});

test('all seven platform adapters can open a saved collection link and select a saved song from that page',async()=>{
  const cases=[
    ['spotify','https://open.spotify.com/album/alb1','https://open.spotify.com/track/trk1'],
    ['youtube-music','https://music.youtube.com/playlist?list=PL1','https://music.youtube.com/watch?v=vid1'],
    ['soundcloud','https://soundcloud.com/artist/sets/mix','https://soundcloud.com/artist/song-one'],
    ['deezer','https://www.deezer.com/en/album/10','https://www.deezer.com/en/track/11'],
    ['tidal','https://tidal.com/browse/album/10','https://tidal.com/browse/track/11'],
    ['audiomack','https://audiomack.com/artist/album/album-one','https://audiomack.com/artist/song/song-one'],
    ['pandora','https://www.pandora.com/artist/name/album/name/AL123','https://www.pandora.com/artist/name/track/song/TR123'],
  ];
  for(const [platform,sourceUrl,trackUrl] of cases){
    const adapter=getPlatformAdapter(platform);
    let currentUrl='about:blank';
    const clicks=[];
    const rawHref=new URL(trackUrl).pathname+new URL(trackUrl).search;
    const anchorLocator={count:async()=>1,nth:()=>({getAttribute:async()=>rawHref,isVisible:async()=>true,click:async()=>{currentUrl=trackUrl;clicks.push(trackUrl);}})};
    const page={
      url:()=>currentUrl,
      goto:async url=>{currentUrl=String(url);},
      locator:selector=>selector==='a[href]'?anchorLocator:{first:()=>({isVisible:async()=>false})},
      getByRole:()=>({first:()=>({isVisible:async()=>false})}),
      waitForTimeout:async()=>{},
      evaluate:async fn=>String(fn).includes("document.querySelectorAll('a[href]')")?{title:'Saved music',bodyText:'',links:[{href:trackUrl,text:'Saved song'}],json:[]}:undefined,
    };
    const track={id:`${platform}-song`,platform,title:'Saved song',url:trackUrl};
    const selection={id:`${platform}-source`,name:'Saved music',platform,sourceKind:'album',sourceInput:sourceUrl,tracks:[track]};
    const result=await adapter.openMusicSelection({page,selection,preferredTrack:track});
    assert.equal(result.status,'PASS',platform);
    assert.equal(result.track.id,track.id,platform);
    assert.deepEqual(clicks,[trackUrl],`${platform} should choose the saved song from the opened source page`);
  }
});

test('direct saved song QA selection opens that exact saved song link before pressing Play',async()=>{
  const adapter=getPlatformAdapter('deezer');
  const songUrl='https://www.deezer.com/en/track/12345';
  let currentUrl='about:blank'; const gotos=[];
  const page={url:()=>currentUrl,goto:async url=>{currentUrl=String(url);gotos.push(currentUrl);},waitForTimeout:async()=>{},locator:()=>({first:()=>({isVisible:async()=>false})}),getByRole:()=>({first:()=>({isVisible:async()=>false})})};
  const track={id:'d1',platform:'deezer',title:'Saved song',url:songUrl};
  const result=await adapter.openMusicSelection({page,selection:{id:'song-1',name:'Saved song',platform:'deezer',sourceKind:'track',sourceInput:songUrl,tracks:[track]},preferredTrack:track});
  assert.equal(result.status,'PASS');
  assert.equal(result.track.id,'d1');
  assert.deepEqual(gotos,[songUrl]);
});

test('Play activation falls back to a real touch tap when mouse clicking the visible control is intercepted',async()=>{
  let clickAttempts=0; let tapAttempts=0; let playing=false;
  const hidden={first:()=>({isVisible:async()=>false})};
  const primary={first:()=>({
    isVisible:async()=>true,
    click:async()=>{clickAttempts++;throw new Error('overlay intercepts pointer events');},
    tap:async()=>{tapAttempts++;playing=true;},
  })};
  const pause={first:()=>({isVisible:async()=>playing})};
  const page={
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>String(name).includes('pause')?pause:hidden,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?primary:hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(clickAttempts,1);
  assert.equal(tapAttempts,1);
  assert.match(result.reason||'',/tap|playback confirmed/i);
});

test('Play activation falls back to focused keyboard activation when pointer input cannot activate the control',async()=>{
  let focused=false; let keyPresses=[]; let playing=false;
  const hidden={first:()=>({isVisible:async()=>false})};
  const primary={first:()=>({
    isVisible:async()=>true,
    click:async()=>{throw new Error('not clickable');},
    tap:async()=>{throw new Error('tap unavailable');},
    focus:async()=>{focused=true;},
  })};
  const pause={first:()=>({isVisible:async()=>playing})};
  const page={
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>String(name).includes('pause')?pause:hidden,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?primary:hidden,
    keyboard:{press:async key=>{keyPresses.push(key);if(focused&&key==='Enter')playing=true;}},
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(focused,true);
  assert.deepEqual(keyPresses,['Enter']);
  assert.match(result.reason||'',/keyboard|enter|confirmed/i);
});

test('Spotify playback failure reports protected-media readiness instead of retrying an unclickable player blindly',async()=>{
  const hidden={first:()=>({isVisible:async()=>false})};
  const primary={first:()=>({isVisible:async()=>true,click:async()=>{throw new Error('not clickable');},tap:async()=>{throw new Error('not tappable');},focus:async()=>{}})};
  const page={
    bringToFront:async()=>{},
    getByRole:()=>hidden,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?primary:hidden,
    keyboard:{press:async()=>{}},
    evaluate:async fn=>String(fn).includes('requestMediaKeySystemAccess')?{eme:true,widevine:'unavailable',secureContext:true,error:'NotSupportedError'}:false,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page});
  const result=await controls.play();
  assert.notEqual(result.status,'PASS');
  assert.match(result.reason||'',/protected|widevine|drm/i);
});

test('Play activation skips a hidden first match and clicks a later visible Play control',async()=>{
  let clicked=false; let playing=false;
  const hiddenItem={isVisible:async()=>false};
  const visibleItem={isVisible:async()=>true,click:async()=>{clicked=true;playing=true;}};
  const multi={
    first:()=>hiddenItem,
    count:async()=>2,
    nth:index=>index===0?hiddenItem:visibleItem,
  };
  const hidden={first:()=>({isVisible:async()=>false}),count:async()=>1,nth:()=>({isVisible:async()=>false})};
  const page={
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>String(name).includes('pause')&&playing?{first:()=>({isVisible:async()=>true}),count:async()=>1,nth:()=>({isVisible:async()=>true})}:hidden,
    locator:value=>String(value)==='button[data-testid="control-button-playpause"]'?multi:hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page,track:{title:'I Was Talking To You'}});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(clicked,true,'OrbitQA must continue past hidden Spotify Play matches to the visible control');
});

test('Spotify search playback targets the Play control belonging to the selected track title',async()=>{
  let selectedClicks=0; let genericClicks=0; let playing=false;
  const hidden={first:()=>({isVisible:async()=>false}),count:async()=>1,nth:()=>({isVisible:async()=>false})};
  const selected={first:()=>({isVisible:async()=>true,click:async()=>{selectedClicks++;playing=true;}}),count:async()=>1,nth:()=>({isVisible:async()=>true,click:async()=>{selectedClicks++;playing=true;}})};
  const generic={first:()=>({isVisible:async()=>true,click:async()=>{genericClicks++;}}),count:async()=>1,nth:()=>({isVisible:async()=>true,click:async()=>{genericClicks++;}})};
  const page={
    url:()=> 'https://open.spotify.com/search/Breny%20Vale%20I%20Was%20Talking%20To%20You',
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>{
      const pattern=String(name||'');
      if(pattern.includes('pause'))return playing?{first:()=>({isVisible:async()=>true}),count:async()=>1,nth:()=>({isVisible:async()=>true})}:hidden;
      if(pattern.includes('I Was Talking To You'))return selected;
      if(pattern.includes('play')||pattern.includes('resume'))return generic;
      return hidden;
    },
    locator:()=>hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page,track:{title:'I Was Talking To You',artist:'Breny Vale'}});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(selectedClicks,1,'the selected search-result Play control should be activated');
  assert.equal(genericClicks,0,'OrbitQA must not click an unrelated generic Spotify Play control first');
});

test('a visible but disabled Spotify Pause control is not treated as active playback',async()=>{
  let selectedClicks=0; let playing=false;
  const disabledPauseItem={isVisible:async()=>true,isEnabled:async()=>false};
  const disabledPause={first:()=>disabledPauseItem,count:async()=>1,nth:()=>disabledPauseItem};
  const selectedItem={isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{selectedClicks++;playing=true;}};
  const selected={first:()=>selectedItem,count:async()=>1,nth:()=>selectedItem};
  const hiddenItem={isVisible:async()=>false,isEnabled:async()=>true};
  const hidden={first:()=>hiddenItem,count:async()=>1,nth:()=>hiddenItem};
  const page={
    url:()=> 'https://open.spotify.com/search/Breny%20Vale%20I%20Was%20Talking%20To%20You',
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>{
      const pattern=String(name||'');
      if(pattern.includes('pause'))return playing?{first:()=>({isVisible:async()=>true,isEnabled:async()=>true}),count:async()=>1,nth:()=>({isVisible:async()=>true,isEnabled:async()=>true})}:disabledPause;
      if(pattern.includes('I Was Talking To You'))return selected;
      return hidden;
    },
    locator:()=>hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page,track:{title:'I Was Talking To You',artist:'Breny Vale'}});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(selectedClicks,1,'disabled global Pause must not prevent clicking the selected song Play control');
});

test('Spotify can bind a generic green Play button to the selected result card by nearby song title',async()=>{
  let clicked=0; let playing=false;
  const hiddenItem={isVisible:async()=>false,isEnabled:async()=>true};
  const hidden={first:()=>hiddenItem,count:async()=>1,nth:()=>hiddenItem};
  const selectedItem={isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{clicked++;playing=true;}};
  const selected={first:()=>selectedItem,count:async()=>1,nth:()=>selectedItem};
  const page={
    url:()=> 'https://open.spotify.com/search/Breny%20Vale%20I%20Was%20Talking%20To%20You',
    bringToFront:async()=>{},
    getByRole:()=>hidden,
    locator:selector=>String(selector).includes('data-orbitqa-selected-track-play')?selected:hidden,
    evaluate:async(fn,args)=>{
      if(args?.attr==='data-orbitqa-selected-track-play')return true;
      if(args?.attr==='data-orbitqa-selected-track-pause')return false;
      return playing;
    },
    waitForTimeout:async()=>{},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page,track:{title:'I Was Talking To You',artist:'Breny Vale'}});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(clicked,1,'the green Play control inside the selected song card should be clicked');
});

test('Spotify waits for the selected result-card Play control to become visible and enabled before activating it',async()=>{
  let readinessTicks=0; let selectedClicks=0; let genericClicks=0; let playing=false;
  const hiddenItem={isVisible:async()=>false,isEnabled:async()=>true};
  const hidden={first:()=>hiddenItem,count:async()=>1,nth:()=>hiddenItem};
  const selectedItem={
    isVisible:async()=>readinessTicks>=2,
    isEnabled:async()=>readinessTicks>=2,
    click:async()=>{selectedClicks++;playing=true;},
  };
  const selected={first:()=>selectedItem,count:async()=>1,nth:()=>selectedItem};
  const genericItem={isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{genericClicks++;}};
  const generic={first:()=>genericItem,count:async()=>1,nth:()=>genericItem};
  const page={
    url:()=> 'https://open.spotify.com/search/Breny%20Vale%20My%20Own%20Time',
    bringToFront:async()=>{},
    getByRole:(_role,{name}={})=>{
      const pattern=String(name||'');
      if(pattern.includes('pause'))return playing?{first:()=>({isVisible:async()=>true,isEnabled:async()=>true}),count:async()=>1,nth:()=>({isVisible:async()=>true,isEnabled:async()=>true})}:hidden;
      if(pattern.includes('My Own Time'))return selected;
      if(pattern.includes('play')||pattern.includes('resume'))return generic;
      return hidden;
    },
    locator:selector=>String(selector).includes('control-button-playpause')?generic:hidden,
    evaluate:async()=>playing,
    waitForTimeout:async()=>{readinessTicks++;},
  };
  const controls=await getPlatformAdapter('spotify').playbackControls({page,track:{title:'My Own Time',artist:'Breny Vale'}});
  const result=await controls.play();
  assert.equal(result.status,'PASS');
  assert.equal(selectedClicks,1,'OrbitQA should wait for and activate the selected song card');
  assert.equal(genericClicks,0,'OrbitQA must not hammer a generic Spotify Play control while the selected result is still rendering');
  assert.ok(readinessTicks>=3,'the selected control must be stable across readiness polls before activation');
});
