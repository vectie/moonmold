#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { LAYOUT_MAX_FILE_BYTES } from '../adapter/reference-layout.mjs';
import { compareReferenceRevisions } from '../adapter/reference-revision.mjs';
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--before', '--after', '--same-world-frame', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error('usage: moonmold-reference-compare --before saved.layout.json --after revised.layout.json --same-world-frame yes [--format svg|json] [--output new-file]');
    options[key] = process.argv[i + 1];
  }
  if (!options['--before'] || !options['--after']) throw Error('--before and --after are required');
  if (options['--same-world-frame'] !== 'yes') throw Error('--same-world-frame yes is required: establish matching world origin and axes first');
  const format = options['--format'] ?? 'svg';
  if (!['svg', 'json'].includes(format)) throw Error('--format must be svg or json');
  async function json(file) {
    if ((await stat(file)).size > LAYOUT_MAX_FILE_BYTES) throw Error('Input exceeds 3000000 bytes');
    const bytes = await readFile(file);
    if (bytes.length > LAYOUT_MAX_FILE_BYTES) throw Error('Input exceeds 3000000 bytes');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const { exports, ...report } = compareReferenceRevisions({ same_world_frame: true, before: await json(options['--before']), after: await json(options['--after']) });
  const output = format === 'svg' ? exports.svg : JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-revision-error', message: error.message }) + '\n');
  process.exitCode = 1;
}
