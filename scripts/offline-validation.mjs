/** Validation preload: fail closed on network attempts and avoid local credential/environment files. */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const denied = () => { throw new Error('Network access disabled for offline validation.'); };
globalThis.fetch = async () => denied();
for (const library of [http, https]) { library.request = denied; library.get = denied; }
net.connect = denied; net.createConnection = denied; net.Socket.prototype.connect = denied;
tls.connect = denied;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) dns[key] = denied;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) dns.promises[key] = async () => denied();

const protectedPath = path => {
  const text = String(path);
  return /(?:^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*|[^/]*\.(?:pem|der)|profile\.json)$/.test(text)
    || /\/Users\/yuta\/(?:\.config|\.wrangler|Library\/Preferences\/\.wrangler)(?:\/|$)/.test(text);
};
for (const name of ['readFileSync', 'readFile', 'openSync', 'open']) {
  const original = fs[name];
  fs[name] = function(path, ...args) {
    if (protectedPath(path)) {
      const error = Object.assign(new Error('Protected local configuration is unavailable during offline validation.'), { code: 'ENOENT' });
      if (typeof args.at(-1) === 'function') { args.at(-1)(error); return; }
      throw error;
    }
    return original.call(this, path, ...args);
  };
}
for (const name of ['readFile', 'open']) {
  const original = fs.promises[name];
  fs.promises[name] = async function(path, ...args) {
    if (protectedPath(path)) throw Object.assign(new Error('Protected local configuration is unavailable during offline validation.'), { code: 'ENOENT' });
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();
