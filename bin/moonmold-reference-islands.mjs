#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { inspectReferenceIslands, splitReferenceIslands, ISLAND_SPLIT_CONTRACT, ISLAND_MAX_FILE_BYTES } from '../adapter/reference-islands.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-islands (--input saved.layout.json --instance id | --recipe saved.islands.json) [--format catalog|layout|recipe|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--instance', '--recipe', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  if (Boolean(options['--input']) === Boolean(options['--recipe']) || (options['--input'] && !options['--instance']) || (options['--recipe'] && options['--instance'])) throw Error(usage);
  const format = options['--format'] ?? 'catalog';
  if (!['catalog', 'layout', 'recipe', 'json', 'obj', 'stl'].includes(format)) throw Error(usage);
  const file = options['--input'] ?? options['--recipe'], info = await stat(file);
  if (!info.isFile() || info.size > ISLAND_MAX_FILE_BYTES) throw Error('Input must be a regular file no larger than 3100000 bytes');
  const bytes = await readFile(file);
  if (bytes.length > ISLAND_MAX_FILE_BYTES) throw Error('Input exceeds 3100000 bytes');
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  if (options['--recipe'] && document.contract_id !== ISLAND_SPLIT_CONTRACT) throw Error(`Saved recipe must use ${ISLAND_SPLIT_CONTRACT}`);
  const request = options['--recipe'] ? document : { layout: document, instance_id: options['--instance'] };
  const result = format === 'catalog' ? inspectReferenceIslands(request) : splitReferenceIslands(request);
  const output = ['catalog', 'json'].includes(format) ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' }); else process.stdout.write(output);
} catch (error) { process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-islands-error', message: error.message }) + '\n'); process.exitCode = 1; }
