import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingHub } from './StreamingHub';
import type { StreamingCollection, StreamingTrack } from '../shared/streaming';
import type { QaEvent } from '../shared/run';

const accounts=[{id:'a1',platform:'spotify' as const,label:'QA Account',username:'tester@example.com',authMode:'session' as const,proxySource:'none' as const,status:'ready' as const,hasSessionSecret:true}];
const track:StreamingTrack={id:'t1',platform:'spotify',title:'Track One',artist:'QA Artist',album:'QA Album',url:'https://open.spotify.com/track/t1'};
const startStreamingRun=vi.fn();
const resolveStreamingCatalog=vi.fn();
const saveStreamingAccount=vi.fn();
const startStreamingAccountVerification=vi.fn();
const listQaRuns=vi.fn();
const getQaRun=vi.fn();
let qaEventListener:((event:QaEvent)=>void)|null=null;
let collections:StreamingCollection[]=[];

beforeEach(()=>{
  collections=[];
  startStreamingRun.mockReset().mockResolvedValue({runId:'RUN-STREAM-1'});
  resolveStreamingCatalog.mockReset().mockResolvedValue({platform:'spotify',kind:'album',input:'https://open.spotify.com/album/alb1',tracks:[track]});
  saveStreamingAccount.mockReset().mockResolvedValue({id:'saved-account-1',platform:'spotify',label:'New QA',username:'new@example.com',authMode:'credentials',proxySource:'none',status:'unverified',hasPassword:true});
  startStreamingAccountVerification.mockReset().mockResolvedValue({sessionId:'account-verify-a1',accountId:'a1',platform:'spotify',status:'pending',reason:'Sign in yourself in the normal browser, then click MARK VERIFIED.',browserLabel:'Google Chrome',proxySource:'none',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',openedAt:'2026-09-18T12:00:00Z'});
  listQaRuns.mockReset().mockResolvedValue([]);
  getQaRun.mockReset().mockResolvedValue(null);
  qaEventListener=null;
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{
    listStreamingCollections:vi.fn().mockImplementation(async()=>collections),
    checkStreamingDuplicate:vi.fn().mockResolvedValue(null),
    resolveStreamingCatalog,
    saveStreamingCollection:vi.fn().mockImplementation(async(req)=>{
      const now='2026-09-17T00:00:00Z';
      const saved:StreamingCollection={id:req.id||'saved-1',name:req.name,platform:req.platform,sourceInput:req.sourceInput||'',canonicalSourceInput:req.canonicalSourceInput||req.sourceInput||'',sourceKind:req.sourceKind||'search',tracks:req.tracks||[],createdAt:req.createdAt||now,updatedAt:now};
      collections=[...collections.filter(c=>c.id!==saved.id),saved];
      return saved;
    }),
    deleteStreamingCollection:vi.fn().mockImplementation(async(id)=>{collections=collections.filter(c=>c.id!==id);return{id,deleted:true};}),
    startStreamingLinkVerification:vi.fn().mockResolvedValue({sessionId:'verify-1',targetKey:'collection:saved-1',url:'https://music.youtube.com/watch?v=manual1',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',openedAt:'2026-09-18T12:00:00Z'}),
    completeStreamingLinkVerification:vi.fn().mockImplementation(async({collectionId,trackId})=>{
      const now='2026-09-18T12:01:00Z';
      const found=collections.find(c=>c.id===collectionId)!;
      const verification={status:'verified' as const,verifiedAt:now,verifiedUrl:trackId?found.tracks.find(t=>(t.id||t.url)===trackId)?.url||'':found.sourceInput,verifiedDeviceMode:'desktop' as const,verifiedDeviceProfile:'Desktop 1280x720'};
      const saved={...found,...(trackId?{tracks:found.tracks.map(t=>(t.id||t.url)===trackId?{...t,verification}:t)}:{verification})};
      collections=collections.map(c=>c.id===collectionId?saved:c);
      return saved;
    }),
    listStreamingAccounts:vi.fn().mockResolvedValue(accounts),
    listQaRuns,getQaRun,onQaEvent:vi.fn((listener:(event:QaEvent)=>void)=>{qaEventListener=listener;return()=>{if(qaEventListener===listener)qaEventListener=null;};}),
    saveStreamingAccount,deleteStreamingAccount:vi.fn(),verifyStreamingAccount:vi.fn().mockResolvedValue({ok:true,account:accounts[0]}),startStreamingAccountVerification,completeStreamingAccountVerification:vi.fn().mockResolvedValue({ok:true,account:accounts[0]}),cancelStreamingAccountVerification:vi.fn().mockResolvedValue({cancelled:true,accountId:'a1'}),startStreamingRun,
  }});
});

describe('Streaming Hub and Music Library',()=>{
  it('keeps QA controls in Streaming Hub and directs account management to Test Accounts',async()=>{
    render(<StreamingHub/>);
    expect(screen.getByText('Streaming Hub')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste Spotify, YouTube Music/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Import and organize music from the separate Music Library page/i)).toBeInTheDocument();
    expect(screen.queryByText(/Auto-Follow|Auto-Favorite|Subscribe/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/Choose accounts in Test Accounts/i)).toBeInTheDocument();
  });

  it('shows live structured streaming activity with severity filters',async()=>{
    listQaRuns.mockResolvedValueOnce([{runId:'RUN-LIVE',runKind:'streaming',createdAt:'2026-09-18T12:00:00Z',updatedAt:'2026-09-18T12:00:01Z',status:'RUNNING',executionMode:'visible',requestedConcurrency:1,targetSummary:'spotify',deviceFamilies:['Streaming QA'],counters:{requested:1,running:1,queued:0,completed:0,failed:0,cancelled:0,incomplete:0}}]);
    getQaRun.mockResolvedValueOnce({runId:'RUN-LIVE',runKind:'streaming',createdAt:'2026-09-18T12:00:00Z',updatedAt:'2026-09-18T12:00:01Z',status:'RUNNING',executionMode:'visible',requestedConcurrency:1,targetSummary:'spotify',deviceFamilies:['Streaming QA'],counters:{requested:1,running:1,queued:0,completed:0,failed:0,cancelled:0,incomplete:0},config:{},logs:[]});
    render(<StreamingHub/>);
    expect(await screen.findByText('LIVE STREAM LOG')).toBeInTheDocument();
    expect(await screen.findByText(/Active diagnostics · RUN-LIVE/i)).toBeInTheDocument();
    await waitFor(()=>expect(qaEventListener).not.toBeNull());
    act(()=>qaEventListener?.({type:'log',runId:'RUN-LIVE',timestamp:'2026-09-18T12:00:02Z',severity:'warning',stage:'playback',accountLabel:'QA Account',platform:'spotify',trackTitle:'Track One',action:'retry-play',message:'Playback has not started yet'}));
    expect(await screen.findByText('Playback has not started yet')).toBeInTheDocument();
    expect(screen.getByText('WARNING')).toBeInTheDocument();
    expect(screen.getByText(/spotify · QA Account · playback/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Errors only'}));
    expect(screen.queryByText('Playback has not started yet')).not.toBeInTheDocument();
    expect(screen.getByText(/No entries match this filter yet/i)).toBeInTheDocument();
  });

  it('imports and saves music, selects an account on Test Accounts, then starts QA',async()=>{
    const {rerender}=render(<StreamingHub view="library"/>);
    const input=await screen.findByPlaceholderText(/Paste Spotify, YouTube Music/i);
    fireEvent.change(input,{target:{value:'https://open.spotify.com/album/alb1'}});
    expect(await screen.findByText(/Detected service:/i)).toHaveTextContent('Spotify');
    fireEvent.click(screen.getByRole('button',{name:'FETCH SONGS'}));
    expect(await screen.findByText('Track One')).toBeInTheDocument();
    expect(screen.getByText('https://open.spotify.com/track/t1')).toBeInTheDocument();
    expect(screen.getByText(/1 songs found · 0 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Select All'}));
    fireEvent.change(screen.getByPlaceholderText('Give this album a name'),{target:{value:'My QA Album'}});
    fireEvent.click(screen.getByRole('button',{name:'SAVE ALBUM'}));
    expect(await screen.findByText(/Saved 1 song as My QA Album/i)).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByPlaceholderText(/Paste Spotify, YouTube Music/i)).toHaveValue(''));
    expect(screen.getByText('My QA Album')).toBeInTheDocument();
    expect(screen.getAllByText('Spotify').length).toBeGreaterThan(0);

    rerender(<StreamingHub view="accounts"/>);
    expect(await screen.findByText('QA Account')).toBeInTheDocument();
    const accountToggle=screen.getByLabelText('Use QA Account');
    expect(accountToggle).toBeChecked();

    rerender(<StreamingHub view="qa"/>);
    expect(await screen.findByText(/1 Spotify account selected/i)).toBeInTheDocument();
    expect(await screen.findByText(/QA Account · ready/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 saved album ready/i)).toBeInTheDocument();
    const startButton=screen.getByRole('button',{name:/START STREAMING QA/i});
    await waitFor(()=>expect(startButton).toBeEnabled());
    fireEvent.click(startButton);
    await waitFor(()=>expect(startStreamingRun).toHaveBeenCalledTimes(1));
    expect(startStreamingRun.mock.calls[0][0]).toMatchObject({runKind:'streaming',platform:'spotify',collectionIds:['saved-1'],trackIds:['t1'],inlineTracks:[track],accountIds:['a1']});
  });

  it('manually saves an exact song link and requires a second click before it becomes verified',async()=>{
    render(<StreamingHub view="library"/>);
    const input=await screen.findByPlaceholderText(/Paste Spotify, YouTube Music/i);
    fireEvent.change(input,{target:{value:'https://music.youtube.com/watch?v=manual1&si=abc'}});
    fireEvent.change(screen.getByPlaceholderText(/Song, album, artist, or playlist name/i),{target:{value:'Manual Song'}});
    fireEvent.click(screen.getByRole('button',{name:/SAVE LINK MANUALLY/i}));
    expect(await screen.findByText('Manual Song')).toBeInTheDocument();
    const verify=screen.getByRole('button',{name:'VERIFY'});
    fireEvent.click(verify);
    expect(await screen.findByRole('button',{name:/MARK VERIFIED/})).toBeInTheDocument();
    expect(screen.queryByText(/^VERIFIED ✓$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/MARK VERIFIED/}));
    expect(await screen.findByText(/^VERIFIED ✓$/i)).toBeInTheDocument();
  });


  it('keeps account saving separate from explicit normal-browser manual login',async()=>{
    render(<StreamingHub view="accounts"/>);
    fireEvent.change(screen.getByPlaceholderText('Primary QA account'),{target:{value:'New QA'}});
    fireEvent.change(screen.getByPlaceholderText('tester@example.com'),{target:{value:'new@example.com'}});
    fireEvent.change(screen.getByPlaceholderText('Stored locally using OS encryption'),{target:{value:'secret-password'}});
    fireEvent.click(screen.getByRole('button',{name:/ADD TO 1 PLATFORM/i}));
    await waitFor(()=>expect(saveStreamingAccount).toHaveBeenCalledTimes(1));
    expect(startStreamingAccountVerification).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button',{name:'LOGIN MANUALLY'}));
    await waitFor(()=>expect(startStreamingAccountVerification).toHaveBeenCalledWith({accountId:'a1',proxySource:'none',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'}));
    expect(await screen.findByText(/normal Chrome\/Edge/i)).toBeInTheDocument();
  });

  it('auto-detects YouTube Music from the pasted link on Music Library without manual platform switching',async()=>{
    render(<StreamingHub view="library"/>);
    const input=await screen.findByPlaceholderText(/Paste Spotify, YouTube Music/i);
    resolveStreamingCatalog.mockResolvedValueOnce({platform:'youtube-music',kind:'playlist',input:'https://music.youtube.com/playlist?list=abc',tracks:[{id:'yt1',platform:'youtube-music',title:'YT Track',url:'https://music.youtube.com/watch?v=yt1'}]});
    fireEvent.change(input,{target:{value:'https://music.youtube.com/playlist?list=abc'}});
    expect(await screen.findByText(/Detected service:/i)).toHaveTextContent('YouTube Music');
    fireEvent.click(screen.getByRole('button',{name:'FETCH SONGS'}));
    await waitFor(()=>expect(resolveStreamingCatalog).toHaveBeenCalledWith({platform:'youtube-music',input:'https://music.youtube.com/playlist?list=abc'}));
    expect(await screen.findByText('YT Track')).toBeInTheDocument();
  });
});
