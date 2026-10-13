const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

function createRealIosProvider({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  async function request(config, path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
      if (config.username || config.accessKey) {
        headers.authorization = `Basic ${Buffer.from(`${config.username || ''}:${config.accessKey || ''}`).toString('base64')}`;
      }
      const remoteUrl = String(config.remoteUrl || '').replace(/\/$/, '');
      const response = await fetchImpl(`${remoteUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.value?.error) {
        const error = new Error(body?.value?.message || `Provider HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Provider unreachable or timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function findElement(config, sessionId, selector) {
    const body = await request(config, `/session/${encodeURIComponent(sessionId)}/element`, {
      method: 'POST',
      body: JSON.stringify({ using: 'css selector', value: selector }),
    });
    const element = body?.value || {};
    const elementId = element[W3C_ELEMENT_KEY] || element.ELEMENT;
    if (!elementId) throw new Error(`Element not found: ${selector}`);
    return elementId;
  }

  return {
    async checkConnection(config) {
      const body = await request(config, '/status', { method: 'GET' });
      const value = body?.value || {};
      const browsers = Array.isArray(value.supportedBrowsers)
        ? value.supportedBrowsers.map((item) => String(item).toLowerCase())
        : Array.isArray(value.browsers)
          ? value.browsers.map((item) => String(item).toLowerCase())
          : [];
      const safariSupported = typeof value.safariSupported === 'boolean'
        ? value.safariSupported
        : browsers.includes('safari') || (browsers.length === 0 && value.ready !== false);
      const chromeSupported = typeof value.chromeSupported === 'boolean'
        ? value.chromeSupported
        : browsers.includes('chrome');
      return {
        reachable: true,
        authenticated: value.authenticated !== false,
        safariSupported,
        chromeSupported,
        message: String(value.message || (value.ready === false ? 'Provider is not ready' : 'Provider reachable')),
      };
    },

    async createSession(config, selection) {
      const body = await request(config, '/session', {
        method: 'POST',
        body: JSON.stringify({
          capabilities: {
            alwaysMatch: {
              platformName: 'iOS',
              browserName: selection.browser === 'chrome' ? 'chrome' : 'safari',
              'appium:deviceName': selection.device,
              'appium:platformVersion': selection.iosVersion,
              'appium:automationName': 'XCUITest',
            },
          },
        }),
      });
      const value = body?.value || {};
      const sessionId = value.sessionId || body.sessionId;
      if (!sessionId) throw new Error('Provider did not return a session ID');
      return { sessionId, capabilities: value.capabilities || body.capabilities || {} };
    },

    async navigate(config, sessionId, url) {
      await request(config, `/session/${encodeURIComponent(sessionId)}/url`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },

    async executeScript(config, sessionId, script, args = []) {
      const body = await request(config, `/session/${encodeURIComponent(sessionId)}/execute/sync`, {
        method: 'POST',
        body: JSON.stringify({ script, args }),
      });
      return body?.value;
    },

    async executeAsyncScript(config, sessionId, script, args = []) {
      const body = await request(config, `/session/${encodeURIComponent(sessionId)}/execute/async`, {
        method: 'POST',
        body: JSON.stringify({ script, args }),
      });
      return body?.value;
    },

    async click(config, sessionId, selector) {
      const elementId = await findElement(config, sessionId, selector);
      await request(config, `/session/${encodeURIComponent(sessionId)}/element/${encodeURIComponent(elementId)}/click`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async type(config, sessionId, selector, value) {
      const elementId = await findElement(config, sessionId, selector);
      await request(config, `/session/${encodeURIComponent(sessionId)}/element/${encodeURIComponent(elementId)}/value`, {
        method: 'POST',
        body: JSON.stringify({ text: String(value), value: Array.from(String(value)) }),
      });
    },

    async scroll(config, sessionId, direction, distance) {
      const signedDistance = direction === 'up' ? -Math.abs(distance) : Math.abs(distance);
      return this.executeScript(config, sessionId, 'window.scrollBy(0, arguments[0]); return {x: window.scrollX, y: window.scrollY};', [signedDistance]);
    },

    async screenshot(config, sessionId) {
      const body = await request(config, `/session/${encodeURIComponent(sessionId)}/screenshot`, { method: 'GET' });
      if (typeof body?.value !== 'string') throw new Error('Provider did not return screenshot data');
      return body.value;
    },

    async deleteSession(config, sessionId) {
      await request(config, `/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    },
  };
}

module.exports = { createRealIosProvider };
