import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadData, ROOT } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { KITS } from '../server/sim/content/index.js';
import { setGameData } from '../server/sim/content/support/index.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { avatarUrl, portraitUrl, spineEntry } from '../public/js/assets.js';
import { makeMatch, give } from './match/harness.js';
import { createRegistry } from '../server/match/effectsMeta.js';

const legacy = loadData(join(ROOT, 'data/legacy'));
const current = loadData(join(ROOT, 'data'));
const visible = (d) => Object.values(d.chess).filter((c) => c.visible && !c.isGolden);
const byName = (d, name) => visible(d).find((c) => c.name === name);

test('legacy economic milestones work: stacking foresight discounts, 70-layer investor and 50-layer miracle payout', () => {
  const reg=createRegistry();
  const h=makeMatch({data:legacy,mode:'solo',difficulty:'NORMAL',fake:true,registry:reg}).start();h.toPrep(1);
  const ps=h.ps('p_0'),m=h.m;
  for(const name of ['地灵','赫默']) give(m,ps,byName(legacy,name).chessId,'hand');
  assert.ok(ps.bonds.visiShip.active);
  const member={kind:'chess',id:byName(legacy,'赫默').chessId,basePrice:3};
  const other={kind:'chess',id:byName(legacy,'跃跃').chessId,basePrice:3};
  ps.layers.visiShip=80;ps.recompute();m.dispatch(ps,'onPrepStart',{});
  assert.equal(ps.priceOf(member),2);assert.equal(ps.priceOf(other),3);
  ps.layers.visiShip=150;ps.recompute();m.dispatch(ps,'onPrepStart',{});
  assert.equal(ps.priceOf(member),1);assert.equal(ps.priceOf(other),2);
  ps.bonds.investShip={active:true,layers:69};assert.equal(m.dispatcher.investRepeat(ps),2);
  ps.bonds.investShip.layers=70;assert.equal(m.dispatcher.investRepeat(ps),3);
  const payout=legacy.bonds.miraShip.buffs.find((b)=>b.key==='bond_layer_gain_coin');
  assert.equal(payout.bb.layer,50);assert.equal(payout.bb.count,10);
  m.dispose();
});

test('legacy preset pool restores all eight removed operators, excludes all five new presets and restores eight tiers', () => {
  assert.equal(visible(legacy).length, 115);
  assert.equal(visible(current).length, 112);
  for (const name of ['崖心','见行者','巫恋','瑰盐','蜜蜡','地灵','协律','红豆']) {
    assert.ok(byName(legacy, name), name); assert.equal(byName(current, name), undefined, name);
  }
  for (const name of ['银灰','伺夜','空弦','卡涅利安','雷蛇']) assert.equal(byName(legacy, name), undefined, name);
  for (const [name, tier] of Object.entries({锡人:1,耶拉:4,录武官:4,华法琳:5,魔王:5,白面鸮:5,百炼嘉维尔:5,妮芙:6})) assert.equal(byName(legacy,name).tier,tier,name);
  assert.equal(legacy.config.ruleset.sourceCommit,'987b4cd5d89fadc540c88deae222df0c088c4ee3');
  assert.equal(legacy.config.modes.mode_single_abyss.inScope, false);
  assert.equal(current.config.modes.mode_single_abyss.inScope, true);
});

test('legacy keeps historical strategy effects and all four new strategies', () => {
  assert.equal(Object.keys(legacy.bands).length, 40);
  assert.match(legacy.bands.band_chen.desc, /高台干员/);
  assert.match(current.bands.band_chen.desc, /所有干员/);
  assert.equal(legacy.bands.band_yu.totalHp,32);
  assert.equal(current.bands.band_yu.totalHp,27);
  for (const id of ['band_lisa','band_jesica','band_mlyss','band_fang']) {
    assert.deepEqual(legacy.bands[id],current.bands[id]);
    assert.deepEqual(legacy.effects[legacy.bands[id].effectId],current.effects[current.bands[id].effectId]);
  }
  assert.equal(legacy.garrisons.garrison_150_a.bbStr.dir, 'front');
  assert.equal(legacy.garrisons[byName(legacy,'断崖').garrisonIds[0]].bbStr.dir,'front');
  assert.equal(current.garrisons[byName(current,'断崖').garrisonIds[0]].bbStr.dir,'behind');
});

test('Chen actually restricts weakness damage to high-ground operators in legacy; current still includes ground operators', () => {
  for (const [d, ranged, expected] of [[legacy,false,100],[legacy,true,1000],[current,false,1000],[current,true,1000]]) {
    setGameData(d);
    try {
      const rec = chessRec({id:'test_op',stats:{atk:500},position:ranged?'RANGED':'MELEE'});
      rec.position = ranged?'RANGED':'MELEE';
      const ds = new DataSource({...d,chess:{...d.chess,test_op:rec},enemies:{...d.enemies,test_enemy:enemyRec({key:'test_enemy',hp:1e7,def:900,speed:0})}});
      const h=makeBattle({data:ds,bandId:'band_chen',units:[{chessId:'test_op',row:10,col:3}],enemies:[{key:'test_enemy',pos:[10,9]}],autoFinish:false});
      h.step(1);
      const amount=h.b.dealDamage(h.unit('test_op'),h.enemies()[0],{amount:1000,type:'phys',canDodge:false});
      assert.equal(amount,expected,`${d===legacy?'legacy':'current'} ${ranged?'ranged':'melee'}`);
      assert.deepEqual(h.b.errors,[]);
    } finally { setGameData(null); }
  }
});

test('every legacy normal and elite operator has the correct kit and runs a real battle without errors', () => {
  setGameData(legacy);
  try {
    for (const c of Object.values(legacy.chess).filter((c)=>c.visible)) {
      assert.equal(current.chess[c.chessId]?.charId,c.charId,`${c.name}: kit id identity`);
      assert.equal(typeof KITS[c.baseId],'function',`${c.name}: kit implementation`);
      const friend=chessRec({id:'test_friend',stats:{maxHp:1e7,atk:0}});
      const foe=enemyRec({key:'test_foe',hp:1e9,atk:50,speed:0});
      const ds=new DataSource({...legacy,chess:{...legacy.chess,test_friend:friend},enemies:{...legacy.enemies,test_foe:foe}});
      const h=makeBattle({data:ds,units:[{chessId:c.chessId,row:10,col:3},{chessId:'test_friend',row:11,col:3}],enemies:[{key:'test_foe',pos:[10,3]}],timeLimit:60,autoFinish:false,captureNoisy:true});
      h.step(1);
      h.unit('test_friend').hp=1000;
      const u=h.unit(c.chessId);
      u.skill?.gainSp(1000,'test');
      h.run(30);
      assert.deepEqual(h.b.errors,[],`${c.name} ${c.chessId}: battle errors`);
      checkInvariants(h.b);
      assert.ok(h.hooksOf('attack').length||h.hooksOf('heal').length||h.hooksOf('skillStart').length,`${c.name}: combat activity`);
    }
  } finally { setGameData(null); }
});

test('installed legacy operator portraits, avatars and battle skeleton files are present and valid', {skip:!existsSync(join(ROOT,'public/assets'))}, () => {
  for(const c of Object.values(legacy.chess).filter((c)=>c.visible)) {
    for(const url of [avatarUrl(legacy.assets,c.charId,{e2:c.isGolden}),portraitUrl(legacy.assets,c.charId,{e2:c.isGolden})]) {
      assert.ok(url,`${c.name}: asset manifest`);
      const bytes=readFileSync(join(ROOT,'public',url));
      assert.equal(bytes.readUInt32BE(0),0x89504e47,`${c.name}: PNG header`);
      assert.ok(bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0,`${c.name}: dimensions`);
    }
    const entry=spineEntry(legacy.assets,c.charId);
    assert.ok(entry,`${c.name}: battle skeleton`);
    for(const key of ['skel','atlas']) if(entry[key]) assert.ok(existsSync(join(ROOT,'public',entry[key])),`${c.name}: ${key}`);
  }
});
