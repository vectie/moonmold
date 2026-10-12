#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { MIRROR_CONTRACT, MIRROR_MAX_FILE_BYTES, mirrorReferenceLayout } from '../adapter/reference-mirror.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-mirror (--input saved.layout.json --instances id,id --axis x|y|z --position-mm number --suffix -mirror | --recipe saved.mirror.json) [--format layout|recipe|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--recipe', '--instances', '--axis', '--position-mm', '--suffix', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (Boolean(options['--input']) === Boolean(options['--recipe'])) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout', 'recipe', 'json', 'obj', 'stl'].includes(format)) throw Error('format must be layout, recipe, json, obj or stl');
  const file = options['--input'] ?? options['--recipe'];
  if ((await stat(file)).size > MIRROR_MAX_FILE_BYTES) throw Error('Input exceeds 3100000 bytes');
  const bytes = await readFile(file);
  if (bytes.length > MIRROR_MAX_FILE_BYTES) throw Error('Input exceeds 3100000 bytes');
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  let request;
  if (options['--recipe']) {
    if (['--instances', '--axis', '--position-mm', '--suffix'].some(key => key in options)) throw Error('Saved recipe cannot be combined with mirror overrides; edit a copy of the recipe or start from --input');
    if (document.contract_id !== MIRROR_CONTRACT) throw Error(`Saved recipe must use ${MIRROR_CONTRACT}`);
    request = document;
  } else {
    if (!options['--instances'] || !options['--axis'] || !options['--suffix'] || !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(options['--position-mm'] ?? '')) throw Error(usage);
    request = { layout: document, instance_ids: options['--instances'].split(','), plane: { axis: options['--axis'], position_mm: Number(options['--position-mm']) }, suffix: options['--suffix'] };
  }
  const result = mirrorReferenceLayout(request);
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-mirror-error', message: error.message }) + '\n'); process.exitCode = 1;
}
