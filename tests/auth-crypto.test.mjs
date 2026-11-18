import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const cryptoApi = webcrypto;
const encoder = new TextEncoder();
const toB64 = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64 = (value) => new Uint8Array(Buffer.from(value, 'base64url'));

async function hashPassword(password, salt) {
  const key = await cryptoApi.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await cryptoApi.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256
  );
  return toB64(new Uint8Array(bits));
}

test('PBKDF2-SHA256 credentials match the education platform format', async () => {
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const password = 'Correct-Horse-2026!';
  const storedHash = await hashPassword(password, salt);
  assert.equal(await hashPassword(password, fromB64(toB64(salt))), storedHash);
  assert.notEqual(await hashPassword('Wrong-password', salt), storedHash);
});
