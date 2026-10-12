#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { composeReferenceLayout, LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { calibrateReferenceLayout } from '../adapter/reference-calibration.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instance', '--a-vertex', '--b-vertex', '--length-mm', '--expect-layout-sha256', '--expect-geometry-sha256', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-calibrate --input layout.json --instance id --a-vertex 0 --b-vertex 1 --length-mm number [--expect-layout-sha256 hash --expect-geometry-sha256 hash] [--format layout|json|obj|stl] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  for (const key of ['--input', '--instance', '--a-vertex', '--b-vertex', '--length-mm']) if (!(key in options)) throw Error(`${key} is required`);
  for (const key of ['--a-vertex', '--b-vertex']) if (!/^(0|[1-9][0-9]*)$/.test(options[key]) || !Number.isSafeInteger(Number(options[key]))) throw Error(`${key} requires a zero-based integer`);
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(options['--length-mm'])) throw Error('--length-mm requires a positive decimal number');
  if (('--expect-layout-sha256' in options) !== ('--expect-geometry-sha256' in options)) throw Error('Supply both expected hashes, or neither to calibrate the supplied current file');
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), before = composeReferenceLayout(layout);
  const result = calibrateReferenceLayout({ layout,
    endpoint_a: { instance_id: options['--instance'], vertex_index: Number(options['--a-vertex']) },
    endpoint_b: { instance_id: options['--instance'], vertex_index: Number(options['--b-vertex']) },
    target_distance_mm: Number(options['--length-mm']),
    expected_layout_sha256: options['--expect-layout-sha256'] ?? before.layout_sha256,
    expected_geometry_sha256: options['--expect-geometry-sha256'] ?? before.geometry_sha256 });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-calibration-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
