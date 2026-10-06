import { createHash } from 'node:crypto';
import { lstat, realpath, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, assertWorkspaceRoot } from './protocol.mjs';
import { reject } from './live-contract.mjs';
export const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
export async function scoped(root, ref) {
  assertWorkspaceRoot(root);
  if (await realpath(root) !== root || typeof ref !== 'string' || !ref || path.isAbsolute(ref) || ref.includes('\\') || ref.includes('\0') || ref.split('/').some(x => ['', '.', '..'].includes(x))) reject('workspace-boundary','canonical relative path required');
  let cursor = root;
  for (const part of ref.split('/')) {
    cursor = path.join(cursor,part);
    try { if ((await lstat(cursor)).isSymbolicLink()) reject('workspace-boundary','symlinks are not accepted'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return cursor;
}
export const bytesAt = async (w,r) => readFile(await scoped(w,r));
export const jsonAt = async (w,r) => JSON.parse(await bytesAt(w,r));
export async function maybeJson(w,r) { try { return await jsonAt(w,r); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } }
export async function immutable(w,r,value, exclusive = false) {
  const file = await scoped(w,r); await mkdir(path.dirname(file),{recursive:true});
  const bytes = `${canonicalJson(value)}\n`;
  try { await writeFile(file,bytes,{flag:'wx'}); }
  catch(e) { if (e.code !== 'EEXIST') throw e; if (exclusive || (await bytesAt(w,r)).toString() !== bytes) reject('immutable-output-conflict',r); }
  return bytes;
}
export async function artifactDigest(w,refs) {
  const ids=[]; for(const r of refs) ids.push(`${r}|${hash(await bytesAt(w,r))}`); return hash(ids.join('\n'));
}
export async function fileIdentity(w,r) { const b=await bytesAt(w,r); return {reference:r,digest:hash(b),size:b.length}; }
export async function verifyFiles(w,files) {
  for(const f of files) { const got=await fileIdentity(w,f.reference); if(got.digest !== f.digest || got.size !== f.size) reject('artifact-conflict',f.reference); }
}
