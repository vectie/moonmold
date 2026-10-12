#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { CUT_CONTRACT, CUT_MAX_FILE_BYTES, cutReferenceLayout } from '../adapter/reference-cut.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-cut (--input saved.layout.json --instances id,id --axis x|y|z --position-mm number --keep positive|negative | --recipe saved.cut.json) [--format layout|recipe|json|obj|stl] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input','--recipe','--instances','--axis','--position-mm','--keep','--format','--output'].includes(key) || !process.argv[i+1] || key in options) throw Error(usage);
    options[key] = process.argv[i+1];
  }
  if (Boolean(options['--input']) === Boolean(options['--recipe'])) throw Error(usage);
  const format = options['--format'] ?? 'layout';
  if (!['layout','recipe','json','obj','stl'].includes(format)) throw Error('format must be layout, recipe, json, obj or stl');
  const file = options['--input'] ?? options['--recipe'];
  if ((await stat(file)).size > CUT_MAX_FILE_BYTES) throw Error('Input exceeds 3100000 bytes');
  const bytes = await readFile(file);
  if (bytes.length > CUT_MAX_FILE_BYTES) throw Error('Input exceeds 3100000 bytes');
  const document = JSON.parse(new TextDecoder('utf-8',{ fatal: true, ignoreBOM: true }).decode(bytes));
  let request;
  if (options['--recipe']) {
    if (['--instances','--axis','--position-mm','--keep'].some(key => key in options)) throw Error('Saved recipe cannot be combined with cut overrides; edit a copy of the recipe or start from --input');
    if (document.contract_id !== CUT_CONTRACT) throw Error(`Saved recipe must use ${CUT_CONTRACT}`);
    request = document;
  } else {
    if (!options['--instances'] || !options['--axis'] || !options['--keep'] || !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(options['--position-mm'] ?? '')) throw Error(usage);
    request = { layout: document, instance_ids: options['--instances'].split(','), plane: { axis: options['--axis'], position_mm: Number(options['--position-mm']), keep: options['--keep'] } };
  }
  const result = cutReferenceLayout(request);
  const output = format === 'json' ? JSON.stringify(result,null,2)+'\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'],output,{ flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-cut-error', message: error.message })+'\n'); process.exitCode = 1;
}
