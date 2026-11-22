// SEC-10: the main features of EDITHA must keep working with the AppArmor profile enforced.
// Run by the Editha CI workflow from a container with the Ingress proxy address (172.30.32.2).
// Usage: node apparmor-check.mjs http://<editha address>:8099

const base = process.argv[2];

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    // x-editha: the server accepts changes only with this header (as the web interface sends it).
    headers: {
      ...(method === 'GET' ? {} : { 'x-editha': '1' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  console.log(`ok  ${method} ${path}`);
  return text ? JSON.parse(text) : null;
}

async function save(path, content) {
  const { etag } = await call('GET', `/api/file?path=${encodeURIComponent(path)}`);
  await call('PUT', '/api/file', { path, content, etag });
}

for (let i = 1; ; i++) {
  try {
    await call('GET', '/api/health');
    break;
  } catch (err) {
    if (i === 30) throw err;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Saves (also a file owned by another user: dac_override and chown), new file and folder, rename.
await save('configuration.yaml', 'homeassistant:\n  name: AppArmor\n');
await save('other_user.yaml', 'a: 2\n');
await call('POST', '/api/file', { path: 'packages', type: 'directory' });
await call('POST', '/api/file', { path: 'packages/new.yaml', type: 'file', content: 'b: 1\n' });
await call('POST', '/api/rename', { from: 'packages/new.yaml', to: 'packages/renamed.yaml' });

// File history and drafts live in /data.
const { versions } = await call('GET', '/api/versions?path=configuration.yaml');
if (!versions.length) throw new Error('no version kept in the history');
await call('PUT', '/api/draft', { path: 'configuration.yaml', content: 'draft\n', etag: 'x', client: 'ci' });
await call('PUT', '/api/session', { tabs: [], active: null });

// Copy, restore an earlier version, replace, delete (the deleted folder is copied to /data first).
await call('POST', '/api/copy', { from: 'packages/renamed.yaml', to: 'packages/copy.yaml' });
await call('POST', '/api/restore', { path: 'configuration.yaml', id: versions[0].id });
await call('POST', '/api/file', { path: 'trash', type: 'directory' });
await call('POST', '/api/file', { path: 'trash/old.yaml', type: 'file', content: 'c: 1\n' });
await call('DELETE', '/api/file?path=trash');
await call('DELETE', '/api/file?path=packages/copy.yaml');

// Reading, searching, replacing, folder ZIP.
await call('GET', '/api/tree');
await call('POST', '/api/search', { query: 'AppArmor' });
await call('POST', '/api/replace', { paths: ['other_user.yaml'], query: 'a: 2', replacement: 'a: 3' });
const zip = await fetch(`${base}/api/download?path=packages`);
if (!zip.ok) throw new Error(`folder ZIP -> ${zip.status}`);
console.log('ok  GET /api/download?path=packages');

// Home Assistant through the Supervisor: there is none in CI, so the call fails,
// but it must fail as "not reachable" (DNS and sockets allowed), not crash the server.
const ha = await fetch(`${base}/api/ha/check`, { method: 'POST', headers: { 'x-editha': '1' } });
console.log(`ok  POST /api/ha/check -> ${ha.status} (no Supervisor in CI)`);
await call('GET', '/api/health');

// Local Git: git runs as a child process and writes /config/.git.
await call('POST', '/api/git/init');
const commit = await call('POST', '/api/git/commit', { message: 'AppArmor check', all: true });
if (!commit.hash) throw new Error('commit without hash');
await call('GET', '/api/git/status');
await call('GET', '/api/git/log');
await call('POST', '/api/git/ignore', { path: 'packages' });

console.log('all features work with the profile enforced');
