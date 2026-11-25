import { createECDH, randomBytes } from 'node:crypto';

const key = createECDH('prime256v1');
key.generateKeys();
process.stdout.write(`${JSON.stringify({
  VAPID_PUBLIC_KEY: key.getPublicKey('base64url', 'uncompressed'),
  VAPID_PRIVATE_KEY: key.getPrivateKey('base64url'),
  WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
}, null, 2)}\n`);
