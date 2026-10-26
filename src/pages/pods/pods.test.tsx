import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Pods } from './index';

afterEach(() => { delete (window as any).orbitqa; vi.restoreAllMocks(); });

describe('Pods page', () => {
  test('shows the empty state', async () => {
    (window as any).orbitqa = { listPods: vi.fn(async () => []), listPodProfiles: vi.fn(async () => []), listProxies: vi.fn(async () => []) };
    render(<Pods />); expect(await screen.findByText(/No pods yet/)).toBeTruthy();
  });

  test('creates a pod through IPC and reloads it', async () => {
    const pod = { id: 'pod-1', name: 'QA', deviceType: 'desktop', count: 1, country: 'US', createdAt: 'now' };
    const profile = { id: 'profile-1', podId: 'pod-1', index: 1, deviceType: 'desktop', country: 'US', fingerprint: { browserFamily: 'chromium', userAgent: 'Chrome', viewport: { width: 100, height: 100 }, timezoneId: 'UTC' }, proxyId: null, status: 'NEW', createdAt: 'now', lastWarmedAt: null, warmCount: 0 };
    const bridge: any = {}; Object.assign(bridge, { listPods: vi.fn(async () => bridge.created ? [pod] : []), listPodProfiles: vi.fn(async () => bridge.created ? [profile] : []), listProxies: vi.fn(async () => []), createPod: vi.fn(async () => { bridge.created = true; return { ok: true, pod, profiles: [profile] }; }) }); (window as any).orbitqa = bridge;
    render(<Pods />); fireEvent.change(await screen.findByPlaceholderText('e.g. YouTube-Pod-1'), { target: { value: 'QA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pod' }));
    await waitFor(() => expect(bridge.createPod).toHaveBeenCalledWith(expect.objectContaining({ name: 'QA', deviceType: 'desktop', count: 20, country: 'US', fingerprints: expect.any(Array) })));
    expect(await screen.findByText('QA')).toBeTruthy();
  });
});
