#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { moveReferenceArrangement } from '../adapter/reference-arrangement.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  const usage = 'usage: moonmold-reference-arrange --input saved.layout.json --instances id,id --pivot-mm x,y,z --rotation-deg x,y,z [--translation-mm x,y,z] [--format layout|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instances', '--pivot-mm', '--rotation-deg', '--translation-mm', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (!options['--input'] || !options['--instances'] || !options['--pivot-mm'] || !options['--rotation-deg']) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  const vector = (text, label) => {
    const values = text.split(',');
    if (values.length !== 3 || values.some(n => !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(n))) throw Error(`${label} needs three comma-separated decimal numbers`);
    return values.map(Number);
  };
  const file = options['--input'];
  if ((await stat(file)).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  const bytes = await readFile(file);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  const result = moveReferenceArrangement({ layout, instance_ids: options['--instances'].split(','),
    pivot_mm: vector(options['--pivot-mm'], '--pivot-mm'), rotation_deg: vector(options['--rotation-deg'], '--rotation-deg'),
    translation_mm: vector(options['--translation-mm'] ?? '0,0,0', '--translation-mm') });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-arrangement-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
