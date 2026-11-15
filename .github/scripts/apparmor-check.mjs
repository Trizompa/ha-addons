// SEC-10: the main features of EDITHA must keep working with the AppArmor profile enforced.
// Run by the Editha CI workflow from a container with the Ingress proxy address (172.30.32.2).
// Usage: node apparmor-check.mjs http://<editha address>:8099

const base = process.argv[2];

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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

// Reading and searching.
await call('GET', '/api/tree');
await call('POST', '/api/search', { query: 'AppArmor' });

// Local Git: git runs as a child process and writes /config/.git.
await call('POST', '/api/git/init');
const commit = await call('POST', '/api/git/commit', { message: 'AppArmor check', all: true });
if (!commit.hash) throw new Error('commit without hash');
await call('GET', '/api/git/status');
await call('GET', '/api/git/log');

console.log('all features work with the profile enforced');
