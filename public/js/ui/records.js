// Local match history. Separate ruleset keys keep future modes from replacing existing records.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, DifficultyTag } from './components.js';
import { store, useStore } from '../store.js';
import { data, useData, getBond, getBand, getChess, getItem, getMode } from '../data.js';
import { loadRecords, summarizeRecords, exportRecords, importRecords } from '../records.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';

const close = () => store.patch('ui', { recordsOpen: false });
const number = (n) => (Number(n) || 0).toLocaleString('zh-CN');
const ruleName = (id) => ({ current: '当前版', legacy: '旧版（3 月 27 日前）' })[id] || id;
const date = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : '时间未知';
};
const duration = (value) => {
  const minutes = Math.floor((Number(value) || 0) / 60000);
  return `${minutes} 分 ${Math.floor((Number(value) || 0) / 1000) % 60} 秒`;
};

export function RecordsButton({ size = 'sm' }) {
  return html`<${Button} variant="ghost" size=${size} icon="crown" onClick=${() => store.patch('ui', { recordsOpen: true })}>战绩 / 历史<//>`;
}

function CountList({ title, entries, catalogue, lookup, idKey }) {
  const known = new Map(catalogue.map((entry) => [entry[idKey] || entry.id, { id: entry[idKey] || entry.id, games: 0, wins: 0 }]));
  for (const entry of entries || []) known.set(entry.id, entry);
  const rows = [...known.values()].filter((entry) => entry.id).sort((a, b) => b.wins - a.wins || b.games - a.games || String(a.id).localeCompare(String(b.id)));
  return html`<section class="records__section">
    <h3>${title}</h3>
    <div class="records__counts">${rows.map((entry) => html`<div class="records__count" key=${entry.id}>
      <span title=${entry.id}>${lookup(entry.id)?.name || entry.id}</span>
      <span><b>${number(entry.wins)}</b> 胜 <small>/ ${number(entry.games)} 局</small></span>
    </div>`)}</div>
  </section>`;
}

function HistoryRow({ record }) {
  const activeBonds = (record.bonds || []).filter((bond) => bond.active);
  const title = typeof record.title === 'object' ? record.title?.name || record.title?.id : record.title;
  return html`<details class="records__match">
    <summary>
      <span class=${`records__outcome ${record.victory ? 'is-win' : ''}`}>${record.victory ? '胜利' : '失败'}</span>
      <span class="records__match-time">${date(record.endedAt)}<small>${record.rulesetName || ruleName(record.rulesetId)} · ${record.name || '指挥官'}</small></span>
      <${DifficultyTag} difficulty=${record.difficulty} size="sm" />
      <span class="records__match-band">${getBand(record.bandId)?.name || record.bandId || '无策略'}</span>
      <span class="records__gain">奖杯 +${number(record.trophies)}<small>认证 +${number(record.reward)}</small></span>
    </summary>
    <div class="records__match-details">
      <p>${record.modeId?.includes('_single_') ? '独立模拟' : '同盟模拟'} · ${getMode(record.modeId)?.name || DIFFICULTY_NAMES[record.difficulty] || record.modeId || '未知难度'} · 通过 ${number(record.roundsPassed)} 轮 · 用时 ${duration(record.durationMs)}${title ? ` · 评语：${title}` : ''}</p>
      <p><b>激活盟约：</b>${activeBonds.length ? activeBonds.map((bond) => `${getBond(bond.bondId)?.name || bond.bondId}（${number(bond.layers)} 层）`).join('、') : '无'}</p>
      <p><b>最终阵容：</b>${(record.lineup || []).length ? record.lineup.map((unit) => `${getChess(unit.id)?.name || unit.id}${unit.golden ? '（精锐）' : ''}${unit.items?.length ? `［${unit.items.map((item) => getItem(typeof item === 'string' ? item : item?.id)?.name || (typeof item === 'string' ? item : item?.id) || '装备').join('、')}］` : ''}`).join('、') : '无'}</p>
    </div>
  </details>`;
}

export function RecordsHost() {
  const open = useStore((s) => !!s.ui.recordsOpen);
  return open ? html`<${RecordsDialog} />` : null;
}

function RecordsDialog() {
  const [matches, setMatches] = useState([]);
  const [selectedRule, setSelectedRule] = useState('all');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const input = useRef(null);
  useData('bonds', 'bands', 'chess', 'items', 'config');
  const read = () => {
    try { setMatches(loadRecords().matches || []); setLoadError(false); }
    catch (err) { setMessage(`战绩读取失败：${err?.message || '文件损坏'}。原有数据未被覆盖。`); setFailed(true); setLoadError(true); }
  };
  useEffect(() => {
    read();
    const refresh = (e) => { if (!e?.key || e.key === 'sp.records.v1') read(); };
    window.addEventListener('storage', refresh);
    window.addEventListener('sp-records-updated', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('sp-records-updated', refresh); };
  }, []);
  const rules = [...new Set(['current', 'legacy', ...matches.map((record) => record.rulesetId)])].filter(Boolean);
  const filtered = selectedRule === 'all' ? matches : matches.filter((record) => record.rulesetId === selectedRule);
  const summary = summarizeRecords(filtered);
  const difficulties = [...new Set([...Object.keys(DIFFICULTY_NAMES), ...filtered.map((record) => record.difficulty)])].filter(Boolean);
  const notify = (text, error = false) => { setMessage(text); setFailed(error); };
  const download = () => {
    try {
      const blob = new Blob([exportRecords()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `wei_plus-战绩-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('已导出全部模式的战绩备份。');
    } catch (err) { notify(err?.message || '备份导出失败', true); }
  };
  const upload = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { notify('文件过大，请选择 20 MB 以内的战绩 JSON。', true); return; }
    try {
      const count = importRecords(await file.text());
      read(); notify(`已合并 ${number(count)} 条新记录，原有战绩已保留。`);
    } catch (err) { notify(err?.message || '备份导入失败', true); }
  };
  return html`<${Modal} open=${true} onClose=${close} title="战绩与对战历史" micro="RECORDS // STRONGHOLD PROTOCOL" width="min(13rem, 96vw)" class="records"
    actions=${html`<${Button} size="sm" icon="copy" disabled=${loadError} onClick=${download}>导出备份<//><${Button} size="sm" icon="plus" disabled=${loadError} onClick=${() => input.current?.click()}>导入备份<//><${Button} size="sm" variant="primary" onClick=${close}>关闭<//>`}>
    <input ref=${input} type="file" accept="application/json,.json" hidden onChange=${upload} />
    <p class="records__notice">仅保存在此浏览器的当前访问地址中。不同地址 / 端口的记录可通过备份合并；新增模式保留已有记录。历史从本功能上线后开始保存，原程序未保存的旧对局无法自动恢复。</p>
    ${message ? html`<p class=${`records__message ${failed ? 'is-error' : ''}`} role="status">${message}</p>` : null}
    <label class="records__filter">规则版本
      <select value=${selectedRule} onChange=${(e) => setSelectedRule(e.currentTarget.value)}><option value="all">全部模式</option>${rules.map((id) => html`<option key=${id} value=${id}>${ruleName(id)}</option>`)}</select>
    </label>
    <div class="records__totals">${[['完成对局', summary.games], ['胜场', summary.wins], ['累计奖杯', summary.trophies], ['卫戍认证', summary.reward]].map(([label, value]) => html`<div><span>${label}</span><b>${number(value)}</b></div>`)}</div>
    <section class="records__section"><h3>各难度胜场</h3><div class="records__counts">${difficulties.map((difficulty) => {
      const games = filtered.filter((record) => record.difficulty === difficulty);
      return html`<div key=${difficulty} class="records__count"><span>${DIFFICULTY_NAMES[difficulty] || difficulty}</span><span><b>${number(games.filter((record) => record.victory).length)}</b> 胜 <small>/ ${number(games.length)} 局</small></span></div>`;
    })}</div></section>
    <${CountList} title="盟约胜场（结算时已激活）" entries=${summary.bonds} catalogue=${data.list('bonds')} lookup=${getBond} idKey="bondId" />
    <${CountList} title="策略胜场" entries=${summary.bands} catalogue=${data.list('bands')} lookup=${getBand} idKey="bandId" />
    <section class="records__section"><h3>对战历史 <small>${number(filtered.length)} 局 · 点击展开阵容</small></h3>
      ${filtered.length ? html`<div class="records__history">${filtered.map((record) => html`<${HistoryRow} key=${record.id} record=${record} />`)}</div>` : html`<p class="records__empty">暂无记录。完成一局游戏后会自动保存。</p>`}
    </section>
  <//>`;
}
