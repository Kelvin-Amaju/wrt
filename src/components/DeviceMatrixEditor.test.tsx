import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultDeviceMatrix } from '../shared/qaMatrix';
import { DeviceMatrixEditor } from './DeviceMatrixEditor';

const proxySummary = { total: 3, live: 2, slow: 1, dead: 0, unavailable: 0, testing: 0, checking: 0, rotatingLive: 1, rotatingSlow: 1, staticLive: 1, staticSlow: 0 };

describe('DeviceMatrixEditor', () => {
  it('uses device-family checkboxes and only shows controls for enabled families', () => {
    const onChange = vi.fn();
    const value = createDefaultDeviceMatrix();
    render(<DeviceMatrixEditor value={value} onChange={onChange} androidAvds={['Pixel_7_API_35']} proxySummary={proxySummary} realIosConfig={null} realIosStatus={null} disabled={false} />);
    expect(screen.getByLabelText('Desktop')).toBeChecked();
    expect(screen.getByLabelText('Google Chrome — REAL')).toBeChecked();
    expect(screen.queryByLabelText('Pixel 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Android mobile emulation'));
    expect(onChange).toHaveBeenCalled();
  });
});

it('defaults local Test Run families to real Chrome while preserving compatibility choices', () => {
  const onChange = vi.fn();
  const value = createDefaultDeviceMatrix();
  render(<DeviceMatrixEditor value={value} onChange={onChange} androidAvds={['Pixel_7_API_35']} proxySummary={proxySummary} realIosConfig={null} realIosStatus={null} disabled={false} />);
  expect(screen.getByLabelText('Google Chrome — REAL')).toBeChecked();
  expect(screen.getByLabelText('Chromium — Compatibility')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Android mobile emulation'));
  const changed = onChange.mock.calls.at(-1)?.[0];
  render(<DeviceMatrixEditor value={changed} onChange={vi.fn()} androidAvds={['Pixel_7_API_35']} proxySummary={proxySummary} realIosConfig={null} realIosStatus={null} disabled={false} />);
  expect(screen.getByLabelText('Android Google Chrome — REAL')).toBeChecked();
});

it('keeps WebKit iOS/Safari compatibility available next to real Chrome', () => {
  const value = createDefaultDeviceMatrix();
  value.iosEmulation.enabled = true;
  render(<DeviceMatrixEditor value={value} onChange={vi.fn()} androidAvds={['Pixel_7_API_35']} proxySummary={proxySummary} realIosConfig={null} realIosStatus={null} disabled={false} />);
  expect(screen.getByLabelText('iPhone/iPad Google Chrome — REAL')).toBeChecked();
  expect(screen.getByLabelText('WebKit — iOS/Safari Compatibility')).toBeInTheDocument();
});


it('keeps previous Android and iPhone profiles visible alongside the latest devices', () => {
  const value = createDefaultDeviceMatrix();
  value.androidEmulation.enabled = true;
  value.iosEmulation.enabled = true;
  render(<DeviceMatrixEditor value={value} onChange={vi.fn()} androidAvds={['Pixel_7_API_35']} proxySummary={proxySummary} realIosConfig={null} realIosStatus={null} disabled={false} />);
  expect(screen.getByLabelText('Pixel 11')).toBeInTheDocument();
  expect(screen.getByLabelText('Pixel 7')).toBeInTheDocument();
  expect(screen.getByLabelText('Pixel 5')).toBeInTheDocument();
  expect(screen.getByLabelText('Galaxy S23')).toBeInTheDocument();
  expect(screen.getByLabelText('iPhone 18 Pro')).toBeInTheDocument();
  expect(screen.getByLabelText('iPhone 13')).toBeInTheDocument();
  expect(screen.getByLabelText('iPhone 13 Pro Max')).toBeInTheDocument();
});
