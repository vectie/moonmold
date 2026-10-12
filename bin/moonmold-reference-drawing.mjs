#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { drawReferenceLayout } from '../adapter/reference-drawing.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-drawing --input layout.json [--format svg|json] [--output new-drawing.svg]');
    options[key] = process.argv[i + 1];
  }
  if (!options['--input']) throw Error('--input is required');
  const format = options['--format'] ?? 'svg';
  if (!['svg', 'json'].includes(format)) throw Error('--format must be svg or json');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const { exports, ...report } = drawReferenceLayout(layout);
  const output = format === 'svg' ? exports.svg : JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-drawing-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
