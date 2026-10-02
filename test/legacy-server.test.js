import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { ROOT } from '../server/data.js';
import { TestClient } from './helpers/wsClient.js';

async function server(id) {
  const code = `import {startServer} from './server/index.js'; const s=await startServer({port:0,host:'127.0.0.1',quiet:true}); console.log(JSON.stringify({port:s.port})); process.stdin.resume(); process.stdin.on('data',async()=>{await s.close();process.exit(0)});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:ROOT,stdio:['pipe','pipe','pipe'],windowsHide:true,
    env:{...process.env,SP_DATA_DIR:join(ROOT,'data',...(id==='legacy'?['legacy']:[])),SP_ALTERNATE_PORT:id==='legacy'?'3000':'3001'}});
  let text='', errors=''; child.stderr.on('data',(b)=>{errors+=b});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error(`server startup timed out ${errors}`))},10000);
    child.on('error',(e)=>{clearTimeout(timer);reject(e)});
    child.on('exit',()=>{clearTimeout(timer);reject(new Error(`server exited ${errors}`))});
    child.stdout.on('data',(b)=>{text+=b;const line=text.split('\n').find((l)=>l.startsWith('{"port"'));if(line){clearTimeout(timer);resolve(JSON.parse(line).port)}});
  });
  return {port,close:async()=>{const exit=once(child,'exit');child.stdin.write('stop\n');await exit;assert.equal(errors,'');}};
}

test('current and legacy servers isolate HTTP data, WebSocket rooms, difficulty limits and AI teammates',async()=>{
  const services=[]; const clients=[];
  try {
    for(const id of ['current','legacy']) {
      const s=await server(id);services.push(s);
      const base=`http://127.0.0.1:${s.port}`;
      const health=await (await fetch(base+'/healthz')).json();assert.equal(health.ruleset,id);
      const info=await (await fetch(base+'/ruleset')).json();assert.equal(info.id,id);
      const chess=await (await fetch(base+'/data/chess.json')).json();
      assert.equal(Object.values(chess).filter((c)=>c.visible&&!c.isGolden).length,id==='legacy'?115:112);
      const c=await TestClient.connect(`ws://127.0.0.1:${s.port}/ws`);clients.push(c);await c.hello(`test-${id}`);
      const abyss=await c.request({t:'room.create',mode:'coop',difficulty:'ABYSS'});
      assert.equal(abyss.t,id==='legacy'?'error':'ok');
      assert.equal((await c.request({t:'room.create',mode:'coop',difficulty:'FUNNY'})).t,'ok');
      assert.equal((await c.request({t:'room.addBot'})).t,'ok');
      const state=await c.waitFor('room.state',(m)=>m.seats.some((p)=>p?.isBot));
      assert.equal(state.seats.filter(Boolean).length,2);
      assert.equal((await c.request({t:'room.setDifficulty',difficulty:'ABYSS'})).t,id==='legacy'?'error':'ok');
      assert.equal((await c.request({t:'room.leave'})).t,'ok');
    }
  } finally {
    for(const c of clients) await c.close();
    for(const s of services) await s.close();
  }
});
