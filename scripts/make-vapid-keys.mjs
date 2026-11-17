#!/usr/bin/env node
// Makes the one-time key pair that phone notifications need. Run it ONCE:  node scripts/make-vapid-keys.mjs
// Both go in as Cloudflare secrets (Pages project > Settings > Variables and Secrets): VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Never commit the private one.
import { webcrypto as crypto } from 'node:crypto';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log('\nVAPID_PUBLIC_KEY  (safe to publish):\n' + b64u(await crypto.subtle.exportKey('raw', pair.publicKey)));
console.log('\nVAPID_PRIVATE_KEY (SECRET: Supabase secrets only, never in the repo or the page):\n' + jwk.d + '\n');
