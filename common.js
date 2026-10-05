/* common.js — 宝宝游戏屋通用逻辑（触屏保护 / 多指上限 / 音效 / 音乐 / 顶栏 / 暂停 / 倒计时 / 结算框架）
   页面接入方式：
   1. 在引入本文件前设置：
      window.GAME_DURATION = 60;                       // 一局秒数
      window.GameHooks = { onStart, onTimeUp, onReset }; // 三个钩子均可选
   2. 页面逻辑里用 window.BG 拿工具：BG.state（started/paused/over/timeLeft/score）、
      BG.addScore(n)、BG.tooManyPointers()、BG.burst / showPraise / pick / retrigger /
      vibrate / tone / playBlip / chirp / fanfare
*/
(function () {
  'use strict';

  // 触屏保护
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  // 同时点击最多 5 个
  const MAX_POINTERS = 5;
  const activePointers = new Set();
  document.addEventListener('pointerdown', e => activePointers.add(e.pointerId), true);
  document.addEventListener('pointerup', e => activePointers.delete(e.pointerId), true);
  document.addEventListener('pointercancel', e => activePointers.delete(e.pointerId), true);
  function tooManyPointers() { return activePointers.size > MAX_POINTERS; }

  // 全局状态
  const DURATION = window.GAME_DURATION || 60;
  const state = { started: false, paused: false, over: false, timeLeft: DURATION, score: 0 };
  const hooks = window.GameHooks || {};

  // ---------- 小工具 ----------
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  function burst(x, y, n, glyphs) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      s.textContent = glyphs[i % glyphs.length];
      s.style.fontSize = '24px';
      const ang = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 60;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  function showPraise(x, y, text) {
    const p = document.createElement('div');
    p.className = 'praise';
    p.textContent = text;
    p.style.left = x + 'px'; p.style.top = y + 'px';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }

  // ---------- 音效引擎（WebAudio 本地合成，无需联网） ----------
  let audioCtx = null;
  function initAudio() {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function tone(freq, opt) {
    if (!audioCtx) return;
    opt = opt || {};
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    const t = audioCtx.currentTime + (opt.t0 || 0);
    const dur = opt.dur || 0.15;
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opt.slide) o.frequency.exponentialRampToValueAtTime(opt.slide, t + dur * 0.8);
    g.gain.setValueAtTime(opt.vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function playBlip() { tone(500 + Math.random() * 400, { vol: .12, dur: .12 }); }

  // 叫声：两声上滑的「啾啾」；golden 时叠一串金色琶音
  function chirp(base, golden) {
    tone(base, { type: 'triangle', vol: .28, dur: .16, slide: base * 1.6 });
    tone(base * 1.4, { type: 'triangle', vol: .28, dur: .16, slide: base * 2.2, t0: .09 });
    if (golden) {
      tone(1318, { t0: .15, dur: .3, vol: .14 });
      tone(1568, { t0: .22, dur: .3, vol: .14 });
      tone(2093, { t0: .29, dur: .3, vol: .14 });
    }
  }

  function fanfare() { [523, 659, 784, 1046].forEach((f, i) => tone(f, { t0: i * .09, dur: .4, vol: .2 })); }

  // ---------- 背景音乐（轻柔摇篮曲循环） ----------
  const melodyNotes = ['E5','G5','A5','G5','E5','D5','C5','D5','E5','G5','A5','C6','A5','G5','E5','G5','A5','G5','E5','D5','C5','D5','E5','G5','E5','D5','C5','A4','C5','C5','C5','C5'];
  const noteFreq = { A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };
  const bassNotes = ['C3','C3','F3','G3','C3','C3','F3','G3'];
  const bassFreq = { C3: 130.81, F3: 174.61, G3: 196 };
  let musicOn = true, musicStep = 0;

  function startMusic() {
    if (!audioCtx) return;
    setInterval(() => {
      if (!musicOn || document.hidden || state.paused || state.over) return;
      tone(noteFreq[melodyNotes[musicStep % melodyNotes.length]], { vol: .055, dur: 1.4 });
      if (musicStep % 4 === 0) {
        tone(bassFreq[bassNotes[Math.floor(musicStep / 4) % bassNotes.length]], { vol: .05, dur: 2.2 });
      }
      musicStep++;
    }, 620);
  }

  // ---------- 顶栏按钮 ----------

  const musicBtn = document.getElementById('musicBtn');
  if (musicBtn) {
    musicBtn.addEventListener('pointerdown', () => {
      musicOn = !musicOn;
      musicBtn.classList.toggle('off', !musicOn);
      if (musicOn && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    });
  }

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const themes = ['', 'theme-b', 'theme-c'];
    let themeIdx = 2;   // 默认星夜（与页面 body class 保持一致）
    themeBtn.addEventListener('pointerdown', () => {
      themeIdx = (themeIdx + 1) % themes.length;
      document.body.classList.remove('theme-b', 'theme-c');
      if (themeIdx) document.body.classList.add(themes[themeIdx]);
    });
  }

  // ---------- 暂停（遮罩不可点，仅 ⏸/▶ 恢复） ----------
  const pauseBtn = document.getElementById('pauseBtn');
  const pauseOverlay = document.getElementById('pauseOverlay');
  function setPaused(v) {
    if (state.over) return;
    state.paused = v;
    document.body.classList.toggle('paused', v);
    if (pauseOverlay) pauseOverlay.style.display = v ? 'flex' : 'none';
    if (pauseBtn) pauseBtn.textContent = v ? '▶' : '⏸';
  }
  if (pauseBtn) pauseBtn.addEventListener('pointerdown', () => setPaused(!state.paused));
  // 暂停页中间的大图标也能点击继续
  const pauseBigIcon = pauseOverlay ? pauseOverlay.querySelector('.big') : null;
  if (pauseBigIcon) pauseBigIcon.addEventListener('pointerdown', e => { e.stopPropagation(); setPaused(false); });

  // ---------- 开始 ----------
  const startEl = document.getElementById('start');
  const startBtn = document.getElementById('startBtn');
  function beginGame() {
    if (state.started) return;
    state.started = true;
    startEl.style.display = 'none';
    initAudio();
    startMusic();
    if (hooks.onStart) hooks.onStart();
  }
  if (startBtn) {
    // 有开始按钮的游戏：只点按钮开始
    startBtn.addEventListener('pointerdown', e => { e.stopPropagation(); beginGame(); });
  } else if (startEl) {
    startEl.addEventListener('pointerdown', beginGame, { once: true });
  }

  // ---------- 倒计时 ----------
  const timerEl = document.getElementById('timer');
  function updateTimer() { if (timerEl) timerEl.textContent = state.timeLeft; }
  updateTimer();
  setInterval(() => {
    if (!state.started || state.paused || state.over || state.timeLeft <= 0) return;
    state.timeLeft--;
    updateTimer();
    if (state.timeLeft <= 0) {
      state.over = true;
      document.body.classList.add('paused');   // 冻结画面
      if (pauseBtn) pauseBtn.textContent = '⏸';
      if (hooks.onTimeUp) hooks.onTimeUp();
    }
  }, 1000);

  // ---------- 再玩一次 ----------
  const againBtn = document.getElementById('againBtn');
  if (againBtn) {
    againBtn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      state.score = 0;
      const se = document.getElementById('score');
      if (se) se.textContent = '0';
      state.timeLeft = DURATION;
      updateTimer();
      state.paused = false; state.over = false;
      document.body.classList.remove('paused');
      if (pauseOverlay) pauseOverlay.style.display = 'none';
      const eo = document.getElementById('endOverlay');
      if (eo) eo.style.display = 'none';
      if (pauseBtn) pauseBtn.textContent = '⏸';
      if (hooks.onReset) hooks.onReset();
    });
  }

  // ---------- 加分 ----------
  function addScore(n) {
    state.score += n;
    const el = document.getElementById('score');
    if (el) el.textContent = state.score;
    const pill = document.getElementById('scorePill');
    if (pill) { pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
    return state.score;
  }

  // ---------- 暴露给页面 ----------
  window.BG = { state, tooManyPointers, addScore, burst, showPraise, pick, retrigger, vibrate, tone, playBlip, chirp, fanfare };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });
})();
