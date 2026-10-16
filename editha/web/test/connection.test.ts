import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connection, isPathFailure } from '../src/api/connection.js';

describe('connessione', () => {
  it('riconosce i guasti del percorso verso Editha', () => {
    assert.equal(isPathFailure(502, null), true);
    assert.equal(isPathFailure(504, '<html>Bad Gateway</html>'), true);
    assert.equal(isPathFailure(401, null), true);
  });

  it('non confonde gli errori di Editha con un guasto del percorso', () => {
    assert.equal(isPathFailure(503, { error: { code: 'ha_unavailable' } }), false);
    assert.equal(isPathFailure(404, null), false);
    assert.equal(isPathFailure(409, { error: { code: 'conflict' } }), false);
  });

  it('notifica solo i cambi di stato', () => {
    let changes = 0;
    connection.addEventListener('change', () => changes++);
    connection.report(true);
    connection.report(false);
    connection.report(false);
    connection.report(true);
    assert.equal(changes, 2);
  });
});
