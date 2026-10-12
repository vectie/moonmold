#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { circularArrayReferenceLayout } from '../adapter/reference-circular-array.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instance', '--axis', '--pivot-mm', '--step-deg', '--count', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-circular-array --input layout.json --instance id --axis x|y|z --pivot-mm 0,0,0 --step-deg 90 --count 4 [--format layout|json|obj|stl] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  for (const key of ['--input', '--instance', '--axis', '--pivot-mm', '--step-deg', '--count']) if (!(key in options)) throw Error(`${key} is required`);
  const number = (value, label) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw Error(`${label} requires decimal numbers`);
    return Number(value);
  };
  const pivot = options['--pivot-mm'].split(',').map(value => number(value, '--pivot-mm'));
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const result = circularArrayReferenceLayout({ layout, instance_id: options['--instance'], axis: options['--axis'],
    pivot_mm: pivot, step_deg: number(options['--step-deg'], '--step-deg'), count: number(options['--count'], '--count') });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-circular-array-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
