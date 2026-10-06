#!/usr/bin/env node
import { executeLiveFlow, probeLiveFlow, attestLiveFlow, reconcileLiveFlow, observeLiveHealth } from '../adapter/live-flow.mjs';
const arg = (k, required=true) => { const i=process.argv.indexOf(k); if(i<0 || !process.argv[i+1]) { if(required) throw new Error(`missing ${k}`); return undefined; } return process.argv[i+1]; };
try {
  const cmd=process.argv[2];
  const options={workspace:arg('--workspace'),requestRef:arg('--request'),resultRef:arg('--result'),draftRef:arg('--artifact',false) ?? arg('--draft',false),healthRef:arg('--health',false)};
  if(!options.draftRef) throw new Error('missing --artifact/--draft');
  let value;
  if(cmd === 'execute') value=await executeLiveFlow(options);
  else if(cmd === 'probe') value=await probeLiveFlow(options);
  else if(cmd === 'reconcile') value=await reconcileLiveFlow(options);
  else if(cmd === 'attest') value=await attestLiveFlow({...options,attestorId:arg('--attestor-id'),attestationRef:arg('--attestation'),finalRef:arg('--final')});
  else if(cmd === 'health') value=await observeLiveHealth({...options,evidenceRef:arg('--evidence'),healthRef:arg('--health')});
  else throw new Error('requires execute, probe, reconcile, attest or health');
  process.stdout.write(`${JSON.stringify(value)}\n`);
  if(value.status === 'failed') process.exitCode=1;
} catch(e) { process.stderr.write(`${JSON.stringify({accepted:false,code:e.code ?? 'unexpected-error',message:e.message})}\n`); process.exitCode=1; }
