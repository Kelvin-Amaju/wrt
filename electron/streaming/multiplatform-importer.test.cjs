const test=require('node:test');
const assert=require('node:assert/strict');
const platformRegistry=require('./platform-adapter.cjs');
const factory=require('./adapters/_factory.cjs');

const detectionCases=[
  ['https://open.spotify.com/album/abc','spotify'],
  ['https://music.youtube.com/playlist?list=PL123','youtube-music'],
  ['https://youtu.be/abc123','youtube-music'],
  ['https://soundcloud.com/artist/sets/mix-name','soundcloud'],
  ['https://on.soundcloud.com/AbCdEf','soundcloud'],
  ['https://www.deezer.com/en/album/12345','deezer'],
  ['https://link.deezer.com/s/abc123','deezer'],
  ['https://tidal.com/browse/album/12345','tidal'],
  ['https://listen.tidal.com/album/12345','tidal'],
  ['https://audiomack.com/artist/album/album-name','audiomack'],
  ['https://www.pandora.com/artist/name/album/AL123','pandora'],
];

test('detects the streaming platform directly from pasted URLs',()=>{
  assert.equal(typeof platformRegistry.detectPlatformFromInput,'function');
  for(const [url,expected] of detectionCases){
    assert.equal(platformRegistry.detectPlatformFromInput(url),expected,`detect ${url}`);
  }
  assert.equal(platformRegistry.detectPlatformFromInput('https://example.com/not-music'),null);
});

test('classifies locale-prefixed and real-world collection URL shapes',()=>{
  assert.equal(platformRegistry.getPlatformAdapter('youtube-music').classifyInput('https://music.youtube.com/playlist?list=PL123'),'playlist');
  assert.equal(platformRegistry.getPlatformAdapter('deezer').classifyInput('https://www.deezer.com/us/album/12345'),'album');
  assert.equal(platformRegistry.getPlatformAdapter('tidal').classifyInput('https://tidal.com/browse/playlist/abc-def'),'playlist');
  assert.equal(platformRegistry.getPlatformAdapter('pandora').classifyInput('https://www.pandora.com/artist/name/album/album-name/AL123'),'album');
});

const snapshots={
  'youtube-music':{
    title:'Test playlist - YouTube Music',
    links:[],
    json:[{
      contents:[
        {musicResponsiveListItemRenderer:{flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'YT Song One'}]}}}],playlistItemData:{videoId:'ytOne'}}},
        {musicResponsiveListItemRenderer:{flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'YT Song Two'}]}}}],playlistItemData:{videoId:'ytTwo'}}},
      ]
    }]
  },
  soundcloud:{
    title:'SoundCloud Set',links:[],json:[{
      hydratable:'playlist',data:{tracks:[
        {id:11,title:'SC One',permalink_url:'https://soundcloud.com/demo/sc-one',user:{username:'Demo'}},
        {id:12,title:'SC Two',permalink_url:'https://soundcloud.com/demo/sc-two',user:{username:'Demo'}},
      ]}
    }]
  },
  deezer:{
    title:'Deezer Album',links:[],json:[{DATA:{SONGS:{data:[
      {id:21,title:'DZ One',link:'https://www.deezer.com/track/21',artist:{name:'Artist A'}},
      {id:22,title:'DZ Two',link:'https://www.deezer.com/track/22',artist:{name:'Artist A'}},
    ]}}}]
  },
  tidal:{
    title:'TIDAL Album',links:[],json:[{album:{items:[
      {type:'TRACK',item:{id:31,title:'Tidal One',artists:[{name:'Artist T'}]}},
      {type:'TRACK',item:{id:32,title:'Tidal Two',artists:[{name:'Artist T'}]}},
    ]}}]
  },
  audiomack:{
    title:'Audiomack Album',links:[],json:[{props:{pageProps:{songs:[
      {id:41,title:'AM One',url:'https://audiomack.com/demo/song/am-one',artist_name:'Demo'},
      {id:42,title:'AM Two',url:'https://audiomack.com/demo/song/am-two',artist_name:'Demo'},
    ]}}}]
  },
  pandora:{
    title:'Pandora Album',links:[
      {href:'https://www.pandora.com/artist/billy-cobham/drum-n-voice/electric-man/TRXb2wXlw9KVn9g',text:'Electric Man'},
      {href:'https://www.pandora.com/artist/billy-cobham/drum-n-voice/another-song/TRABC123',text:'Another Song'},
    ],json:[]
  }
};

const sourceInputs={
  'youtube-music':'https://music.youtube.com/playlist?list=PL123',
  soundcloud:'https://soundcloud.com/demo/sets/test-set',
  deezer:'https://www.deezer.com/en/album/12345',
  tidal:'https://tidal.com/browse/album/12345',
  audiomack:'https://audiomack.com/demo/album/test-album',
  pandora:'https://www.pandora.com/artist/billy-cobham/drum-n-voice/ALBUM123',
};

test('service-aware snapshot extraction finds real track URLs for all six non-Spotify platforms',()=>{
  assert.equal(typeof factory.extractTracksFromSnapshot,'function');
  for(const platform of Object.keys(snapshots)){
    const tracks=factory.extractTracksFromSnapshot(platform,snapshots[platform],sourceInputs[platform]);
    assert.equal(tracks.length,2,`${platform} should return two tracks`);
    for(const track of tracks){
      assert.ok(track.title,`${platform} track has title`);
      assert.ok(track.url,`${platform} track has URL`);
      assert.equal(factory.isTrackLikeUrl(platform,track.url),true,`${platform} URL should be a track URL: ${track.url}`);
    }
  }
});

test('direct track imports preserve the exact pasted URL for every supported non-Spotify platform',()=>{
  const cases={
    'youtube-music':'https://music.youtube.com/watch?v=ytOne',
    soundcloud:'https://soundcloud.com/demo/sc-one',
    deezer:'https://www.deezer.com/en/track/21',
    tidal:'https://tidal.com/browse/track/31',
    audiomack:'https://audiomack.com/demo/song/am-one',
    pandora:'https://www.pandora.com/artist/demo/album/song/TRABC123',
  };
  assert.equal(typeof factory.extractTracksFromSnapshot,'function');
  for(const [platform,input] of Object.entries(cases)){
    const tracks=factory.extractTracksFromSnapshot(platform,{title:'Direct Track',links:[],json:[]},input);
    assert.equal(tracks.length,1,platform);
    assert.equal(tracks[0].url,input,platform);
  }
});

test('catalog block detection explains region and consent pages instead of silently returning zero songs',()=>{
  assert.equal(typeof factory.catalogBlockReason,'function');
  assert.match(factory.catalogBlockReason('pandora',{title:'Pandora',bodyText:'Pandora is unavailable in this country or region'}),/country|region/i);
  assert.match(factory.catalogBlockReason('youtube-music',{title:'Before you continue to YouTube',bodyText:'Accept all Reject all'}),/consent|continue|cookie/i);
  assert.equal(factory.catalogBlockReason('deezer',{title:'Album',bodyText:'Track list'}),null);
});

test('YouTube Music catalog helper can dismiss the standard consent gate before extraction',async()=>{
  assert.equal(typeof factory.dismissCatalogConsent,'function');
  let clicked=false;
  const control={first:()=>({isVisible:async()=>true,click:async()=>{clicked=true;}})};
  const page={getByRole:(_role,{name})=>String(name).includes('Reject')||name instanceof RegExp?control:null,waitForTimeout:async()=>{}};
  const out=await factory.dismissCatalogConsent(page,'youtube-music');
  assert.equal(out,true);
  assert.equal(clicked,true);
});

test('catalog response capture keeps JSON payloads received while a music page loads',async()=>{
  assert.equal(typeof factory.createCatalogResponseCapture,'function');
  let handler=null;
  const page={on:(event,fn)=>{if(event==='response')handler=fn;},off:()=>{handler=null;}};
  const capture=factory.createCatalogResponseCapture(page);
  assert.equal(typeof handler,'function');
  await handler({
    url:()=> 'https://listen.tidal.com/api/album/1/items',
    allHeaders:async()=>({'content-type':'application/json','content-length':'120'}),
    json:async()=>({items:[{id:77,title:'Captured Song',url:'https://tidal.com/browse/track/77',artists:[{name:'Artist'}]}]}),
  });
  assert.equal(capture.json.length,1);
  assert.equal(capture.json[0].items[0].id,77);
  capture.stop();
  assert.equal(handler,null);
});

test('all six non-Spotify adapters resolve collection snapshots end-to-end',async()=>{
  for(const platform of Object.keys(snapshots)){
    const page={
      evaluate:async(fn)=>String(fn).includes("querySelectorAll('a[href]')")?snapshots[platform]:undefined,
      waitForTimeout:async()=>{},
      getByRole:()=>({first:()=>({isVisible:async()=>false})}),
    };
    const adapter=platformRegistry.getPlatformAdapter(platform);
    const out=await adapter.resolveCatalog({input:sourceInputs[platform],page});
    assert.equal(out.tracks.length,2,`${platform} adapter should resolve two tracks`);
    assert.ok(out.tracks.every(track=>track.url),`${platform} tracks should keep URLs`);
  }
});

test('real shared/redirected music URLs use the final canonical same-service URL',()=>{
  assert.equal(typeof platformRegistry.resolveCatalogInput,'function');
  const cases=[
    [
      'https://on.soundcloud.com/vRZLexdt0knIE24kdK',
      'https://soundcloud.com/stillwavemusic/you-only-love-me-when-im-leaving-music-2?utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing&si=6ba686f2bcbd4511a4768a93a1ccd40f',
      'https://soundcloud.com/stillwavemusic/you-only-love-me-when-im-leaving-music-2'
    ],
    ['https://tidal.com/browse/album/308700727','https://tidal.com/album/308700727','https://tidal.com/album/308700727'],
    ['https://link.deezer.com/s/example','https://www.deezer.com/en/album/1067322921','https://www.deezer.com/en/album/1067322921'],
    ['https://amk.to/example','https://audiomack.com/jhene-aiko/album/westside-whimsy-2984017','https://audiomack.com/jhene-aiko/album/westside-whimsy-2984017'],
    ['https://youtu.be/8SbUC-UaAxE?si=share123','https://music.youtube.com/watch?v=8SbUC-UaAxE&feature=share','https://music.youtube.com/watch?v=8SbUC-UaAxE'],
    ['https://www.pandora.com/artist/billy-cobham/drum-n-voice-the-definitive-collection/electric-man-feat-brian-auger/TRXb2wXlw9KVn9g','https://www.pandora.com/restricted','https://www.pandora.com/artist/billy-cobham/drum-n-voice-the-definitive-collection/electric-man-feat-brian-auger/TRXb2wXlw9KVn9g'],
  ];
  for(const [original,finalUrl,expected] of cases){
    assert.equal(platformRegistry.resolveCatalogInput(original,finalUrl),expected,original);
  }
});

test('real public music URLs found in live service pages classify correctly',()=>{
  const cases=[
    ['soundcloud','https://soundcloud.com/goncalo-vitorino-359198242/sets/sets','playlist'],
    ['youtube-music','https://music.youtube.com/playlist/olak5uy_njb3-m0uwid3w_vwyotju_ruq-npnpsp4','playlist'],
    ['deezer','https://www.deezer.com/en/album/1067322921','album'],
    ['tidal','https://tidal.com/album/308700727','album'],
    ['audiomack','https://audiomack.com/jhene-aiko/album/westside-whimsy-2984017','album'],
    ['pandora','https://www.pandora.com/artist/billy-cobham/drum-n-voice-the-definitive-collection/electric-man-feat-brian-auger/TRXb2wXlw9KVn9g','track'],
  ];
  for(const [platform,url,kind] of cases){
    assert.equal(platformRegistry.detectPlatformFromInput(url),platform,url);
    assert.equal(platformRegistry.getPlatformAdapter(platform).classifyInput(url),kind,url);
  }
});

test('real live page track URL shapes are accepted by their service extractors',()=>{
  const snapshots={
    soundcloud:{title:'Sets by Gonçalo Vitorino',links:[{href:'https://soundcloud.com/hannahlaingdj/hannah-laing-creamfields-2025-apex',text:'Hannah Laing Creamfields 2025 Apex'}],json:[]},
    deezer:{title:'Restart Rotation: Pop and R & B',links:[{href:'https://www.deezer.com/en/track/4256749241',text:'Trip'}],json:[]},
    audiomack:{title:'Westside Whimsy',links:[],json:[{songs:[{id:5852054,title:'Mine',url:'https://audiomack.com/jhene-aiko/song/mine-5852054',artist_name:'Jhené Aiko'}]}]},
    'youtube-music':{title:'YouTube Music',links:[{href:'https://music.youtube.com/watch?v=8SbUC-UaAxE&list=PL-FMlqaZ9yoVwGUyLbZyF8JpSztfKeo2X',text:'November Rain'}],json:[]},
    tidal:{title:'Live at Woodstock 1994',links:[{href:'https://tidal.com/browse/track/78362249',text:'Unchain My Heart (LIVE)'}],json:[]},
  };
  const source={
    soundcloud:'https://soundcloud.com/goncalo-vitorino-359198242/sets/sets',
    deezer:'https://www.deezer.com/en/album/1067322921',
    audiomack:'https://audiomack.com/jhene-aiko/album/westside-whimsy-2984017',
    'youtube-music':'https://music.youtube.com/playlist/olak5uy_njb3-m0uwid3w_vwyotju_ruq-npnpsp4',
    tidal:'https://tidal.com/album/308700727',
  };
  for(const [platform,snapshot] of Object.entries(snapshots)){
    const tracks=factory.extractTracksFromSnapshot(platform,snapshot,source[platform]);
    assert.ok(tracks.length>=1,`${platform} should resolve at least one real-world track shape`);
    assert.equal(factory.isTrackLikeUrl(platform,tracks[0].url),true,`${platform}: ${tracks[0].url}`);
  }
});

test('dynamic music pages get a second extraction pass when the first snapshot is empty',async()=>{
  let snapshots=0;
  const realTrack='https://www.deezer.com/en/track/4256749241';
  const page={
    evaluate:async(fn)=>{
      if(!String(fn).includes("querySelectorAll('a[href]')")) return undefined;
      snapshots+=1;
      if(snapshots===1) return {title:'Loading album',bodyText:'',links:[],json:[]};
      return {title:'Restart Rotation: Pop and R & B',bodyText:'Trip',links:[{href:realTrack,text:'Trip'}],json:[]};
    },
    waitForTimeout:async()=>{},
    getByRole:()=>({first:()=>({isVisible:async()=>false})}),
  };
  const adapter=platformRegistry.getPlatformAdapter('deezer');
  const out=await adapter.resolveCatalog({input:'https://www.deezer.com/en/album/1067322921',page});
  assert.ok(snapshots>=2,'should scan again after an empty first render');
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,realTrack);
});

test('Deezer share link can use a canonical album hint when the share landing page does not fully redirect',()=>{
  assert.equal(typeof platformRegistry.resolveCatalogInputWithHints,'function');
  const input='https://link.deezer.com/s/34qBFbdREYM0STSckr3SU';
  const resolved=platformRegistry.resolveCatalogInputWithHints(input,input,[
    'https://www.deezer.com/en/album/1037333712',
    'https://example.com/not-music'
  ]);
  assert.equal(resolved,'https://www.deezer.com/en/album/1037333712');
});

test('Deezer canonical album uses public catalog fallback when the rendered page is empty',async()=>{
  const page={evaluate:async()=>({title:'Deezer',bodyText:'',links:[],json:[]}),waitForTimeout:async()=>{},getByRole:()=>({first:()=>({isVisible:async()=>false})})};
  const adapter=platformRegistry.getPlatformAdapter('deezer');
  const out=await adapter.resolveCatalog({input:'https://www.deezer.com/en/album/1037333712',page,fetchJson:async url=>{
    assert.equal(url,'https://api.deezer.com/album/1037333712');
    return {tracks:{data:[{id:4256749241,title:'Trip',artist:{name:'Artist'},duration:180}]}};
  }});
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://www.deezer.com/track/4256749241');
});

test('the exact YouTube Music artist handle falls back to the public channel videos page',async()=>{
  let current='music'; const gotos=[];
  const page={
    goto:async url=>{gotos.push(url);current='youtube';},
    evaluate:async fn=>String(fn).includes("querySelectorAll('a[href]')")?(current==='youtube'?{title:'Lume Afro - YouTube',bodyText:'',links:[{href:'https://www.youtube.com/watch?v=h5I4UgTyLSY',text:'Praise (Afro Soul)'}],json:[]}:{title:'YouTube Music',bodyText:'',links:[],json:[]}):undefined,
    waitForTimeout:async()=>{},getByRole:()=>({first:()=>({isVisible:async()=>false})}),
  };
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const out=await adapter.resolveCatalog({input:'https://music.youtube.com/@lumeafro?si=ONn15lpEh_JAOuZ1',page});
  assert.deepEqual(gotos,['https://www.youtube.com/@lumeafro/videos']);
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://www.youtube.com/watch?v=h5I4UgTyLSY');
});

test('TIDAL network JSON API resources resolve even when the rendered album page has no track links',async()=>{
  const page={evaluate:async()=>({title:'TIDAL',bodyText:'',links:[],json:[]}),waitForTimeout:async()=>{},getByRole:()=>({first:()=>({isVisible:async()=>false})})};
  const adapter=platformRegistry.getPlatformAdapter('tidal');
  const out=await adapter.resolveCatalog({input:'https://tidal.com/album/308700727',page,networkJson:[{data:[{type:'tracks',id:'78362249',attributes:{title:'Unchain My Heart (LIVE)',artists:[{name:'Joe Cocker'}]}}]}]});
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://tidal.com/track/78362249');
});

test('Audiomack live album shape uses structured data fallback when the rendered page only shows titles',async()=>{
  const page={evaluate:async()=>({title:'Asake M$NEY',bodyText:'Intro WORSHIP Gratitude Rora Amen Wa MCBH WHY LOVE Forgiveness Oba BADMAN GANGSTA Asambe Skilful',links:[],json:[]}),waitForTimeout:async()=>{},getByRole:()=>({first:()=>({isVisible:async()=>false})})};
  const adapter=platformRegistry.getPlatformAdapter('audiomack');
  const out=await adapter.resolveCatalog({input:'https://audiomack.com/asakemusic/album/mney-1073854',page,fetchJson:async()=>({results:{tracks:[{id:7231147,title:'Gratitude',url_slug:'gratitude-7231147',uploader_url_slug:'asakemusic',artist_name:'Asake'}]}})});
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://audiomack.com/asakemusic/song/gratitude-7231147');
});

test('real Pandora direct song remains importable even when the page snapshot is region blocked',async()=>{
  const input='https://www.pandora.com/artist/billy-cobham/drum-n-voice-the-definitive-collection/electric-man-feat-brian-auger/TRXb2wXlw9KVn9g';
  const page={evaluate:async()=>({title:'Pandora',bodyText:'Pandora is unavailable in this country or region',links:[],json:[]}),waitForTimeout:async()=>{},getByRole:()=>({first:()=>({isVisible:async()=>false})})};
  const adapter=platformRegistry.getPlatformAdapter('pandora');
  const out=await adapter.resolveCatalog({input,page});
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,input);
});

test('catalog capture keeps real service API JSON even when the response content-type is generic',async()=>{
  let handler=null;
  const page={on:(event,fn)=>{if(event==='response')handler=fn;},off:()=>{}};
  const capture=factory.createCatalogResponseCapture(page);
  await handler({
    url:()=> 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
    allHeaders:async()=>({'content-type':'text/plain; charset=utf-8','content-length':'3000000'}),
    json:async()=>({contents:[{videoId:'h5I4UgTyLSY',title:'Praise (Afro Soul)'}]}),
  });
  assert.equal(capture.json.length,1);
  assert.equal(capture.json[0].contents[0].videoId,'h5I4UgTyLSY');
});

test('Audiomack catalog expansion clicks Load More Tracks until the full visible playlist is exposed',async()=>{
  assert.equal(typeof factory.expandCatalogPage,'function');
  let clicks=0;
  const page={
    getByRole:(_role,{name})=>({first:()=>({isVisible:async()=>name.test('Load More Tracks')&&clicks<3,click:async()=>{clicks+=1;}})}),
    waitForTimeout:async()=>{},
  };
  await factory.expandCatalogPage(page,'audiomack');
  assert.equal(clicks,3);
});

test('the exact YouTube Music direct song imports without requiring a catalog page',async()=>{
  const input='https://music.youtube.com/watch?v=k_Y18DRr_nA&si=EF2nL_FtmKciZxvr';
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const out=await adapter.resolveCatalog({input,page:null});
  assert.equal(out.kind,'track');
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,input);
});

test('real direct TIDAL and Pandora songs import without requiring a live catalog page',async()=>{
  const cases=[
    ['tidal','https://tidal.com/browse/track/78362249'],
    ['pandora','https://www.pandora.com/artist/haley-smalls/timelines/lsd-feat-dani-corteiz/TRdhcxxwzXwjrrJ'],
  ];
  for(const [platform,input] of cases){
    const adapter=platformRegistry.getPlatformAdapter(platform);
    const out=await adapter.resolveCatalog({input,page:null});
    assert.equal(out.kind,'track',platform);
    assert.equal(out.tracks.length,1,platform);
    assert.equal(out.tracks[0].url,input,platform);
  }
});

test('exact YouTube Music channel uses the public feed before touching the browser page',async()=>{
  const input='https://music.youtube.com/channel/UC3o5HxAo2Eyq3YK4t2KnYLA?si=3J2n9MVhLb6IyBA6';
  const gotos=[];
  const page={
    goto:async url=>{gotos.push(url);},
    evaluate:async()=>({title:'YouTube channel',bodyText:'',links:[],json:[]}),
    waitForTimeout:async()=>{},
    getByRole:()=>({first:()=>({isVisible:async()=>false})}),
  };
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const out=await adapter.resolveCatalog({input,page,fetchText:async url=>{
    assert.equal(url,'https://www.youtube.com/feeds/videos.xml?channel_id=UC3o5HxAo2Eyq3YK4t2KnYLA');
    return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>abc123XYZ</yt:videoId><title>Song One</title><author><name>Demo Artist</name></author></entry></feed>`;
  }});
  assert.deepEqual(gotos,[],'feed success must not depend on browser navigation');
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://music.youtube.com/watch?v=abc123XYZ');
});


test('exact YouTube Music channel imports from public feed without requiring a browser page',async()=>{
  const input='https://music.youtube.com/channel/UC3o5HxAo2Eyq3YK4t2KnYLA?si=3ZIXCUqrDCiEuIT1';
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const out=await adapter.resolveCatalog({input,page:null,fetchText:async url=>{
    assert.equal(url,'https://www.youtube.com/feeds/videos.xml?channel_id=UC3o5HxAo2Eyq3YK4t2KnYLA');
    return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>chanSong01</yt:videoId><title>Channel Song</title><author><name>Channel Artist</name></author></entry></feed>`;
  }});
  assert.equal(out.kind,'artist');
  assert.equal(out.tracks.length,1);
  assert.equal(out.tracks[0].url,'https://music.youtube.com/watch?v=chanSong01');
});

test('exact YouTube Music playlist imports from public feed without requiring a browser page',async()=>{
  const input='https://music.youtube.com/playlist?list=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ&si=q1Xzxo-VdgrZsRC_';
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const out=await adapter.resolveCatalog({input,page:null,fetchText:async url=>{
    assert.equal(url,'https://www.youtube.com/feeds/videos.xml?playlist_id=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ');
    return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>playSong01</yt:videoId><title>Playlist Song One</title><author><name>Playlist Artist</name></author></entry><entry><yt:videoId>playSong02</yt:videoId><title>Playlist Song Two</title><author><name>Playlist Artist</name></author></entry></feed>`;
  }});
  assert.equal(out.kind,'playlist');
  assert.deepEqual(out.tracks.map(row=>row.url),['https://music.youtube.com/watch?v=playSong01','https://music.youtube.com/watch?v=playSong02']);
});


test('YouTube public feed seeds collection but a successful browser snapshot can add more tracks',async()=>{
  const input='https://music.youtube.com/playlist?list=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ';
  const adapter=platformRegistry.getPlatformAdapter('youtube-music');
  const page={
    evaluate:async()=>({title:'Playlist',bodyText:'',links:[],json:[{videoId:'browserExtra02',title:{simpleText:'Browser Extra'}}]}),
    waitForTimeout:async()=>{},
    getByRole:()=>({first:()=>({isVisible:async()=>false})}),
  };
  const out=await adapter.resolveCatalog({input,page,fetchText:async()=>`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>feedSong01</yt:videoId><title>Feed Song</title><author><name>Artist</name></author></entry></feed>`});
  assert.deepEqual(out.tracks.map(row=>row.url).sort(),[
    'https://music.youtube.com/watch?v=browserExtra02',
    'https://music.youtube.com/watch?v=feedSong01',
  ]);
});
