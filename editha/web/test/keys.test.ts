import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutKey, shortcutLabel } from '../src/state/keys.js';

const k = (key: string, code: string, altKey = false, mac = false) => shortcutKey({ key, code, altKey }, mac);

test('scorciatoie: lettera della tastiera, tasto fisico solo per altri alfabeti e Opzione su Mac', () => {
  assert.equal(k('s', 'KeyS'), 's');
  // AZERTY: la W sta dove sul QWERTY c'è la Z.
  assert.equal(k('w', 'KeyZ', true), 'w');
  assert.equal(k('z', 'KeyW', true), 'z');
  // AltGr+S su tastiera polacca scrive «ś»: non è Ctrl+S.
  assert.equal(k('ś', 'KeyS', true), 'ś');
  assert.equal(k('ß', 'KeyS', true), 'ß');
  // Cirillico: Ctrl+S resta Ctrl+S.
  assert.equal(k('ы', 'KeyS'), 's');
  // Mac: Opzione+W scrive «∑».
  assert.equal(k('∑', 'KeyW', true, true), 'w');
  assert.equal(k('Escape', 'Escape'), '');
});

test('etichette delle scorciatoie su Mac', () => {
  assert.equal(shortcutLabel('Ripeti (Ctrl+Y)', true), 'Ripeti (⌘⇧Z)');
  assert.equal(shortcutLabel('Salva tutto (Ctrl+Alt+S)', true), 'Salva tutto (⌘⌥S)');
  assert.equal(shortcutLabel('Cerca (Ctrl+Maiusc+F)', true), 'Cerca (⌘⇧F)');
  assert.equal(shortcutLabel('Salva (Ctrl+S)', false), 'Salva (Ctrl+S)');
});
