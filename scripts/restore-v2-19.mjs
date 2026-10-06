// Restores Abatement Link v2.19 source files before Netlify/Vite build.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const chunkCount = 9;
let encodedManifest = '';
for (let i = 0; i < chunkCount; i += 1) {
  encodedManifest += readFileSync(`scripts/v219-data/part-${String(i).padStart(2, '0')}.b64`, 'utf8').trim();
}

const pieces = JSON.parse(gunzipSync(Buffer.from(encodedManifest, 'base64')).toString('utf8'));
for (const [path, encodedFile] of pieces) {
  const buffer = gunzipSync(Buffer.from(encodedFile, 'base64'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

console.log(`Restored ${pieces.length} Abatement Link v2.19 source files.`);
