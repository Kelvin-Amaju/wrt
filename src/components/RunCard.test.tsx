import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunCard } from './RunCard';
import type { RunSummary } from '../shared/runCenter';

const run: RunSummary = {
  runId:'RUN-A', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), status:'RUNNING', executionMode:'background', requestedConcurrency:10,
  targetSummary:'savevidly.xyz', deviceFamilies:['Desktop','Android'], counters:{requested:20,running:10,queued:5,completed:5,failed:0,cancelled:0,incomplete:0},
};

describe('RunCard', () => {
  it('shows run status, execution mode, counters, and scoped actions', () => {
    const onOpen=vi.fn(), onStop=vi.fn(), onPause=vi.fn(), onResume=vi.fn();
    render(<RunCard run={run} onOpen={onOpen} onStop={onStop} onPause={onPause} onResume={onResume} />);
    expect(screen.getByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('10 concurrency')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Stop'}));
    expect(onStop).toHaveBeenCalledWith('RUN-A');
    fireEvent.click(screen.getByRole('button',{name:'Pause'}));
    expect(onPause).toHaveBeenCalledWith('RUN-A');
  });
});

it('labels streaming QA cards with slots and account/track summary',()=>{
  const streaming: RunSummary={...run,runId:'RUN-S',runKind:'streaming',targetSummary:'spotify · 4 tracks',requestedConcurrency:2,deviceFamilies:['Streaming QA'],streamingMeta:{platform:'spotify',accounts:2,tracks:4,slots:2}};
  render(<RunCard run={streaming} onOpen={vi.fn()} onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />);
  expect(screen.getByText('Streaming QA')).toBeInTheDocument();
  expect(screen.getByText('2 slots')).toBeInTheDocument();
  expect(screen.getByText('2 accounts · 4 tracks')).toBeInTheDocument();
});

it('shows attempt count and automatic rerun selection on a logical task card',()=>{
  const repeated: RunSummary={...run,runId:'RUN-REPEAT',attemptCount:4,autoRerunSelected:true};
  render(<RunCard run={repeated} onOpen={vi.fn()} onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />);
  expect(screen.getByText('Attempt 4')).toBeInTheDocument();
  expect(screen.getByText('AUTO RUN AGAIN')).toBeInTheDocument();
});
