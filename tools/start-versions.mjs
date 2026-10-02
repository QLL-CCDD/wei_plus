#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const ports = [Number(process.env.SP_CURRENT_PORT || 3000), Number(process.env.SP_LEGACY_PORT || 3001)];
if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) || ports[0] === ports[1]) throw new Error('Choose two distinct valid ports');
const children = [];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode == null) child.kill();
  process.exitCode = code;
};
for (const [i, id] of ['current','legacy'].entries()) {
  const child = spawn(process.execPath, [join(root,'server/index.js')], {
    cwd:root, stdio:'inherit', windowsHide:true,
    env:{...process.env, PORT:String(ports[i]), SP_ALTERNATE_PORT:String(ports[1-i]),
      SP_DATA_DIR:join(root,'data',...(id==='legacy'?['legacy']:[]))},
  });
  children.push(child);
  child.on('error',(e)=>{console.error(e.message);stop(1);});
  child.on('exit',(code,signal)=>{if(!stopping) stop(code || (signal ? 1 : 0));});
  console.log(`${id}: http://localhost:${ports[i]}`);
}
process.on('SIGINT',()=>stop());
process.on('SIGTERM',()=>stop());
