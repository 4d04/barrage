// Makes the arcade's relay key (the one key that signs submit_score). Run once per chain, before genesis.
// Usage: node server/keygen.js [path]   (default chain/.arcade-key.json). Prints only the address.
import fs from 'node:fs';
import path from 'node:path';
import { newKey } from './chain.js';

const file = path.resolve(process.argv[2] || process.env.ARCADE_KEY_FILE || 'chain/.arcade-key.json');
if (fs.existsSync(file)) {
  console.log(JSON.parse(fs.readFileSync(file, 'utf8')).address);
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
const k = newKey();
fs.writeFileSync(file, JSON.stringify(k), { mode: 0o600 });
console.log(k.address);
