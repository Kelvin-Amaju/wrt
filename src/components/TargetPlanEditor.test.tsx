import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TargetPlanEditor } from './TargetPlanEditor';
import { createDefaultTargetPlan, type QaTargetPlan } from '../shared/qaMatrix';

const proxySummary = {
  total: 4, live: 3, slow: 1, dead: 0, unavailable: 0, testing: 0, checking: 0,
  rotatingLive: 2, rotatingSlow: 1, staticLive: 1, staticSlow: 0,
};

function renderEditor(targets: QaTargetPlan[] = [createDefaultTargetPlan('savevidly.xyz')]) {
  const onChange = vi.fn();
  render(
    <TargetPlanEditor
      targets={targets}
      onChange={onChange}
      androidAvds={['Pixel_7_API_35']}
      proxySummary={proxySummary}
      realIosConfig={{
        providerName: 'Cloud', remoteUrl: 'https://hub.test/wd/hub', username: 'qa',
        defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari', credentialsSaved: true,
      }}
      realIosStatus={{
        configured: true, reachable: true, authenticated: true,
        safariSupported: true, chromeSupported: false, message: 'ready',
      }}
    />,
  );
  return onChange;
}

describe('TargetPlanEditor', () => {
  it('edits one target with independent device-group settings', () => {
    const onChange = renderEditor();
    fireEvent.change(screen.getByLabelText('Target 1 group 1 instances'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as QaTargetPlan[];
    expect(next[0].groups[0]).toMatchObject({ executionKind: 'desktop', browser: 'chrome-installed', instances: 5 });
  });

  it('adds an Android mobile emulation group without changing the existing desktop group', () => {
    const onChange = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add device group to target 1' }));
    const next = onChange.mock.calls.at(-1)?.[0] as QaTargetPlan[];
    expect(next[0].groups).toHaveLength(2);
    expect(next[0].groups[0].executionKind).toBe('desktop');
    expect(next[0].groups[1]).toMatchObject({ executionKind: 'android-emulation', browser: 'chrome-android', deviceProfile: 'Pixel 11' });
  });

  it('can change a group to iPhone/iPad compatibility with an independent duration and proxy source', () => {
    const onChange = renderEditor();
    fireEvent.change(screen.getByLabelText('Target 1 group 1 device type'), { target: { value: 'ios-emulation' } });
    const changed = onChange.mock.calls.at(-1)?.[0] as QaTargetPlan[];
    expect(changed[0].groups[0]).toMatchObject({ executionKind: 'ios-emulation', browser: 'chrome-installed', deviceProfile: 'iPhone 18 Pro' });
  });

  it('adds and removes independent target cards', () => {
    const onChange = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add target website' }));
    const added = onChange.mock.calls.at(-1)?.[0] as QaTargetPlan[];
    expect(added).toHaveLength(2);
    expect(added[1].groups).toHaveLength(1);
  });

  it('shows the total generated work-unit count', () => {
    const target = createDefaultTargetPlan('example.com');
    target.groups[0].instances = 5;
    target.groups.push({ ...target.groups[0], id: 'mobile', executionKind: 'android-emulation', browser: 'chrome-android', deviceProfile: 'Pixel 7', instances: 6 });
    renderEditor([target]);
    expect(screen.getByText('11 work units')).toBeInTheDocument();
  });

  it('disables empty proxy pools but exposes verified-slow opt-in when available', () => {
    renderEditor();
    expect(screen.getByRole('option', { name: /Rotating Pool · 2 live · 1 slow/i })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: /Static Pool · 1 live · 0 slow/i })).not.toBeDisabled();
  });

  it('offers Smart Mix when either verified rotating or static routes exist', () => {
    renderEditor();
    expect(screen.getByRole('option', { name: /Smart Mix · Rotating \+ Static/i })).not.toBeDisabled();
  });

});
