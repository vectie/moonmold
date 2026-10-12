#!/usr/bin/env node
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { distributeReferenceLayout } from '../adapter/reference-distribution.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  const usage = 'usage: moonmold-reference-distribute --input saved.layout.json --instances first,middle,last --axis x|y|z [--format layout|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instances', '--axis', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (!options['--input'] || !options['--instances'] || !options['--axis']) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  const info = await lstat(options['--input']);
  if (!info.isFile() || info.size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout must be a regular local file within 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const result = distributeReferenceLayout({ layout, instance_ids: options['--instances'].split(','), axis: options['--axis'] });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-distribution-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
