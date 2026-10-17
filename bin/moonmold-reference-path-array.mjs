#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { arrayReferencePath } from '../adapter/reference-path-array.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instance', '--count', '--points-mm', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-path-array --input layout.json --instance id --count 5 --points-mm 0,0,0;100,0,0;100,100,0 [--format layout|json|obj|stl] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  for (const key of ['--input', '--instance', '--count', '--points-mm']) if (!(key in options)) throw Error(`${key} is required`);
  if (!/^[0-9]+$/.test(options['--count'])) throw Error('--count requires an integer');
  const points = options['--points-mm'].split(';').map(row => {
    const values = row.split(',');
    if (values.length !== 3 || values.some(n => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(n))) throw Error('--points-mm needs semicolon-separated x,y,z decimal triples');
    return values.map(Number);
  });
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const result = arrayReferencePath({ layout, instance_id: options['--instance'], count: Number(options['--count']), points_mm: points });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-array-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
