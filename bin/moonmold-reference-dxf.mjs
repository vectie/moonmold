#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { DXF_PROFILE_MAX_BYTES, inspectReferenceDxf, importReferenceDxfProfile } from '../adapter/reference-dxf-profile.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-dxf --input drawing.dxf [--format inventory|recipe|layout|json|obj|stl] [--entity INDEX --units mm|cm|m|in --height NUMBER --name NAME] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--format', '--output', '--entity', '--units', '--height', '--name'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  const format = options['--format'] ?? 'inventory';
  if (!options['--input'] || !['inventory', 'recipe', 'layout', 'json', 'obj', 'stl'].includes(format)) throw Error(usage);
  if (format === 'inventory' && ['--entity', '--units', '--height', '--name'].some(key => key in options)) throw Error('Inventory takes no selection/build options');
  const info = await stat(options['--input']);
  if (!info.isFile() || info.size > DXF_PROFILE_MAX_BYTES) throw Error('Choose a regular DXF file no larger than 400000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > DXF_PROFILE_MAX_BYTES) throw Error('DXF exceeds 400000 bytes');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let result;
  if (format === 'inventory') result = inspectReferenceDxf({ text });
  else {
    if (!/^[1-9]\d*$/.test(options['--entity'] ?? '') || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(options['--height'] ?? '')) throw Error(usage);
    result = importReferenceDxfProfile({ text, entity: Number(options['--entity']), units: options['--units'], height: Number(options['--height']), name: options['--name'] });
  }
  const output = ['inventory', 'json'].includes(format) ? JSON.stringify(result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' }); else process.stdout.write(output);
} catch (error) { process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-dxf-error', message: error.message }) + '\n'); process.exitCode = 1; }
