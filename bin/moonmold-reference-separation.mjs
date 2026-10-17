#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { composeReferenceLayout, LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { measureReferenceSeparation } from '../adapter/reference-separation.mjs';

try {
  const options = {};
  for (let i=2;i<process.argv.length;i+=2) {
    const key = process.argv[i];
    if (!['--input','--a-instance','--b-instance','--expect-layout-sha256','--expect-geometry-sha256','--output'].includes(key) || !process.argv[i+1] || key in options) throw Error('usage: moonmold-reference-separation --input layout.json --a-instance id --b-instance id [--expect-layout-sha256 hash --expect-geometry-sha256 hash] [--output new-report.json]');
    options[key] = process.argv[i+1];
  }
  for (const key of ['--input','--a-instance','--b-instance']) if (!(key in options)) throw Error(`${key} is required`);
  if (('--expect-layout-sha256' in options) !== ('--expect-geometry-sha256' in options)) throw Error('Supply both expected hashes, or neither for an explicit fresh measurement');
  if ((await stat(options['--input'])).size > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Layout file exceeds 3000000 bytes');
  const layout = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(bytes));
  const composed = composeReferenceLayout(layout);
  const report = measureReferenceSeparation({ layout, instance_a:options['--a-instance'], instance_b:options['--b-instance'],
    expected_layout_sha256:options['--expect-layout-sha256'] ?? composed.layout_sha256,
    expected_geometry_sha256:options['--expect-geometry-sha256'] ?? composed.geometry_sha256 });
  const output = JSON.stringify(report,null,2)+'\n';
  if (options['--output']) await writeFile(options['--output'],output,{ flag:'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code:error.code ?? 'reference-separation-error', message:error.message })+'\n');
  process.exitCode = 1;
}
