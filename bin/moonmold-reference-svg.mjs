#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { SVG_PROFILE_MAX_BYTES, inspectReferenceSvg, importReferenceSvgProfile } from '../adapter/reference-svg-profile.mjs';

try {
  const options = {}, usage = 'usage: moonmold-reference-svg --input drawing.svg [--format inventory|recipe|layout|json|import|obj|stl] [--element OUTER_INDEX [--opening-element DISTINCT_INDEX_FOR_STRAIGHT_EDGES] --units mm|cm|m|in --units-per-svg-unit NUMBER --coordinate-convention svg-y-down-to-xy-y-up --max-error NUMBER_FOR_PATH_CIRCLE_ELLIPSE_IN_SELECTED_UNITS --height NUMBER --name NAME] [--output new-file]';
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--format', '--output', '--element', '--opening-element', '--units', '--units-per-svg-unit', '--coordinate-convention', '--max-error', '--height', '--name'].includes(key) || !process.argv[i + 1] || key in options) throw Error(usage);
    options[key] = process.argv[i + 1];
  }
  const format = options['--format'] ?? 'inventory';
  if (!options['--input'] || !['inventory', 'recipe', 'layout', 'json', 'import', 'obj', 'stl'].includes(format)) throw Error(usage);
  if (format === 'inventory' && ['--element', '--opening-element', '--units', '--units-per-svg-unit', '--coordinate-convention', '--max-error', '--height', '--name'].some(key => key in options)) throw Error('Inventory takes no selection/build options');
  const info = await stat(options['--input']);
  if (!info.isFile() || info.size > SVG_PROFILE_MAX_BYTES) throw Error('Choose a regular SVG file no larger than 400000 bytes');
  const bytes = await readFile(options['--input']);
  if (bytes.length > SVG_PROFILE_MAX_BYTES) throw Error('SVG exceeds 400000 bytes');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let result;
  if (format === 'inventory') result = inspectReferenceSvg({ text });
  else {
    const positive = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    if (!/^[1-9]\d*$/.test(options['--element'] ?? '') || !positive.test(options['--height'] ?? '') || !positive.test(options['--units-per-svg-unit'] ?? '')) throw Error(usage);
    if (options['--max-error'] !== undefined && !positive.test(options['--max-error'])) throw Error(usage);
    if (options['--opening-element'] !== undefined && !/^[1-9]\d*$/.test(options['--opening-element'])) throw Error(usage);
    result = importReferenceSvgProfile({ text, element: Number(options['--element']), units: options['--units'], units_per_svg_unit: Number(options['--units-per-svg-unit']), coordinate_convention: options['--coordinate-convention'], height: Number(options['--height']), name: options['--name'], ...(options['--opening-element'] === undefined ? {} : { opening_element: Number(options['--opening-element']) }), ...(options['--max-error'] === undefined ? {} : { max_error: Number(options['--max-error']) }) });
  }
  const output = ['inventory', 'json', 'import'].includes(format) ? JSON.stringify(format === 'import' ? result.svg_import : result, null, 2) + '\n' : result.exports[format];
  if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' }); else process.stdout.write(output);
} catch (error) { process.stderr.write(JSON.stringify({ code: error.code ?? 'reference-svg-error', message: error.message }) + '\n'); process.exitCode = 1; }
