import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Warmer } from './index';

afterEach(() => { delete (window as any).orbitqa; vi.restoreAllMocks(); });

describe('Warmer page', () => {
  test('shows the empty topic state and deduplicates topics through IPC', async () => {
    let topics: any[] = [];
    const bridge = (window as any).orbitqa = { listWarmerTopics: vi.fn(async () => topics), listPods: vi.fn(async () => []), listWarmerAssignments: vi.fn(async () => []), listWarmerRuns: vi.fn(async () => []), addWarmerTopic: vi.fn(async (label: string) => { if (!topics.some((x) => x.label.toLowerCase() === label.toLowerCase())) topics = [...topics, { id: 'topic-1', label, createdAt: 'now' }]; return topics[0]; }), removeWarmerTopic: vi.fn(async () => {}) };
    render(<Warmer />); expect(await screen.findByText(/No topics yet/)).toBeTruthy();
    const input = screen.getByPlaceholderText('Add topic (e.g. investments, finance)');
    fireEvent.change(input, { target: { value: 'Finance' } }); fireEvent.click(screen.getByRole('button', { name: 'Add Topic' }));
    await screen.findByText('Finance'); fireEvent.change(input, { target: { value: 'finance' } }); fireEvent.click(screen.getByRole('button', { name: 'Add Topic' }));
    await waitFor(() => expect(bridge.addWarmerTopic).toHaveBeenCalledTimes(1));
  });

  test('assign button submits the validated account fields to IPC', async () => {
    const bridge = (window as any).orbitqa = { listWarmerTopics: vi.fn(async () => []), listPods: vi.fn(async () => []), listWarmerAssignments: vi.fn(async () => []), listWarmerRuns: vi.fn(async () => []), addWarmerAssignment: vi.fn(async () => ({})) };
    render(<Warmer />); fireEvent.change(await screen.findByPlaceholderText('account@gmail.com'), { target: { value: 'qa@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. YouTube warmup'), { target: { value: 'Regression' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(bridge.addWarmerAssignment).toHaveBeenCalledWith({ email: 'qa@example.com', purpose: 'Regression', podId: null, profileId: null }));
  });
});
