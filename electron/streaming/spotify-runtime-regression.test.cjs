const test = require('node:test');
const assert = require('node:assert/strict');
const spotify = require('./adapters/spotify.cjs');

function makeCatalogPage(){
  let current='https://open.spotify.com/artist/artist123';
  const gotos=[];
  return {
    gotos,
    url:()=>current,
    goto:async(url)=>{current=String(url);gotos.push(current);},
    waitForTimeout:async()=>{},
    evaluate:async(fn)=>{
      const source=String(fn);
      if(source.includes('scrollTo')) return undefined;
      if(current.includes('/artist/')) return [
        {id:'https://open.spotify.com/album/alb123',title:'Release One',url:'https://open.spotify.com/album/alb123'}
      ];
      if(current.includes('/embed/album/alb123') || current.includes('/album/alb123')) return [
        {id:'https://open.spotify.com/track/trk111',title:'Track One',url:'https://open.spotify.com/track/trk111'},
        {id:'https://open.spotify.com/track/trk222',title:'Track Two',url:'https://open.spotify.com/track/trk222'},
      ];
      return [];
    }
  };
}

test('Spotify artist catalog traverses release pages and returns tracks instead of album cards', async()=>{
  const page=makeCatalogPage();
  const out=await spotify.resolveCatalog({input:'https://open.spotify.com/artist/artist123',page});
  assert.deepEqual(out.tracks.map(t=>t.url),[
    'https://open.spotify.com/track/trk111',
    'https://open.spotify.com/track/trk222',
  ]);
  assert.ok(page.gotos.some(url=>url.includes('/embed/album/alb123') || url.includes('/album/alb123')));
});

test('Spotify credentials authentication uses the saved username/password and does not silently mark login as ready', async()=>{
  assert.equal(typeof spotify.authenticate,'function');
  const actions=[];
  let loginVisible=true;
  const usernameField={fill:async(v)=>actions.push(['username',v]),isVisible:async()=>true};
  const passwordField={fill:async(v)=>actions.push(['password',v]),isVisible:async()=>true};
  const submit={first(){return this;},isVisible:async()=>true,click:async()=>{actions.push(['submit']);loginVisible=false;}};
  const loginControl={first(){return this;},isVisible:async()=>loginVisible,click:async()=>{actions.push(['submit']);loginVisible=false;}};
  const page={
    url:()=>loginVisible?'https://accounts.spotify.com/en/login':'https://open.spotify.com/',
    goto:async(url)=>actions.push(['goto',url]),
    waitForTimeout:async()=>{},
    getByLabel:(name)=>/email|username/i.test(String(name))?usernameField:/password/i.test(String(name))?passwordField:null,
    locator:(selector)=> selector.includes('password')?passwordField:usernameField,
    getByRole:(role,{name}={})=>{
      if(role==='button' && /log in|login|sign in/i.test(String(name))) return loginControl;
      if(role==='link') return {first(){return this;},isVisible:async()=>false};
      return submit;
    },
    getByText:()=>({first(){return this;},isVisible:async()=>false}),
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'secret'}});
  assert.equal(out.status,'PASS');
  assert.deepEqual(actions.filter(x=>x[0]==='username'||x[0]==='password'||x[0]==='submit'),[
    ['username','qa@example.com'],['password','secret'],['submit']
  ]);
});

test('Spotify discography expands Show more results before collecting release URLs',async()=>{
  let current='https://open.spotify.com/artist/artist123';
  let expanded=false;
  const page={
    url:()=>current,
    goto:async(url)=>{current=String(url)},
    waitForTimeout:async()=>{},
    getByRole:(role,{name}={})=>({first(){return this;},isVisible:async()=>role==='button'&&/show more/i.test(String(name))&&current.includes('/discography/')&&!expanded,click:async()=>{expanded=true;}}),
    evaluate:async(fn)=>{
      if(String(fn).includes('scrollTo')) return undefined;
      if(current.includes('/discography/')) return expanded ? [
        {id:'https://open.spotify.com/album/alb1',title:'One',url:'https://open.spotify.com/album/alb1'},
        {id:'https://open.spotify.com/album/alb2',title:'Two',url:'https://open.spotify.com/album/alb2'},
      ] : [{id:'https://open.spotify.com/album/alb1',title:'One',url:'https://open.spotify.com/album/alb1'}];
      return [{id:'https://open.spotify.com/album/alb1',title:'One',url:'https://open.spotify.com/album/alb1'}];
    }
  };
  const releases=await spotify._test.collectReleaseUrls(page,'https://open.spotify.com/artist/artist123');
  assert.deepEqual(releases.sort(),['https://open.spotify.com/album/alb1','https://open.spotify.com/album/alb2']);
});

test('Spotify credential login supports a two-step username then password flow',async()=>{
  const actions=[]; let stage='username'; let loggedIn=false;
  const usernameField={first(){return this;},isVisible:async()=>stage==='username',fill:async(v)=>actions.push(['username',v])};
  const passwordField={first(){return this;},isVisible:async()=>stage==='password',fill:async(v)=>actions.push(['password',v])};
  const hidden={first(){return this;},isVisible:async()=>false};
  const page={
    url:()=>loggedIn?'https://open.spotify.com/':'https://accounts.spotify.com/en/login',
    goto:async()=>{}, waitForTimeout:async()=>{},
    getByLabel:(name)=>/password/i.test(String(name))?passwordField:usernameField,
    locator:(selector)=>selector.includes('password')?passwordField:usernameField,
    getByText:()=>hidden,
    getByRole:(role,{name}={})=>{
      if(role==='link') return hidden;
      if(/continue|next/i.test(String(name))) return {first(){return this;},isVisible:async()=>stage==='username',click:async()=>{actions.push(['continue']);stage='password';}};
      if(/log in|login|sign in/i.test(String(name))) return {first(){return this;},isVisible:async()=>stage==='password',click:async()=>{actions.push(['submit']);loggedIn=true;stage='done';}};
      return hidden;
    }
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'two@example.com',password:'pw'}});
  assert.equal(out.status,'PASS');
  assert.deepEqual(actions,[['username','two@example.com'],['continue'],['password','pw'],['submit']]);
});

test('Spotify credential login stops for CAPTCHA or MFA instead of attempting to bypass it',async()=>{
  const hidden={first(){return this;},isVisible:async()=>false};
  const page={
    goto:async()=>{},waitForTimeout:async()=>{},
    getByText:(pattern)=>({first(){return this;},isVisible:async()=>/captcha/i.test(String(pattern))}),
    getByRole:()=>hidden,getByLabel:()=>hidden,locator:()=>hidden,
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'WARNING');
  assert.match(out.reason,/manual verification|CAPTCHA|verification/i);
});

test('Spotify login is not marked PASS when submit hides the button but the page remains on the login URL',async()=>{
  let loginVisible=true;
  const usernameField={first(){return this;},isVisible:async()=>true,fill:async()=>{}};
  const passwordField={first(){return this;},isVisible:async()=>true,fill:async()=>{}};
  const hidden={first(){return this;},isVisible:async()=>false};
  const loginControl={first(){return this;},isVisible:async()=>loginVisible,click:async()=>{loginVisible=false;}};
  const page={
    url:()=> 'https://accounts.spotify.com/en/login',
    goto:async()=>{},waitForTimeout:async()=>{},waitForURL:async()=>{throw new Error('timeout')},
    getByText:()=>hidden,
    getByLabel:(name)=>/password/i.test(String(name))?passwordField:usernameField,
    locator:(selector)=>selector.includes('password')?passwordField:usernameField,
    getByRole:(role,{name}={})=>role==='button'&&/log in|login|sign in/i.test(String(name))?loginControl:hidden,
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'WARNING');
  assert.match(out.reason,/did not complete|login page|authenticated/i);
});

test('Spotify credential login reports an explicit navigation failure when the login page cannot be opened',async()=>{
  const hidden={first(){return this;},isVisible:async()=>false};
  const page={
    url:()=> 'about:blank',
    goto:async()=>{throw new Error('network unavailable')},
    waitForTimeout:async()=>{},
    getByText:()=>hidden,getByRole:()=>hidden,getByLabel:()=>hidden,locator:()=>hidden,
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'WARNING');
  assert.match(out.reason,/could not be opened|login page/i);
});

test('Spotify album catalog uses the public embed view and returns track links',async()=>{
  let current='about:blank';
  const page={
    url:()=>current,goto:async url=>{current=String(url)},waitForTimeout:async()=>{},
    evaluate:async fn=>String(fn).includes('scrollTo')?undefined:[
      {id:'https://open.spotify.com/track/a1',title:'Album Track 1',url:'https://open.spotify.com/track/a1'},
      {id:'https://open.spotify.com/track/a2',title:'Album Track 2',url:'https://open.spotify.com/track/a2'},
    ]
  };
  const out=await spotify.resolveCatalog({input:'https://open.spotify.com/album/album123?si=x',page});
  assert.match(current,/open\.spotify\.com\/embed\/album\/album123/);
  assert.deepEqual(out.tracks.map(t=>t.url),['https://open.spotify.com/track/a1','https://open.spotify.com/track/a2']);
});

test('Spotify playlist catalog uses the public embed view and returns track links',async()=>{
  let current='about:blank';
  const page={
    url:()=>current,goto:async url=>{current=String(url)},waitForTimeout:async()=>{},
    evaluate:async fn=>String(fn).includes('scrollTo')?undefined:[
      {id:'https://open.spotify.com/track/p1',title:'Playlist Track',url:'https://open.spotify.com/track/p1'},
    ]
  };
  const out=await spotify.resolveCatalog({input:'https://open.spotify.com/playlist/playlist123',page});
  assert.match(current,/open\.spotify\.com\/embed\/playlist\/playlist123/);
  assert.deepEqual(out.tracks.map(t=>t.url),['https://open.spotify.com/track/p1']);
});

test('Spotify artist embed text rows for the reported Breny Vale profile produce selectable tracks even without track anchors', async()=>{
  const artistUrl='https://open.spotify.com/artist/7FdN8n6iWBDWh0Udk068jt?si=b7CrOttsS4-caHXrdNGQzA';
  let current=artistUrl;
  const embedText=`Breny Vale\nTop tracks\n1\nBEFORE YOU COULD LEAVE\nBreny Vale\n03:56\n2\nHeaven Has a Phone Number\nBreny Vale\n05:27\n3\nYour Seat Stayed Empty\nBreny Vale\n05:14\n4\nYou Only Loved Me Leaving\nBreny Vale\n05:44\n5\nOn More Red Light\nBreny Vale\n04:29\n6\nTHE HOUSE THAT RAISED US\nBreny Vale\n04:59\n7\nNo More Maybe\nBreny Vale\n04:00\n8\nThey Called Me by Mistake\nBreny Vale\n05:04\n9\nTHE GOOD DAYS KNOW MY NAME\nBreny Vale\n04:35\n10\nONLY YOU KNOW\nBreny Vale\n04:01`;
  const hidden={first(){return this;},isVisible:async()=>false};
  const page={
    url:()=>current,
    goto:async url=>{current=String(url)},
    waitForTimeout:async()=>{},
    getByRole:()=>hidden,
    evaluate:async fn=>String(fn).includes('scrollTo')?undefined:[],
    locator:(selector)=> selector==='body' ? {innerText:async()=> current.includes('/embed/artist/') ? embedText : ''} : hidden,
  };
  const out=await spotify.resolveCatalog({input:artistUrl,page});
  assert.equal(out.tracks.length,10);
  assert.deepEqual(out.tracks.slice(0,3).map(t=>t.title),['BEFORE YOU COULD LEAVE','Heaven Has a Phone Number','Your Seat Stayed Empty']);
  assert.ok(out.tracks.every(t=>t.artist==='Breny Vale'));
  assert.ok(out.tracks.every(t=>/open\.spotify\.com\/search\//.test(t.url)));
});

test('Spotify synthetic catalog tracks resolve from search to the exact canonical track before playback QA',async()=>{
  const gotos=[];
  const match={first(){return this;},isVisible:async()=>true,getAttribute:async name=>name==='href'?'https://open.spotify.com/track/canonical999':null};
  const hidden={first(){return this;},isVisible:async()=>false,getAttribute:async()=>null};
  const page={
    goto:async url=>{gotos.push(String(url));},
    waitForTimeout:async()=>{},
    locator:(selector,options)=> selector==='a[href*="/track/"]' && String(options?.hasText||'')==='ONLY YOU KNOW' ? match : hidden,
  };
  const track={id:'spotify-search:breny vale::only you know',title:'ONLY YOU KNOW',artist:'Breny Vale',url:'https://open.spotify.com/search/Breny%20Vale%20ONLY%20YOU%20KNOW'};
  const out=await spotify.locateTrack({page,track});
  assert.equal(out.status,'PASS');
  assert.equal(out.url,'https://open.spotify.com/track/canonical999');
  assert.deepEqual(gotos,['https://open.spotify.com/search/Breny%20Vale%20ONLY%20YOU%20KNOW','https://open.spotify.com/track/canonical999']);
});

test('Spotify login prefers password instead of email or one-time-code login routes',async()=>{
  const actions=[];let passwordVisible=false;let loggedIn=false;
  const hidden={first(){return this;},isVisible:async()=>false};
  const username={first(){return this;},isVisible:async()=>true,fill:async v=>actions.push(['username',v])};
  const password={first(){return this;},isVisible:async()=>passwordVisible,fill:async v=>actions.push(['password',v])};
  const page={
    url:()=>loggedIn?'https://open.spotify.com/':'https://accounts.spotify.com/en/login',goto:async()=>{},waitForTimeout:async()=>{},waitForURL:async()=>{},
    getByText:()=>hidden,
    getByLabel:name=>/password/i.test(String(name))?password:username,
    locator:selector=>selector.includes('password')?password:selector.includes('submit')?hidden:username,
    getByRole:(role,{name}={})=>{
      const pattern=String(name||'');
      if(role==='link'&&/password/i.test(pattern))return {first(){return this;},isVisible:async()=>!passwordVisible,click:async()=>{actions.push(['password-route']);passwordVisible=true;}};
      if(role==='button'&&/code|magic/i.test(pattern))return {first(){return this;},isVisible:async()=>true,click:async()=>actions.push(['code-route'])};
      if(role==='button'&&/log in|login|sign in/i.test(pattern)&&passwordVisible&&!loggedIn)return {first(){return this;},isVisible:async()=>true,click:async()=>{actions.push(['submit']);loggedIn=true;passwordVisible=false;}};
      return hidden;
    },
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'PASS');
  assert.ok(actions.some(x=>x[0]==='password-route'));
  assert.equal(actions.some(x=>x[0]==='code-route'),false);
  assert.ok(actions.some(x=>x[0]==='password'));
});

test('Spotify ignores an optional verification-code offer when password login is available',async()=>{
  const actions=[];let passwordVisible=false;let loggedIn=false;
  const hidden={first(){return this;},isVisible:async()=>false};
  const visibleText={first(){return this;},isVisible:async()=>true};
  const username={first(){return this;},isVisible:async()=>true,fill:async v=>actions.push(['username',v])};
  const password={first(){return this;},isVisible:async()=>passwordVisible,fill:async v=>actions.push(['password',v])};
  const page={
    url:()=>loggedIn?'https://open.spotify.com/':'https://accounts.spotify.com/en/login',goto:async()=>{},waitForTimeout:async()=>{},waitForURL:async()=>{},
    getByText:pattern=>/verification code/i.test(String(pattern))?visibleText:hidden,
    getByLabel:name=>/password/i.test(String(name))?password:username,
    locator:selector=>/one-time-code|name\*="code"|inputmode="numeric"/i.test(String(selector))?hidden:selector.includes('password')?password:username,
    getByRole:(role,{name}={})=>{const pattern=String(name||'');if(role==='link'&&/password/i.test(pattern))return {first(){return this;},isVisible:async()=>!passwordVisible,click:async()=>{passwordVisible=true;actions.push(['password-route']);}};if(role==='button'&&/log in|login|sign in/i.test(pattern)&&passwordVisible&&!loggedIn)return {first(){return this;},isVisible:async()=>true,click:async()=>{loggedIn=true;passwordVisible=false;actions.push(['submit']);}};return hidden;},
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'PASS');
  assert.ok(actions.some(x=>x[0]==='password-route'));
  assert.ok(actions.some(x=>x[0]==='password'));
});

test('Spotify login waits for dynamically rendered email and password fields before giving up',async()=>{
  const actions=[];let ticks=0;let loggedIn=false;let passwordStage=false;
  const hidden={first(){return this;},isVisible:async()=>false};
  const username={first(){return this;},isVisible:async()=>ticks>=2,fill:async v=>actions.push(['username',v])};
  const password={first(){return this;},isVisible:async()=>passwordStage&&ticks>=5,fill:async v=>actions.push(['password',v])};
  const page={
    url:()=>loggedIn?'https://open.spotify.com/':'https://accounts.spotify.com/en/login',
    goto:async()=>{},
    waitForTimeout:async()=>{ticks++},
    waitForURL:async()=>{},
    getByText:()=>hidden,
    getByLabel:name=>/password/i.test(String(name))?password:username,
    locator:selector=>String(selector).includes('password')?password:String(selector).includes('submit')?hidden:username,
    getByRole:(role,{name}={})=>{
      const pattern=String(name||'');
      if(role==='button'&&/continue|next/i.test(pattern))return {first(){return this;},isVisible:async()=>ticks>=2,click:async()=>{passwordStage=true;ticks=Math.max(ticks,3);actions.push(['continue']);}};
      if((role==='button'||role==='link')&&/password/i.test(pattern))return hidden;
      if(role==='button'&&/log in|login|sign in/i.test(pattern))return {first(){return this;},isVisible:async()=>passwordStage&&ticks>=5&&!loggedIn,click:async()=>{loggedIn=true;actions.push(['submit']);}};
      return hidden;
    },
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'PASS',out.reason);
  assert.ok(actions.some(x=>x[0]==='username'));
  assert.ok(actions.some(x=>x[0]==='password'));
  assert.ok(actions.some(x=>x[0]==='submit'));
});

test('Spotify normal reCAPTCHA footer does not block username and password automation',async()=>{
  const actions=[];let passwordVisible=false;let loggedIn=false;
  const hidden={first(){return this;},isVisible:async()=>false};
  const passiveCaptchaText={first(){return this;},isVisible:async()=>true};
  const username={first(){return this;},isVisible:async()=>true,fill:async v=>actions.push(['username',v])};
  const password={first(){return this;},isVisible:async()=>passwordVisible,fill:async v=>actions.push(['password',v])};
  const page={
    url:()=>loggedIn?'https://open.spotify.com/':'https://accounts.spotify.com/en/login',goto:async()=>{},waitForTimeout:async()=>{},waitForURL:async()=>{},
    getByText:pattern=>{try{return pattern?.test?.('This site is protected by reCAPTCHA and the Google Privacy Policy applies.')?passiveCaptchaText:hidden;}catch{return hidden}},
    getByLabel:name=>/password/i.test(String(name))?password:username,
    locator:selector=>/recaptcha|hcaptcha/i.test(String(selector))?hidden:String(selector).includes('password')?password:String(selector).includes('submit')?hidden:username,
    getByRole:(role,{name}={})=>{const pattern=String(name||'');if(role==='button'&&/continue|next/i.test(pattern))return {first(){return this;},isVisible:async()=>true,click:async()=>{passwordVisible=true;actions.push(['continue']);}};if(role==='button'&&/log in|login|sign in/i.test(pattern)&&passwordVisible&&!loggedIn)return {first(){return this;},isVisible:async()=>true,click:async()=>{loggedIn=true;actions.push(['submit']);}};return hidden;},
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'}});
  assert.equal(out.status,'PASS',out.reason);
  assert.ok(actions.some(x=>x[0]==='username'));
  assert.ok(actions.some(x=>x[0]==='password'));
  assert.ok(actions.some(x=>x[0]==='submit'));
});

test('Spotify stale cookie does not suppress password login when the login gate appears after the home page settles',async()=>{
  const actions=[];let ticks=0;let current='about:blank';let passwordVisible=false;let loggedIn=false;
  const hidden={first(){return this;},isVisible:async()=>false};
  const username={first(){return this;},isVisible:async()=>/accounts\.spotify\.com/.test(current),fill:async v=>actions.push(['username',v])};
  const password={first(){return this;},isVisible:async()=>passwordVisible,fill:async v=>actions.push(['password',v])};
  const page={
    url:()=>current,
    goto:async url=>{current=String(url)},
    waitForTimeout:async()=>{ticks++},
    getByText:()=>hidden,
    getByLabel:name=>/password/i.test(String(name))?password:username,
    getByPlaceholder:name=>/password/i.test(String(name))?password:username,
    locator:selector=>String(selector).includes('password')?password:hidden,
    getByRole:(role,{name}={})=>{
      const pattern=String(name||'');
      if((role==='button'||role==='link')&&/log in|login|sign in|signin/i.test(pattern)&&current==='https://open.spotify.com/')return {first(){return this;},isVisible:async()=>ticks>=2&&!loggedIn,click:async()=>{}};
      if(role==='button'&&/continue|next/i.test(pattern))return {first(){return this;},isVisible:async()=>/accounts\.spotify\.com/.test(current),click:async()=>{passwordVisible=true}};
      if(role==='button'&&/log in|login|sign in/i.test(pattern)&&passwordVisible&&/accounts\.spotify\.com/.test(current))return {first(){return this;},isVisible:async()=>!loggedIn,click:async()=>{loggedIn=true;current='https://open.spotify.com/';actions.push(['submit'])}};
      return hidden;
    },
  };
  const out=await spotify.authenticate({page,account:{authMode:'credentials',username:'qa@example.com',password:'pw',sessionSecret:'[{"name":"sp_dc","value":"stale"}]'}});
  assert.equal(out.status,'PASS',out.reason);
  assert.ok(actions.some(x=>x[0]==='username'));
  assert.ok(actions.some(x=>x[0]==='password'));
  assert.ok(actions.some(x=>x[0]==='submit'));
});

test('Spotify search resolver finds the canonical track link from the matching result card even when the title itself is not the anchor',async()=>{
  const gotos=[];
  const hidden={first(){return this;},isVisible:async()=>false,getAttribute:async()=>null};
  const page={
    goto:async url=>{gotos.push(String(url));},
    waitForTimeout:async()=>{},
    locator:()=>hidden,
    evaluate:async(fn,args)=>{
      if(String(fn).includes('querySelectorAll')&&args?.title==='I Was Talking To You')return 'https://open.spotify.com/track/cardResolved123';
      return null;
    },
  };
  const track={id:'spotify-search:breny vale::i was talking to you',title:'I Was Talking To You',artist:'Breny Vale',url:'https://open.spotify.com/search/Breny%20Vale%20I%20Was%20Talking%20To%20You'};
  const out=await spotify.locateTrack({page,track});
  assert.equal(out.status,'PASS');
  assert.equal(out.url,'https://open.spotify.com/track/cardResolved123');
  assert.deepEqual(gotos,[track.url,'https://open.spotify.com/track/cardResolved123']);
});
