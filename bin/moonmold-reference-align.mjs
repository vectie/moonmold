#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { alignReferenceLayout } from '../adapter/reference-alignment.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instance', '--reference', '--axis', '--moving-anchor', '--reference-anchor', '--offset-mm', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-align --input layout.json --instance id --reference id --axis x|y|z --moving-anchor min|center|max --reference-anchor min|center|max --offset-mm number [--format layout|json|obj|stl] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  for (const key of ['--input', '--instance', '--reference', '--axis', '--moving-anchor', '--reference-anchor', '--offset-mm']) if (!(key in options)) throw Error(`${key} is required`);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(options['--offset-mm'])) throw Error('--offset-mm requires a decimal number');
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const result = alignReferenceLayout({ layout, instance_id: options['--instance'], reference_id: options['--reference'], axis: options['--axis'], moving_anchor: options['--moving-anchor'], reference_anchor: options['--reference-anchor'], offset_mm: Number(options['--offset-mm']) });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-alignment-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
