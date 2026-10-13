import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunCenter } from './RunCenter';
import type { RunSummary } from '../shared/runCenter';

const stopQaRun=vi.fn(), pauseQaRun=vi.fn(), resumeQaRun=vi.fn(), stopAllQaRuns=vi.fn();
const runs: RunSummary[] = [
  { runId:'RUN-A',createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:00:00Z',status:'RUNNING',executionMode:'visible',requestedConcurrency:4,targetSummary:'a.example',deviceFamilies:['Desktop'],counters:{requested:5,running:4,queued:1,completed:0,failed:0,cancelled:0,incomplete:0}},
  { runId:'RUN-B',createdAt:'2026-09-17T00:00:01Z',updatedAt:'2026-09-17T00:00:01Z',status:'RUNNING',executionMode:'background',requestedConcurrency:3,targetSummary:'b.example',deviceFamilies:['Android'],counters:{requested:5,running:3,queued:2,completed:0,failed:0,cancelled:0,incomplete:0}},
];

beforeEach(() => {
  stopQaRun.mockReset().mockResolvedValue({stopped:true}); pauseQaRun.mockReset(); resumeQaRun.mockReset(); stopAllQaRuns.mockReset();
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{
    listQaRuns:vi.fn().mockResolvedValue(runs),
    getQaRun:vi.fn(async(id:string)=>({...runs.find(r=>r.runId===id)!,config:{},logs:[]})),
    stopQaRun,pauseQaRun,resumeQaRun,stopAllQaRuns,
    onQaEvent:vi.fn(()=>()=>undefined),
  }});
});

describe('RunCenter', () => {
  it('shows multiple simultaneous runs and stops only the selected run', async () => {
    render(<RunCenter />);
    expect(await screen.findByText('a.example')).toBeInTheDocument();
    expect(screen.getByText('b.example')).toBeInTheDocument();
    const stopButtons=screen.getAllByRole('button',{name:'Stop'});
    fireEvent.click(stopButtons[0]);
    await waitFor(()=>expect(stopQaRun).toHaveBeenCalledWith(expect.stringMatching(/^RUN-/)));
    expect(stopQaRun).toHaveBeenCalledTimes(1);
  });

  it('stops only the active Run Center lane with one click', async () => {
    render(<RunCenter />); await screen.findByText('a.example');
    fireEvent.click(screen.getByRole('button',{name:'Stop All TEST RUNS'}));
    await waitFor(()=>expect(stopAllQaRuns).toHaveBeenCalledWith('test'));
    expect(stopAllQaRuns).toHaveBeenCalledTimes(1);
  });
});

it('separates terminal history, closes detail, reruns, and deletes completed runs', async () => {
  const terminal: RunSummary = { runId:'RUN-DONE',createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:02:00Z',status:'COMPLETED',executionMode:'visible',requestedConcurrency:2,targetSummary:'done.example',deviceFamilies:['Desktop'],counters:{requested:2,running:0,queued:0,completed:2,failed:0,cancelled:0,incomplete:0}};
  const rerunQaRun=vi.fn().mockResolvedValue({runId:'RUN-DONE',rerun:true,sourceRunId:'RUN-DONE'});
  const deleteQaRun=vi.fn().mockResolvedValue({runId:'RUN-DONE',deleted:true});
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{
    listQaRuns:vi.fn().mockResolvedValue([runs[0],terminal]),
    getQaRun:vi.fn(async(id:string)=>({...([runs[0],terminal].find(r=>r.runId===id)!),config:{},logs:[]})),
    stopQaRun,pauseQaRun,resumeQaRun,stopAllQaRuns,rerunQaRun,deleteQaRun,onQaEvent:vi.fn(()=>()=>undefined),
  }});
  render(<RunCenter />);
  expect(await screen.findByText('Active Runs')).toBeInTheDocument();
  expect(screen.getByText('Completed Runs')).toBeInTheDocument();
  expect(screen.getByText('done.example')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Run Again'}));
  await waitFor(()=>expect(rerunQaRun).toHaveBeenCalledWith('RUN-DONE'));
  fireEvent.click(screen.getByRole('button',{name:'View'}));
  expect(await screen.findByRole('button',{name:'Close detail'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Close detail'}));
  await waitFor(()=>expect(screen.queryByText('RUN DETAIL')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'Delete'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm delete'}));
  await waitFor(()=>expect(deleteQaRun).toHaveBeenCalledWith('RUN-DONE'));
});

it('shows compact Streaming QA summary in Run Detail',async()=>{
  const streaming: RunSummary={runId:'RUN-STREAM',runKind:'streaming',createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:00:01Z',status:'RUNNING',executionMode:'background',requestedConcurrency:2,targetSummary:'spotify · 2 tracks',deviceFamilies:['Streaming QA'],streamingMeta:{platform:'spotify',accounts:2,tracks:2,slots:2},counters:{requested:4,running:2,queued:2,completed:0,failed:0,cancelled:0,incomplete:0}};
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{listQaRuns:vi.fn().mockResolvedValue([streaming]),getQaRun:vi.fn().mockResolvedValue({...streaming,config:{},logs:[],streamingSummary:{platform:'spotify',slots:2,accounts:2,tracks:2,queueMode:'shuffle',observation:{minSeconds:60,maxSeconds:110}},streamingResults:{}}),stopQaRun,pauseQaRun,resumeQaRun,stopAllQaRuns,onQaEvent:vi.fn(()=>()=>undefined)}});
  render(<RunCenter />);
  await screen.findByText('spotify · 2 tracks');
  fireEvent.click(screen.getByRole('button',{name:'Open'}));
  expect(await screen.findByText('Streaming QA Summary')).toBeInTheDocument();
  expect(screen.getByText('shuffle')).toBeInTheDocument();
  expect(screen.getByText('60–110s')).toBeInTheDocument();
});


it('shows finished-run selectors only when Automatic Run Again is on and saves the selected logical task ids', async () => {
  const completedA: RunSummary = { runId:'RUN-AUTO-A',attemptCount:1,createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:02:00Z',status:'COMPLETED',executionMode:'visible',requestedConcurrency:1,targetSummary:'auto-a.example',deviceFamilies:['Desktop'],counters:{requested:1,running:0,queued:0,completed:1,failed:0,cancelled:0,incomplete:0}};
  const failedB: RunSummary = { ...completedA, runId:'RUN-AUTO-B', targetSummary:'auto-b.example', status:'FAILED' };
  const configureAutoRerun=vi.fn(async(request:{enabled?:boolean;selectedRunIds?:string[]})=>({enabled:request.enabled ?? true,mode:'all-finished' as const,maxConcurrent:2,running:0,queued:0,selectedRunIds:request.selectedRunIds ?? []}));
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{
    listQaRuns:vi.fn().mockResolvedValue([completedA,failedB]),
    getQaRun:vi.fn(),getAutoRerunState:vi.fn().mockResolvedValue({enabled:true,mode:'all-finished',maxConcurrent:2,running:0,queued:0,selectedRunIds:[]}),
    configureAutoRerun,stopQaRun,pauseQaRun,resumeQaRun,stopAllQaRuns,onQaEvent:vi.fn(()=>()=>undefined),
  }});
  render(<RunCenter />);
  expect(await screen.findByText('Select runs for Automatic Run Again')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Automatic rerun auto-a.example'}));
  await waitFor(()=>expect(configureAutoRerun).toHaveBeenCalledWith({selectedRunIds:['RUN-AUTO-A']}));
});

it('shows per-run Proxy IP Summary and actual browser runtime verification in Run Detail', async () => {
  const run: RunSummary = { runId:'RUN-IP',createdAt:'2026-09-19T10:00:00Z',updatedAt:'2026-09-19T10:05:00Z',status:'COMPLETED',executionMode:'visible',requestedConcurrency:1,targetSummary:'ip.example',deviceFamilies:['Desktop'],counters:{requested:1,running:0,queued:0,completed:1,failed:0,cancelled:0,incomplete:0} };
  const runtimeVerification = { runtimeKind:'chrome-installed' as const,browserFamily:'Google Chrome',verificationStatus:'verified' as const,verificationLabel:'REAL INSTALLED GOOGLE CHROME',deviceMode:'desktop',browserVersion:'153.0.1.2',executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',isRealChrome:true,isPhysicalDevice:false };
  const getRunProxyIpSummary = vi.fn().mockResolvedValue({ runId:'RUN-IP',uniqueIps:2,repeatedIpCount:1,observationCount:5,countries:2,rows:[{proxyIdentity:'rotating:p1',proxySource:'rotating',observedIp:'203.0.113.8',countryCode:'NG',firstSeenAt:'2026-09-19T10:00:00Z',lastSeenAt:'2026-09-19T10:04:00Z',totalSeenCount:6,runsSeenCount:2,runId:'RUN-IP',seenInRunCount:4,repeatedInRun:true,historicallyRepeated:true}] });
  Object.defineProperty(window,'orbitqa',{configurable:true,value:{
    listQaRuns:vi.fn().mockResolvedValue([run]),
    getQaRun:vi.fn().mockResolvedValue({...run,config:{},logs:[{type:'session-start',workId:'w1',deviceLabel:'Desktop',browserLabel:'Google Chrome',targetUrl:'https://ip.example'},{type:'runtime-verification',workId:'w1',runtimeVerification}],runtimeVerifications:{w1:runtimeVerification}}),
    getRunProxyIpSummary,
    stopQaRun,pauseQaRun,resumeQaRun,stopAllQaRuns,onQaEvent:vi.fn(()=>()=>undefined),
  }});
  render(<RunCenter />);
  await screen.findByText('ip.example');
  fireEvent.click(screen.getByRole('button',{name:'View'}));
  expect(await screen.findByText('Proxy / IP Summary')).toBeInTheDocument();
  expect(screen.getByText('Proxy observations')).toBeInTheDocument();
  expect(screen.getByText('Seen 4× in this run')).toBeInTheDocument();
  expect(screen.getByText('REAL INSTALLED GOOGLE CHROME')).toBeInTheDocument();
  expect(screen.getByText('153.0.1.2')).toBeInTheDocument();
  expect(getRunProxyIpSummary).toHaveBeenCalledWith('RUN-IP');
});
