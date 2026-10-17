#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extrudeReferenceProfile, EXTRUSION_MAX_FILE_BYTES } from '../adapter/reference-extrusion.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-extrude --input editable.profile.json [--format layout|recipe|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--format', '--output'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  const format = options['--format'] ?? 'layout';
  if (!options['--input'] || !['layout', 'recipe', 'json', 'obj', 'stl'].includes(format)) throw Error(usage);
  const info = await stat(options['--input']);
  if (!info.isFile() || info.size > EXTRUSION_MAX_FILE_BYTES) throw Error('Profile must be a regular file no larger than 32000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > EXTRUSION_MAX_FILE_BYTES) throw Error('Profile exceeds 32000 bytes');
  const recipe = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  const result = extrudeReferenceProfile(recipe);
  const output = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' }); else process.stdout.write(output);
} catch (error) { process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-extrusion-error', message: error.message }) + '\n'); process.exitCode = 1; }
