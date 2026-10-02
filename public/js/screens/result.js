// Result screen (research 06 §10.6): victory / defeat hero with rounds passed, boss medallions, and a
// card per player — band, final lineup avatars with elite marks, stats, title (评语) with its icon —
// plus 返回同盟.
//
// Expected m.result (free-form in DESIGN §8.2; fields read tolerantly, see gameLogic.normalizeResult):
//   { victory, roundsPassed, lastRound?, hiddenCleared?, bossId?, hiddenBossId?, difficulty?, modeId?, durationMs?,
//     players: [{ playerId, seat, name, isBot, alive, lp, bandId, roundsPassed?,
//                 title: 'comment_1' | { id, name? } | null,
//                 lineup: [{ id /* chessId, golden id if elite */, golden?, tier?, items?: [itemId] }],
//                 bonds?: [{ bondId, layers, active }],
//                 stats: { dmgDealt, kills, leaks, gold /* funds SPENT */, refreshes, merges, bossDamage?, itemsEquipped?,
//                          activatedLayers?, lpLost?, perfectRounds? } }] }

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, DifficultyTag, TierChip } from '../ui/components.js';
import { useGameData, Img, UnitThumb, BandIcon, PlayerAvatar, BondGlyph, LpTower, Sprite } from '../ui/gameComponents.js';
import { normalizeResult, fmtNum } from '../ui/gameLogic.js';
import { enemyIconUrl, titleIconUrl, uiUrl, chessAvatarUrl } from '../ui/assetUrls.js';
import { store, useStore, emptyMatch } from '../store.js';
import { audio } from '../audio.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// The first seven present are shown (+ remaining LP = a 4×2 grid); the title (评语) stats come first.
// `gold` is the funds a player SPENT (server/match/PlayerState.js spend(); the 挥金如土 title stat).
const STAT_ROWS = [
  ['dmgDealt', '造成伤害'], ['kills', '击倒敌人'], ['bossDamage', '领袖伤害'], ['activatedLayers', '盟约层数'],
  ['merges', '晋升次数'], ['itemsEquipped', '配发装备'], ['gold', '消耗资金'], ['perfectRounds', '完美作战'],
  ['refreshes', '刷新次数'], ['leaks', '未击倒'], ['lpLost', '损失生命'],
];

function HistoricalThumb({ unit, gd }) {
  const name = unit.name || gd.chess(unit.id)?.name || unit.id;
  return html`<span class=${cx('uthumb', 'uthumb--sm', 'uthumb--chess', unit.golden && 'is-golden', unit.tier && `uthumb--t${unit.tier}`)} title=${name}>
    <span class="uthumb__art"><${Img} src=${unit.avatarUrl || chessAvatarUrl(gd.m, gd.chess(unit.id))} fallback=${html`<span class="uthumb__glyph">${[...name][0]}</span>`} /></span>
    ${unit.tier ? html`<${TierChip} tier=${unit.tier} golden=${unit.golden} size="sm" class="uthumb__tier" />` : null}
  </span>`;
}

function PlayerCard({ p, myId, titles, best, solo = false, historical = false }) {
  const gd = useGameData();
  const titleRec = p.title ? titles.find((t) => t.id === p.title.id) || null : null;
  const titleName = p.title?.name || titleRec?.name || null;
  const stats = STAT_ROWS.filter(([k]) => Number.isFinite(p.stats[k])).slice(0, historical ? STAT_ROWS.length : 7);
  const band = p.bandId ? gd.band(p.bandId) : null;
  const lineup = p.lineup.slice(0, 10);
  const bonds = p.bonds.filter((b) => b.active || b.layers > 0).sort((a, b) => (b.layers || 0) - (a.layers || 0)).slice(0, 6);
  return html`<article class=${cx('rcard', p.playerId === myId && 'is-self', p.alive === false && 'is-dead')}>
    <header class="rcard__head">
      <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
      <div class="rcard__who">
        <b class="rcard__name">${p.name}${p.isBot ? html`<span class="rcard__ai">AI</span>` : null}${p.playerId === myId ? html`<span class="rcard__you">你</span>` : null}</b>
        <span class="rcard__band">${band || p.bandName ? html`<${BandIcon} bandId=${p.bandId} size="xs" />${p.bandName || band?.name}` : '—'}</span>
      </div>
      <div class="rcard__mid">
        <div class="rcard__lineup">
          ${lineup.length ? lineup.map((u, i) => historical ? html`<${HistoricalThumb} key=${i} unit=${u} gd=${gd} />` : html`<${UnitThumb} key=${i} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id} golden=${!!u.golden} tier=${u.tier} size="sm" />`)
            : html`<span class="rcard__noinfo">${p.alive === false ? '阵容已撤离' : 'NO INFO'}</span>`}
        </div>
        ${bonds.length ? html`<div class="rcard__bonds">${bonds.map((b) => html`<span key=${b.bondId} class=${cx('rbond', b.active && 'is-on')} title=${b.name || gd.bond(b.bondId)?.name || b.bondId}>
          <${BondGlyph} bondId=${b.bondId} /><b class="num">${b.layers ?? 0}</b></span>`)}</div>` : null}
      </div>
      <div class="rcard__round"><${MicroLabel}>ROUNDS</${MicroLabel}><b class="num">${p.roundsPassed}</b>
        ${p.trophies > 0 || p.reward > 0 ? html`<span class="rcard__gain">${p.trophies > 0 ? html`<span title="获得奖杯"><${Icon} name="crown" /><b class="num">+${p.trophies}</b></span>` : null}${p.reward > 0 ? html`<span title="卫戍认证"><${Icon} name="shield" /><b class="num">+${p.reward}</b></span>` : null}</span>` : null}
      </div>
      ${titleName ? html`<div class="rcard__title" title=${titleRec?.text || p.title?.text || ''}>
        <${Img} src=${titleIconUrl(gd.m, titleRec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_'))} class="rcard__ticon" fallback=${html`<${Icon} name="crown" />`} />
        <span><${MicroLabel} tone="gold">评语</${MicroLabel}><b>${titleName}</b></span>
      </div>` : html`<span class="rcard__title rcard__title--none" aria-hidden="true"></span>`}
    </header>
    <div class="rcard__stats">
      ${stats.map(([k, label]) => html`<div key=${k} class=${cx('rstat', best[k] === p.playerId && 'is-best')}><span>${label}</span><b class="num">${fmtNum(p.stats[k])}</b></div>`)}
      ${Number.isFinite(p.lp) ? html`<div class="rstat" title=${p.lpShared && !solo ? '最终攻势起全队共享目标生命值' : ''}><span>${p.lpShared && !solo ? '同盟剩余生命' : '剩余生命'}</span><${LpTower} value=${p.lp} size="sm" /></div>` : null}
    </div>
  </article>`;
}

/** RESULT screen. */
export function ResultScreen() {
  const res = useStore((s) => s.match.result);
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const hasRoom = useStore((s) => !!s.room);
  return html`<${ResultReport} result=${res} publicView=${pub} myId=${myId} hasRoom=${hasRoom} />`;
}

/** Replays saved settlement data without changing the current match or playing settlement audio. */
export function HistoricalResult({ record, onBack }) {
  const playerId = record.playerId || 'historical-self';
  const result = record.result || {
    victory: record.teamVictory || record.victory, roundsPassed: record.roundsPassed,
    lastRound: record.modeId?.includes('_single_') && record.difficulty === 'FUNNY' ? 9 : 14,
    modeId: record.modeId, difficulty: record.difficulty, durationMs: record.durationMs,
    players: [{ ...record, playerId, title: record.title ? { name: record.title } : null }],
  };
  return html`<div class="historical-report">
    <p class="records__notice">${record.rulesetName || record.rulesetId} · ${new Date(record.endedAt).toLocaleString('zh-CN', { hour12: false })}${!record.result ? ' · 此早期记录仅保留本人信息，未保存队友及领袖详情。' : ''}</p>
    <${ResultReport} result=${result} myId=${playerId} onBack=${onBack} historical=${true} />
  </div>`;
}

function ResultReport({ result, publicView = null, myId, hasRoom = false, onBack = null, historical = false }) {
  const gd = useGameData();
  const r = normalizeResult(result, publicView);
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const best = {};
  for (const [k] of STAT_ROWS) {
    let top = null;
    for (const p of r.players) if (Number.isFinite(p.stats[k]) && p.stats[k] > 0 && (top == null || p.stats[k] > top.v)) top = { v: p.stats[k], id: p.playerId };
    if (top && r.players.length > 1) best[k] = top.id;
  }
  useEffect(() => { if (!historical) audio.sfx(r.victory ? 'settlementSucceed' : 'settlementFail'); }, []);
  const back = onBack || (() => store.set({ match: emptyMatch() }));
  const boss = historical && result.bossInfo ? result.bossInfo : r.bossId ? gd.boss(r.bossId) : null;
  // the Hidden Core medal (and its corrupted leader) only once R15 was actually fought
  const hidden = r.hiddenBossId && r.hiddenReached ? (historical && result.hiddenBossInfo ? result.hiddenBossInfo : gd.boss(r.hiddenBossId)) : null;
  const bg = uiUrl(gd.m, r.victory ? 'settle/settlemen_teamshow_success' : 'settle/settlemen_teamshow_fail');
  const mins = r.durationMs ? Math.round(r.durationMs / 60000) : null;

  return html`<div class=${cx('screen', 'result', historical && 'result--historical', r.victory ? 'is-win' : 'is-lose')}>
    <div class="result__bg" aria-hidden="true" style=${bg ? `--result-bg:url("${bg}")` : undefined}></div>
    <div class="result__grid" aria-hidden="true"></div>
    <main class="result__main">
      <section class="result__hero">
        <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" fallback=${html`<${MicroLabel} tone="mint">STRONGHOLD PROTOCOL</${MicroLabel}>`} /></div>
        ${r.difficulty ? html`<${DifficultyTag} difficulty=${r.difficulty} size="lg" />` : null}
        <h1 class="result__headline">${r.victory ? '模拟完成' : '模拟失败'}</h1>
        <p class="result__sub">${r.victory ? '成功卫戍 · 敌方领袖已被击败' : '防线已被突破'}</p>
        <div class="result__rounds">
          <span class="result__rlabel">通过回合</span>
          <b class="result__rnum num">${r.roundsPassed}</b>
          ${r.roundsPassed <= r.lastRound ? html`<span class="result__rof num">/${r.lastRound}</span>` : null}
        </div>
        <div class="result__medals">
          ${boss ? html`<div class=${cx('medal', r.victory && 'is-done')} title=${boss.name}>
            <${Img} src=${boss.iconUrl || enemyIconUrl(gd.m, boss.enemyKey)} /><span class="medal__check">${r.victory ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">敌方领袖</span></div>` : null}
          ${hidden ? html`<div class=${cx('medal', 'medal--hidden', r.hiddenCleared && 'is-done')} title=${hidden.name}>
            <${Img} src=${hidden.iconUrl || enemyIconUrl(gd.m, hidden.enemyKey)} /><span class="medal__check">${r.hiddenCleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">隐秘核心</span></div>` : null}
        </div>
        ${mins ? html`<p class="result__time t-lo">本局耗时 <b class="num">${mins}</b> 分钟</p>` : null}
        <footer class="result__foot">
          ${!historical ? html`<${Button} variant="ghost" size="lg" icon="crown" onClick=${() => store.patch('ui', { recordsOpen: true })}>战绩 / 历史<//>` : null}
          <${Button} variant="primary" size="xl" icon="chevronLeft" onClick=${back}>${historical ? '返回对战历史' : hasRoom ? '返回同盟' : '返回大厅'}<//>
        </footer>
      </section>
      <section class="result__players">
        <h2 class="brief-h"><span>同盟成员</span><${MicroLabel}>ALLIANCE REPORT</${MicroLabel}></h2>
        ${r.players.length ? r.players.map((p) => html`<${PlayerCard} key=${p.playerId} p=${p} myId=${myId} titles=${titles} best=${best} solo=${r.players.length < 2} historical=${historical} />`)
          : html`<p class="t-dim">暂无结算数据</p>`}
      </section>
    </main>
  </div>`;
}
