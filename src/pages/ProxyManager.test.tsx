import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyManager } from './ProxyManager';

const listProxies = vi.fn();
const getProxySummary = vi.fn();
const getProxyActivity = vi.fn();
const importProxies = vi.fn();
const checkProxy = vi.fn();
const checkProxies = vi.fn();
const recheckDeadProxies = vi.fn();
const deleteProxies = vi.fn();
const setProxiesEnabled = vi.fn();
const exportSafeProxies = vi.fn();
const acceptStaticProxyIp = vi.fn();
const updateProxy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  listProxies.mockResolvedValue([{
    id: 'p1', kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080,
    username: 'alice', hasPassword: true, enabled: true, health: 'live', latencyMs: 140,
    observedIp: '203.0.113.20', failureCount: 0, lastCheckedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }]);
  getProxySummary.mockResolvedValue({ total: 1, live: 1, slow: 0, dead: 0, unavailable: 0, testing: 0, rotatingLive: 1, rotatingSlow: 0, staticLive: 0, staticSlow: 0 });
  getProxyActivity.mockResolvedValue([]);
  importProxies.mockResolvedValue({ accepted: [], duplicates: [], invalid: [{ line: 'bad-line', error: 'Invalid proxy' }] });
  checkProxy.mockResolvedValue({});
  checkProxies.mockResolvedValue([]);
  recheckDeadProxies.mockResolvedValue([]);
  deleteProxies.mockResolvedValue(undefined);
  setProxiesEnabled.mockResolvedValue([]);
  exportSafeProxies.mockResolvedValue('http://alice@proxy.test:8080');
  acceptStaticProxyIp.mockResolvedValue({});
  updateProxy.mockResolvedValue({});

  Object.defineProperty(window, 'orbitqa', {
    configurable: true,
    value: {
      listProxies, getProxySummary, getProxyActivity, importProxies, checkProxy, checkProxies,
      recheckDeadProxies, deleteProxies, setProxiesEnabled, exportSafeProxies,
      acceptStaticProxyIp, updateProxy,
    },
  });
});

describe('ProxyManager', () => {
  it('shows summary cards and separate rotating/static tabs', async () => {
    render(<ProxyManager />);
    expect(await screen.findByRole('button', { name: 'Rotating Pool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Static Pool' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Proxy health summary' })).toHaveTextContent('Live');
    expect(screen.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter proxies')).toBeInTheDocument();
  });

  it('imports multiple proxies into the selected pool and reports invalid rows', async () => {
    render(<ProxyManager />);
    await screen.findByText('proxy.test:8080', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /Add Proxies/i }));
    fireEvent.change(screen.getByLabelText('Proxy import lines'), { target: { value: 'proxy.test:8080\nbad-line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import proxies' }));
    await waitFor(() => expect(importProxies).toHaveBeenCalledWith({ text: 'proxy.test:8080\nbad-line', kind: 'rotating', replacePasswords: false }));
    const dialog = screen.getByRole('dialog', { name: 'Import proxies' });
    expect(within(dialog).getByText(/1 invalid/i)).toBeInTheDocument();
  });

  it('never renders plaintext proxy password returned by test fixtures', async () => {
    listProxies.mockResolvedValueOnce([{
      id: 'p1', kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080,
      username: 'alice', hasPassword: true, password: 'super-secret', enabled: true, health: 'live',
      failureCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]);
    render(<ProxyManager />);
    await screen.findByText('proxy.test:8080', { exact: false });
    expect(document.body.textContent).not.toContain('super-secret');
  });
});
