import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

const getRealIosProviderConfig = vi.fn();
const saveRealIosProviderConfig = vi.fn();
const checkRealIosProvider = vi.fn();

beforeEach(() => {
  getRealIosProviderConfig.mockReset();
  saveRealIosProviderConfig.mockReset();
  checkRealIosProvider.mockReset();
  getRealIosProviderConfig.mockResolvedValue({
    providerName: 'Device Cloud',
    remoteUrl: 'https://hub.test/wd/hub',
    username: 'qa',
    defaultDevice: 'iPhone 15',
    defaultIosVersion: '17',
    defaultBrowser: 'safari',
    credentialsSaved: true,
  });
  saveRealIosProviderConfig.mockImplementation(async (request) => ({
    providerName: request.providerName,
    remoteUrl: request.remoteUrl,
    username: request.username,
    defaultDevice: request.defaultDevice,
    defaultIosVersion: request.defaultIosVersion,
    defaultBrowser: request.defaultBrowser,
    credentialsSaved: Boolean(request.accessKey) || true,
  }));
  checkRealIosProvider.mockResolvedValue({
    configured: true,
    reachable: true,
    authenticated: true,
    safariSupported: true,
    chromeSupported: false,
    message: 'ready',
  });
  Object.defineProperty(window, 'orbitqa', {
    configurable: true,
    value: { getRealIosProviderConfig, saveRealIosProviderConfig, checkRealIosProvider },
  });
});

describe('Settings', () => {
  it('never renders a stored access key after loading provider settings', async () => {
    render(<Settings />);
    expect(await screen.findByText(/credentials saved/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key/i)).toHaveValue('');
    expect(screen.queryByDisplayValue(/super-secret/i)).not.toBeInTheDocument();
  });

  it('saves provider settings through the narrow desktop bridge', async () => {
    render(<Settings />);
    await screen.findByDisplayValue('Device Cloud');
    fireEvent.change(screen.getByLabelText(/access key/i), { target: { value: 'new-token' } });
    fireEvent.click(screen.getByRole('button', { name: /save provider settings/i }));
    await waitFor(() => expect(saveRealIosProviderConfig).toHaveBeenCalledTimes(1));
    expect(saveRealIosProviderConfig.mock.calls[0][0]).toMatchObject({
      providerName: 'Device Cloud',
      accessKey: 'new-token',
      defaultDevice: 'iPhone 15',
    });
  });

  it('shows provider browser support after connection test', async () => {
    render(<Settings />);
    await screen.findByDisplayValue('Device Cloud');
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText('Safari Supported')).toBeInTheDocument();
    expect(screen.getByText('Chrome iOS Unsupported')).toBeInTheDocument();
  });
});
