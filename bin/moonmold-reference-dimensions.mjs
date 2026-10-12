#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { drawReferenceDimensions, DIMENSIONS_MAX_FILE_BYTES } from '../adapter/reference-dimensions.mjs';
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--dimensions', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-dimensions --input layout.json --dimensions named.dimensions.json [--format svg|json] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  if (!options['--input'] || !options['--dimensions']) throw Error('--input and --dimensions are required');
  const format = options['--format'] ?? 'svg';
  if (!['svg', 'json'].includes(format)) throw Error('--format must be svg or json');
  async function json(file, maximum) {
    if ((await stat(file)).size > maximum) throw Error(`Input exceeds ${maximum} bytes`);
    const bytes = await readFile(file);
    if (bytes.length > maximum) throw Error(`Input exceeds ${maximum} bytes`);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const { exports, ...report } = drawReferenceDimensions({ layout: await json(options['--input'], LAYOUT_MAX_FILE_BYTES), dimensions: await json(options['--dimensions'], DIMENSIONS_MAX_FILE_BYTES) });
  const output = format === 'svg' ? exports.svg : JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-dimensions-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
