#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { importReferenceGlbLayout } from '../adapter/reference-glb-layout.mjs';

try {
  const options={};
  for (let i=2;i<process.argv.length;i+=2) {
    const key=process.argv[i];
    if (!['--input','--name','--nodes','--format','--output'].includes(key) || !process.argv[i+1] || key in options) throw new Error('usage: moonmold-reference-glb-import --input scene.glb [--name scene] [--nodes 0,2] [--format layout|json|obj|stl] [--output new-file]');
    options[key]=process.argv[i+1];
  }
  if (!options['--input']) throw new Error('--input is required');
  if ((await stat(options['--input'])).size>400000) throw new Error('GLB input exceeds 400000 bytes');
  const bytes=await readFile(options['--input']);
  let node_ids;
  if (options['--nodes']!==undefined) {
    if (!/^(0|[1-9][0-9]*)(,(0|[1-9][0-9]*))*$/.test(options['--nodes'])) throw new Error('--nodes requires comma-separated zero-based node indices');
    node_ids=options['--nodes'].split(',').map(Number);
  }
  const format=options['--format'] ?? 'layout';
  if (!['layout','json','obj','stl'].includes(format)) throw new Error('--format must be layout, json, obj or stl');
  const result=importReferenceGlbLayout({data_base64:bytes.toString('base64'),name:options['--name'],node_ids});
  const output=format==='json'?JSON.stringify(result,null,2)+'\n':result.exports[format];
  if (options['--output']) await writeFile(options['--output'],output,{flag:'wx'});else process.stdout.write(output);
} catch (error) { process.stderr.write(JSON.stringify({code:error.code ?? 'reference-glb-import-error',message:error.message})+'\n');process.exitCode=1; }
