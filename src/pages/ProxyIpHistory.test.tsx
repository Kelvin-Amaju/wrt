import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyIpHistory } from './ProxyIpHistory';
import type { ProxyIpHistoryPage } from '../shared/proxyIpHistory';

const page: ProxyIpHistoryPage = {
  page: 1,
  pageSize: 100,
  total: 2,
  totalPages: 2,
  summary: { uniqueIps: 2, repeatedIps: 1, countries: 2, totalObservations: 4 },
  rows: [
    { proxyIdentity:'rotating:p1', proxySource:'rotating', observedIp:'102.89.33.10', countryCode:'NG', firstSeenAt:'2026-09-19T10:00:00Z', lastSeenAt:'2026-09-19T10:05:00Z', totalSeenCount:3, runsSeenCount:1, lastRunId:'RUN-1', seenInRunCount:3, repeatedInRun:true, historicallyRepeated:true },
    { proxyIdentity:'rotating:p2', proxySource:'rotating', observedIp:'45.67.21.91', countryCode:'DE', firstSeenAt:'2026-09-19T11:00:00Z', lastSeenAt:'2026-09-19T11:00:00Z', totalSeenCount:1, runsSeenCount:1, lastRunId:'RUN-2', repeatedInRun:false, historicallyRepeated:false },
  ],
};

const listProxyIpHistory = vi.fn();
const clearProxyIpHistory = vi.fn();
const exportProxyIpHistoryCsv = vi.fn();
const getProxyIpHistoryRecordingState = vi.fn();
const setProxyIpHistoryRecordingState = vi.fn();

beforeEach(() => {
  listProxyIpHistory.mockReset().mockResolvedValue(page);
  clearProxyIpHistory.mockReset().mockResolvedValue(true);
  exportProxyIpHistoryCsv.mockReset().mockResolvedValue('IP,Country\n102.89.33.10,NG');
  getProxyIpHistoryRecordingState.mockReset().mockResolvedValue({ recordingEnabled:true });
  setProxyIpHistoryRecordingState.mockReset().mockResolvedValue({ recordingEnabled:true });
  Object.defineProperty(window, 'orbitqa', { configurable:true, value:{ listProxyIpHistory, clearProxyIpHistory, exportProxyIpHistoryCsv, getProxyIpHistoryRecordingState, setProxyIpHistoryRecordingState } });
  Object.defineProperty(URL, 'createObjectURL', { configurable:true, value:vi.fn(()=>'blob:history') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable:true, value:vi.fn() });
});

describe('ProxyIpHistory', () => {
  it('loads one bounded page and shows summary/repeat truth', async () => {
    render(<ProxyIpHistory />);
    expect(await screen.findByText('REPEATED IN RUN')).toBeInTheDocument();
    expect(screen.getAllByText('3×')).toHaveLength(2);
    expect(screen.getByText('HISTORICALLY REPEATED')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.getByText('Total Observations')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    await waitFor(() => expect(listProxyIpHistory).toHaveBeenCalledWith(expect.objectContaining({ page:1, pageSize:100 })));
  });


  it('shows confirmed recording state and only updates after main-process confirmation', async () => {
    let resolveSave!: (value: { recordingEnabled:boolean }) => void;
    setProxyIpHistoryRecordingState.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ProxyIpHistory />);
    expect(await screen.findByText('ACTIVE', { selector:'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'Set Proxy IP History recording INACTIVE' }));
    expect(screen.getByText('ACTIVE', { selector:'strong' })).toBeInTheDocument();
    resolveSave({ recordingEnabled:false });
    expect(await screen.findByText('INACTIVE', { selector:'strong' })).toBeInTheDocument();
  });

  it('keeps the last confirmed state when recording-state persistence fails', async () => {
    setProxyIpHistoryRecordingState.mockRejectedValue(new Error('disk full'));
    render(<ProxyIpHistory />);
    await screen.findByText('ACTIVE', { selector:'strong' });
    fireEvent.click(screen.getByRole('button', { name:'Set Proxy IP History recording INACTIVE' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByText('ACTIVE', { selector:'strong' })).toBeInTheDocument();
  });

  it('keeps existing history readable, exportable, and clearable while recording is inactive', async () => {
    getProxyIpHistoryRecordingState.mockResolvedValue({ recordingEnabled:false });
    render(<ProxyIpHistory />);
    expect(await screen.findByText('INACTIVE', { selector:'strong' })).toBeInTheDocument();
    expect(screen.getByText('102.89.33.10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name:'Export CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name:'Clear History' })).toBeEnabled();
  });

  it('sends filters and pagination to the backend rather than loading the full history', async () => {
    render(<ProxyIpHistory />);
    await screen.findByText('102.89.33.10');
    fireEvent.change(screen.getByRole('searchbox', { name:'Search IP or proxy' }), { target:{ value:'102.89.33' } });
    await waitFor(() => expect(listProxyIpHistory).toHaveBeenCalledWith(expect.objectContaining({ search:'102.89.33', page:1, pageSize:100 })));
    fireEvent.click(screen.getByRole('button', { name:'Next' }));
    await waitFor(() => expect(listProxyIpHistory).toHaveBeenCalledWith(expect.objectContaining({ page:2, pageSize:100 })));
  });

  it('requires confirmation before clearing and exports only through the safe history API', async () => {
    render(<ProxyIpHistory />);
    await screen.findByText('102.89.33.10');
    fireEvent.click(screen.getByRole('button', { name:'Clear History' }));
    expect(clearProxyIpHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name:'Confirm clear' }));
    await waitFor(() => expect(clearProxyIpHistory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name:'Export CSV' }));
    await waitFor(() => expect(exportProxyIpHistoryCsv).toHaveBeenCalledWith(expect.objectContaining({ page:1, pageSize:100 })));
  });
});
