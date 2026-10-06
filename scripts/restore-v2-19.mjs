// Restores Abatement Link v2.19 source files before Netlify/Vite build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import data0 from './v219-data-0.mjs';
import data1 from './v219-data-1.mjs';
import data2 from './v219-data-2.mjs';
import data3 from './v219-data-3.mjs';
import data4 from './v219-data-4.mjs';
import data5 from './v219-data-5.mjs';
import data6 from './v219-data-6.mjs';
import data7 from './v219-data-7.mjs';
import data8 from './v219-data-8.mjs';
import data9 from './v219-data-9.mjs';

const pieces = [...data0, ...data1, ...data2, ...data3, ...data4, ...data5, ...data6, ...data7, ...data8, ...data9];
const files = new Map();
for (const [path, index, total, text] of pieces) {
  if (!files.has(path)) files.set(path, Array(total).fill(''));
  files.get(path)[index] = text;
}
for (const [path, parts] of files.entries()) {
  const encoded = parts.join('');
  const buffer = gunzipSync(Buffer.from(encoded, 'base64'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}
console.log(`Restored ${files.size} Abatement Link v2.19 source files.`);
