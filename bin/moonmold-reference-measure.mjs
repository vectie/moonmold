#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { composeReferenceLayout, LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { measureReferenceLayout } from '../adapter/reference-measurement.mjs';

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--a-instance', '--a-vertex', '--b-instance', '--b-vertex', '--expect-layout-sha256', '--expect-geometry-sha256', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-measure --input layout.json --a-instance id --a-vertex 0 --b-instance id --b-vertex 1 [--expect-layout-sha256 hash --expect-geometry-sha256 hash] [--output new-report.json]');
    options[key] = process.argv[i + 1];
  }
  for (const key of ['--input', '--a-instance', '--a-vertex', '--b-instance', '--b-vertex']) if (!(key in options)) throw Error(`${key} is required`);
  for (const key of ['--a-vertex', '--b-vertex']) if (!/^(0|[1-9][0-9]*)$/.test(options[key]) || !Number.isSafeInteger(Number(options[key]))) throw Error(`${key} requires a zero-based integer`);
  if (('--expect-layout-sha256' in options) !== ('--expect-geometry-sha256' in options)) throw Error('Supply both expected hashes, or neither for an explicit fresh measurement');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const composed = composeReferenceLayout(layout);
  const report = measureReferenceLayout({ layout,
    endpoint_a: { instance_id: options['--a-instance'], vertex_index: Number(options['--a-vertex']) },
    endpoint_b: { instance_id: options['--b-instance'], vertex_index: Number(options['--b-vertex']) },
    expected_layout_sha256: options['--expect-layout-sha256'] ?? composed.layout_sha256,
    expected_geometry_sha256: options['--expect-geometry-sha256'] ?? composed.geometry_sha256 });
  const output = JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-measurement-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
