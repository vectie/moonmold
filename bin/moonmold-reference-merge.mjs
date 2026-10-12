#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { mergeReferenceLayouts } from '../adapter/reference-layout-merge.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

async function readLayout(file) {
  if ((await stat(file)).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  const bytes = await readFile(file);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
}
try {
  const options = {};
  const usage = 'usage: moonmold-reference-merge --input current.layout.json --incoming saved.layout.json --prefix name [--translation-mm x,y,z] [--format layout|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--incoming', '--prefix', '--translation-mm', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (!options['--input'] || !options['--incoming'] || !options['--prefix']) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  const coordinates = (options['--translation-mm'] ?? '0,0,0').split(',');
  if (coordinates.length !== 3 || coordinates.some(n => !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(n))) throw Error('--translation-mm needs three comma-separated decimal numbers');
  const result = mergeReferenceLayouts({ layout: await readLayout(options['--input']),
    incoming_layout: await readLayout(options['--incoming']), id_prefix: options['--prefix'], translation_mm: coordinates.map(Number) });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-layout-merge-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
