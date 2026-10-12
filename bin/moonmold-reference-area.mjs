#!/usr/bin/env node
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { measureReferenceSurfaceArea } from '../adapter/reference-surface-area.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  const usage = 'usage: moonmold-reference-area --input saved.layout.json [--instances id1,id2] [--format json|csv] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instances', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (!options['--input']) throw Error(usage);
  const format = options['--format'] ?? 'json';
  if (!['json', 'csv'].includes(format)) throw Error('format must be json or csv');
  const info = await lstat(options['--input']);
  if (!info.isFile() || info.size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout must be a regular local file within 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const instance_ids = options['--instances']?.split(',') ?? layout?.instances?.map(item => item?.id);
  const result = measureReferenceSurfaceArea({ layout, instance_ids });
  if (options['--output']) await writeFile(options['--output'], result.exports[format], { flag: 'wx' });
  else process.stdout.write(result.exports[format]);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-surface-area-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
