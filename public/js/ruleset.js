import { useEffect, useState } from '../vendor/hooks.module.js';
import { html, Button } from './ui/components.js';
import { getConfig } from './data.js';
import { DIFFICULTIES, modeIdFor } from '../../shared/constants.js';
import { alternateRulesetUrl } from './multiplayerLinks.js';

export function availableDifficulties(mode) {
  const cfg = getConfig();
  return DIFFICULTIES.filter((d) => cfg?.modes?.[modeIdFor(mode, d)]?.inScope !== false);
}

export function RulesetPicker() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/ruleset').then((r) => r.ok ? r.json() : null).then((v) => {
      if (!alive || !v) return;
      setInfo(v);
      document.title = v.name;
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!info?.alternatePort && !info?.alternateUrl) return null;
  const old = info.id === 'legacy';
  const alternate = alternateRulesetUrl(info, window.location.href);
  const switchVersion = () => {
    if (alternate) window.location.assign(alternate);
  };
  return html`<div class="ruleset-picker" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:12px;margin:8px 0;border:1px solid var(--c-line, #365249);border-radius:6px;background:rgba(7,18,14,.8)">
    <span style="color:var(--c-mint, #62e8ba);font-weight:700">${info.name}</span>
    <span style="font-size:12px;color:#b5c3bc">${info.baseline}</span>
    ${alternate ? html`<${Button} variant="secondary" size="sm" onClick=${switchVersion}>${old ? '切换当前版' : '卫戍协议旧版'}<//>`
      : html`<span style="font-size:12px;color:#b5c3bc">另一版本需使用单独的联机网址</span>`}
  </div>`;
}
