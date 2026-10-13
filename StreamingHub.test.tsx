import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingHub } from './StreamingHub';
import type { StreamingCollection, StreamingTrack } from '../shared/streaming';

const accounts=[{id:'a1',platform:'spotify' as const,label:'QA Account',username:'tester@example.com',authMode:'session' as const,proxySource:'none' as const,status:'ready' as const,hasSessionSecret:true}];
const track:StreamingTrack={id:'t1',platform:'spotify',title:'Track One',artist:'QA Artist',album:'QA Album',url:'https://open.spotify.com/track/t1'};
const startStreamingRun=vi.fn();
const resolveStreamingCatalog=vi.fn();
let collections:StreamingCollection[]=[];

beforeEach(()=>{
  collections=[];
  startStreamingRun.mockReset().mockResolvedValue({runId:'RUN-STREAM-1'});
  resolveStreamingCatalog.mockReset().mockResolvedValue({platform:'spotify',kind:'album',input:'https://open.spotify.com/album/alb1',tracks:[track]});
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
    listStreamingAccounts:vi.fn().mockResolvedValue(accounts),
    saveStreamingAccount:vi.fn(),deleteStreamingAccount:vi.fn(),verifyStreamingAccount:vi.fn().mockResolvedValue({ok:true,account:accounts[0]}),startStreamingRun,
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
