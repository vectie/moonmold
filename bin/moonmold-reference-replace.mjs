#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { replaceReferenceSources } from '../adapter/reference-replacement.mjs';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';

const decode = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
async function boundedRead(file, limit, label) {
  if ((await stat(file)).size > limit) throw Error(`${label} exceeds ${limit} bytes`);
  const bytes = await readFile(file);
  if (bytes.length > limit) throw Error(`${label} exceeds ${limit} bytes`);
  return bytes;
}
try {
  const options = {};
  const usage = 'usage: moonmold-reference-replace --input layout.json --instances id[,id] (--mesh revised.obj|stl|ply|glb --units mm|cm|m|in [--parts object-1,group-2] [--nodes 0,2] | --source saved.source.json) [--input-format obj|stl|ply|glb] [--format layout|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instances', '--mesh', '--units', '--parts', '--nodes', '--source', '--input-format', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (!options['--input'] || !options['--instances'] || Boolean(options['--mesh']) === Boolean(options['--source'])) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, json, obj or stl');
  const layout = JSON.parse(decode(await boundedRead(options['--input'], LAYOUT_MAX_FILE_BYTES, 'Layout')));
  let source;
  if (options['--source']) {
    if (['--units', '--parts', '--nodes', '--input-format'].some(key => key in options)) throw Error('--source cannot be combined with source overrides');
    source = JSON.parse(decode(await boundedRead(options['--source'], 2_000_000, 'Source JSON')));
  } else {
    const input_format = options['--input-format'] ?? extname(options['--mesh']).slice(1).toLowerCase();
    if (!['obj', 'stl', 'ply', 'glb'].includes(input_format)) throw Error('Replacement format must be obj, stl, ply or glb');
    const bytes = await boundedRead(options['--mesh'], 400_000, 'Replacement mesh');
    const name = basename(options['--mesh']).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 80) || 'reference';
    source = { input_format, units: options['--units'], name,
      ...(input_format === 'obj' ? { text: decode(bytes) } : { data_base64: bytes.toString('base64') }) };
    if (options['--parts'] !== undefined) source.part_ids = options['--parts'].split(',');
    if (options['--nodes'] !== undefined) {
      if (!/^(0|[1-9][0-9]*)(,(0|[1-9][0-9]*))*$/.test(options['--nodes'])) throw Error('--nodes requires comma-separated zero-based node indices');
      source.node_ids = options['--nodes'].split(',').map(Number);
    }
  }
  const result = replaceReferenceSources({ layout, instance_ids: options['--instances'].split(','), source });
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-replacement-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
