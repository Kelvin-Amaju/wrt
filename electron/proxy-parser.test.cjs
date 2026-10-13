const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProxyLine, parseProxyImport, proxyIdentity, toProxyServer } = require('./proxy-parser.cjs');

test('normalizes supported proxy import forms', () => {
  assert.deepEqual(parseProxyLine('proxy.test:8080', 'rotating').value, {
    kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080, username: '', password: '',
  });
  assert.equal(parseProxyLine('proxy.test:8080:alice:secret', 'static').value.username, 'alice');
  assert.equal(parseProxyLine('socks5://alice:secret@proxy.test:1080', 'static').value.protocol, 'socks5');
  assert.equal(toProxyServer(parseProxyLine('https://proxy.test:8443', 'rotating').value), 'https://proxy.test:8443');
});

test('accepts common purchased-proxy credential layouts', () => {
  const a = parseProxyLine('alice:secret@proxy.test:8080', 'rotating');
  assert.equal(a.ok, true);
  assert.equal(a.value.username, 'alice');
  assert.equal(a.value.password, 'secret');
  assert.equal(a.value.hostname, 'proxy.test');
  assert.equal(a.value.port, 8080);

  const b = parseProxyLine('proxy.test:8080:alice:pass:with:colons', 'rotating');
  assert.equal(b.ok, true);
  assert.equal(b.value.password, 'pass:with:colons');

  const c = parseProxyLine('socks://alice:secret@proxy.test:1080', 'static');
  assert.equal(c.ok, true);
  assert.equal(c.value.protocol, 'socks5');

  const d = parseProxyLine('socks5h://alice:secret@proxy.test:1080', 'static');
  assert.equal(d.ok, true);
  assert.equal(d.value.protocol, 'socks5');
});

test('accepts bracketed IPv6 endpoints', () => {
  const plain = parseProxyLine('[2001:db8::1]:8080', 'rotating');
  assert.equal(plain.ok, true);
  assert.equal(plain.value.hostname, '2001:db8::1');
  assert.equal(toProxyServer(plain.value), 'http://[2001:db8::1]:8080');

  const auth = parseProxyLine('[2001:db8::1]:8080:alice:secret', 'static');
  assert.equal(auth.ok, true);
  assert.equal(auth.value.username, 'alice');

  const url = parseProxyLine('http://alice:secret@[2001:db8::2]:8081', 'static');
  assert.equal(url.ok, true);
  assert.equal(url.value.hostname, '2001:db8::2');
  assert.equal(toProxyServer(url.value), 'http://[2001:db8::2]:8081');
});

test('rejects malformed protocol and port', () => {
  assert.equal(parseProxyLine('ftp://proxy.test:21', 'rotating').ok, false);
  assert.equal(parseProxyLine('proxy.test:notaport', 'rotating').ok, false);
  assert.equal(parseProxyLine('proxy.test:70000', 'rotating').ok, false);
});

test('duplicate identity ignores password but includes username', () => {
  const a = parseProxyLine('http://alice:first@proxy.test:8080', 'rotating').value;
  const b = parseProxyLine('http://alice:second@proxy.test:8080', 'rotating').value;
  assert.equal(proxyIdentity(a), proxyIdentity(b));
  const c = parseProxyLine('http://bob:second@proxy.test:8080', 'rotating').value;
  assert.notEqual(proxyIdentity(a), proxyIdentity(c));
});

test('bulk import skips blank lines and returns invalid lines separately', () => {
  const result = parseProxyImport('proxy.test:8080\n\nbad-line\nsocks5://proxy2.test:1080', 'rotating');
  assert.equal(result.accepted.length, 2);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.invalid[0].line, 'bad-line');
});
