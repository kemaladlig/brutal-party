// Avatar Lab — penguen rig prototip sahnesi (oyun dışı, sunum katmanı).
//
// Tek kayıt noktası `views/registry.js` desenindedir: `rail: null` ara adımdır,
// profile toolbar'ındaki LAB düğmesinden `openView('avatar-lab')` ile açılır.
// Sahne zarfı oyunlarla aynıdır (`createTiltedScene` + `drawField25d`), kamera
// matematiği tek kaynaktan gelir; simülasyon/ağ kodu yok.

import { registerView } from './registry.js';
import { createTiltedScene } from '../../core/tiltedScene.js';
import { arenaFromRect } from '../../core/projection2d.js';
import { drawField25d } from '../../core/fieldKit.js';
import { drawGameAvatar25d } from '../../core/avatarInGame.js';
import { getAvatarProfile } from '../../core/customizationManager.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import {
  AVATAR_LAB_CLIPS, AVATAR_LAB_PROPS, AVATAR_LAB_EXPRESSIONS,
  rigPoseForClip, labHandAnchor, drawLabProp,
} from '../../core/avatarRig.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function chipRow(items, activeId, onPick, focusScope) {
  const row = el('div', 'avatar-lab-row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  for (const it of items) {
    const id = typeof it === 'string' ? it : it.id;
    const label = typeof it === 'string' ? it.toUpperCase() : (it.label || id.toUpperCase());
    const b = el('button', `scene-btn is-ghost avatar-lab-chip${id === activeId ? ' is-active' : ''}`);
    b.type = 'button';
    b.dataset.focus = focusScope;
    b.style.cssText = 'min-height:40px;padding:8px 12px;font-size:12px;';
    b.setAttribute('aria-pressed', String(id === activeId));
    b.textContent = label;
    b.addEventListener('click', () => {
      row.querySelectorAll('.avatar-lab-chip').forEach((n) => {
        const on = n === b;
        n.classList.toggle('is-active', on);
        n.setAttribute('aria-pressed', String(on));
      });
      onPick(id);
    });
    row.append(b);
  }
  return row;
}

registerView('avatar-lab', {
  title: 'AVATAR LAB',
  rail: null,
  build(ctx) {
    const state = {
      clip: 'walk',
      prop: 'crown',
      expression: getAvatarProfile()?.expression?.toLowerCase?.() || 'focus',
      facingBase: 0,
      speed: 1,
      running: true,
      raf: 0,
      ro: null,
    };
    if (!AVATAR_LAB_EXPRESSIONS.includes(state.expression)) state.expression = 'focus';

    const view = el('div', 'scene avatar-lab-view');
    view.style.cssText = 'display:grid;grid-template-columns:minmax(0,1.5fr) minmax(240px,1fr);gap:16px;align-items:start;width:100%;';

    const stageWrap = el('div', 'avatar-lab-stage');
    stageWrap.style.cssText = 'position:relative;border-radius:16px;overflow:hidden;min-height:320px;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:46vh;min-height:300px;';
    canvas.setAttribute('aria-label', 'Avatar önizleme sahnesi');
    stageWrap.append(canvas);
    view.append(stageWrap);

    const panel = el('div', 'avatar-lab-panel');
    panel.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    const head = el('div', 'avatar-lab-head');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const backBtn = el('button', 'scene-btn is-ghost');
    backBtn.type = 'button';
    backBtn.dataset.focus = 'act';
    backBtn.style.cssText = 'min-height:44px;padding:8px 12px;';
    backBtn.innerHTML = `<span class="scene-btn-icon">${getTabletopIconSvg('arrow_left_right', { size: 16 })}</span><span class="scene-btn-label">KARAKTERE DÖN</span>`;
    backBtn.addEventListener('click', () => ctx.openView('profile'));
    const title = el('strong', '', 'AVATAR LAB');
    title.style.cssText = 'letter-spacing:0.12em;font-size:13px;';
    head.append(backBtn, title);
    panel.append(head);

    const clipRow = chipRow(AVATAR_LAB_CLIPS, state.clip, (id) => { state.clip = id; }, 'act');
    const propRow = chipRow(AVATAR_LAB_PROPS, state.prop, (id) => { state.prop = id; }, 'act');
    const expRow = chipRow(AVATAR_LAB_EXPRESSIONS, state.expression, (id) => { state.expression = id; }, 'act');
    const mkLabel = (t) => {
      const s = el('span', '', t);
      s.style.cssText = 'font-size:11px;letter-spacing:0.1em;opacity:0.75;';
      return s;
    };
    panel.append(mkLabel('HAREKET'), clipRow, mkLabel('ELDEKİ'), propRow, mkLabel('YÜZ'), expRow);

    const facingLabel = mkLabel('YÖN');
    const facing = document.createElement('input');
    facing.type = 'range';
    facing.min = '-3.14';
    facing.max = '3.14';
    facing.step = '0.01';
    facing.value = '0';
    facing.setAttribute('aria-label', 'Bakış yönü');
    facing.style.cssText = 'width:100%;min-height:44px;';
    facing.addEventListener('input', () => { state.facingBase = Number(facing.value) || 0; });

    const playBtn = el('button', 'scene-btn is-gold');
    playBtn.type = 'button';
    playBtn.dataset.focus = 'act';
    playBtn.style.cssText = 'min-height:44px;';
    playBtn.innerHTML = `<span class="scene-btn-label">DURAKLAT</span>`;
    playBtn.addEventListener('click', () => {
      state.running = !state.running;
      playBtn.querySelector('.scene-btn-label').textContent = state.running ? 'DURAKLAT' : 'DEVAM ET';
      if (state.running) last = performance.now();
    });
    panel.append(facingLabel, facing, playBtn);
    view.append(panel);

    const scene = createTiltedScene({});
    const arena = arenaFromRect([-110, -80, 110, 80]);
    const profile = getAvatarProfile() || {};
    const player = { index: 0, color: profile.color || '#F0483C', expression: state.expression, vx: 0, vy: 0 };
    let last = performance.now();
    let frozenAt = 0;

    const syncSize = () => {
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width || 320));
      const h = Math.max(2, Math.round(rect.height || 300));
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    };
    syncSize();
    if (typeof ResizeObserver === 'function') {
      state.ro = new ResizeObserver(() => syncSize());
      state.ro.observe(canvas);
    }

    const frame = (now) => {
      try {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!state.running) {
          frozenAt = frozenAt || now;
          state.raf = requestAnimationFrame(frame);
          return;
        }
        frozenAt = 0;
        void dt;
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(2, rect.width || 320);
        const h = Math.max(2, rect.height || 300);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) {
          state.raf = requestAnimationFrame(frame);
          return;
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, w, h);

        const pose = rigPoseForClip(state.clip, now, { facingBase: state.facingBase, speed: state.speed });
        player.vx = pose.vx;
        player.vy = pose.vy;
        player.expression = state.expression;
        try {
          player.color = (getAvatarProfile()?.color) || player.color;
        } catch { /* profil okunamazsa mevcut renk korunur */ }

        const proj = scene.open(ctx2d, { viewport: { width: w, height: h }, arena, theme: 'garden' });
        drawField25d(ctx2d, proj, arena);
        const fig = drawGameAvatar25d(ctx2d, proj, player, {
          x: pose.x,
          y: pose.y,
          radius: 34,
          facingAngle: pose.facingAngle,
          expression: state.expression,
          now,
        });
        if (state.prop !== 'none' && fig) {
          const propS = Math.max(14, fig.torsoR * 0.62);
          if (state.clip === 'cheer') {
            drawLabProp(ctx2d, state.prop, fig.torsoX, fig.topY - fig.torsoR * 0.35, propS, now);
          } else {
            const hand = labHandAnchor(fig, pose.facingAngle);
            drawLabProp(ctx2d, state.prop, hand.x, hand.y, propS, now);
          }
        }
        scene.close(ctx2d);
      } catch (err) {
        console.error('[avatar-lab]', err);
      }
      if (canvas.getClientRects().length) state.raf = requestAnimationFrame(frame);
      else state.raf = 0;
    };
    state.raf = requestAnimationFrame((n) => { last = n; state.raf = requestAnimationFrame(frame); });

    view.addEventListener('shell:viewleave', () => {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.ro?.disconnect?.();
    }, { once: true });

    return view;
  },
  onExit({ node }) {
    node.dispatchEvent(new CustomEvent('shell:viewleave'));
  },
});
