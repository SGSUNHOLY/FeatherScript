// Interactive VFX layer: one transparent canvas behind the interface.
// Soft glow sprites follow the pointer, get pushed away by it, and bloom on
// clicks. Everything is capped and stops when the window is hidden or off.
"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  const MAX_DPR = 1.5;
  const PIXEL_BUDGET = 3000000;
  const MAX_PARTICLES = 240;
  const MAX_RINGS = 14;
  const SPRITE = 64;
  const TAU = Math.PI * 2;

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  function hexToRgb(value, fallback) {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(value || "").trim());
    if (!match) return fallback;
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
  }

  const rgba = (color, alpha) => `rgba(${color[0]},${color[1]},${color[2]},${alpha.toFixed(3)})`;
  const emptyVFX = () => ({burst(){},trail(){},shock(){},setOptions(){},setActive(){},refresh(){},clear(){},destroy(){},get count(){return 0;}});

  function createVFX(canvas, options = {}) {
    const doc = (canvas && canvas.ownerDocument) || (typeof document !== "undefined" ? document : null);
    const win = options.window || (typeof window !== "undefined" ? window : null);
    if (!canvas || !doc || !win || !canvas.getContext) {
      return emptyVFX();
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return emptyVFX();
    let intensity = clamp(Number(options.intensity ?? 0.6) || 0, 0, 1);
    let motion = options.motion || "full";
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;

    let ambientClock = 0;
    let destroyed = false, active = true, lastPointerAt = -Infinity;
    let light = false;
    let ambientKind = 'dust';
    let sprites = null;
    let paletteKey = '', lastTrailAt = -Infinity, travel = 0;
    let palette = {
      accent: [120, 190, 255],
      soft: [180, 220, 255],
      ok: [130, 240, 160],
      paper: [13, 15, 19],
    };
    const particles = [];
    const rings = [];
    const pointer = { x: -999, y: -999, active: false, px: 0, py: 0, trailX:0, trailY:0 };
    const aura = { x: -999, y: -999, tx: -999, ty: -999, alpha: 0 };

    const live = () => motion !== "off" && !destroyed && active;
    const luminance = (color) => (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;

    function makeSprite(color, profile) {
      const sprite = doc.createElement("canvas");
      sprite.width = SPRITE;
      sprite.height = SPRITE;
      const g = sprite.getContext("2d");
      const half = SPRITE / 2;
      const grad = g.createRadialGradient(half, half, 0, half, half, half);
      for (const [stop, alpha] of profile || [[0, 1], [0.2, 0.86], [0.48, 0.3], [1, 0]]) {
        grad.addColorStop(stop, rgba(color, alpha));
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, SPRITE, SPRITE);
      return sprite;
    }

    function buildSprites() {
      sprites = {
        accent: makeSprite(palette.accent),
        soft: makeSprite(palette.soft),
        ok: makeSprite(palette.ok),
      };
    }

    // Light surfaces need colored ink rather than additive white glow.
    function refresh() {
      try {
        const style = win.getComputedStyle(doc.body);
        const theme = doc.body?.dataset?.theme;
        const motif = globalThis.FSThemeMotion?.themes[theme]?.[0];
        ambientKind = ['orbit','saturn','satellite'].includes(motif) ? 'star' : ['snow','hollow','frost','glacier','snowmountain'].includes(motif) ? (motif === 'hollow' ? 'ember' : 'snow') : ['petal','leaf'].includes(motif) ? 'petal' : 'dust';
        const paper = hexToRgb(style.getPropertyValue("--paper"), palette.paper);
        light = luminance(paper) > 0.55;
        const accent = hexToRgb(style.getPropertyValue("--accent"), palette.accent);
        const soft = hexToRgb(style.getPropertyValue("--accent-soft"), palette.soft);
        const ink = hexToRgb(style.getPropertyValue("--ink"), [48,56,64]);
        const mix = (color, weight) => color.map((value,index)=>Math.round(value*(1-weight)+ink[index]*weight));
        palette = light
          ? { accent:mix(accent,.3), soft:mix(accent,.5), ok:mix(hexToRgb(style.getPropertyValue('--ok'),[35,130,80]),.2), paper }
          : {
              accent,
              soft,
              ok: hexToRgb(style.getPropertyValue("--ok"), palette.ok),
              paper,
            };
        const key = JSON.stringify(palette);
        if (!sprites || key !== paletteKey) { buildSprites(); paletteKey = key; }
      } catch {}
    }

    function resize() {
      width = win.innerWidth;
      height = win.innerHeight;
      dpr = Math.min(MAX_DPR, win.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / Math.max(1,width*height)));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function push(particle) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push(particle);
    }

    // ── spawners ───────────────────────────────────────────────────────────

    function spark(x, y, tone, power) {
      const angle = Math.random() * TAU;
      const speed = (38 + Math.random() * 125) * (0.5 + intensity) * (0.7 + power * 0.35);
      return {
        kind: "spark",
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 34,
        size: 0.8 + Math.random() * 1.5,
        ttl: 0.38 + Math.random() * 0.5,
        phase: Math.random() * TAU,
        life: 0,
        tone: tone === "ok" ? "ok" : Math.random() < 0.32 ? "soft" : "accent",
      };
    }

    function puff(x, y, power) {
      const angle = Math.random() * TAU;
      const speed = (18 + Math.random() * 56) * (0.6 + power * 0.4);
      return {
        kind: "trail",
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.2 + Math.random() * 1.8,
        ttl: 0.4 + Math.random() * 0.35,
        life: 0,
        tone: Math.random() < 0.5 ? "soft" : "accent",
      };
    }

    function mote() {
      return {
        kind: "mote",
        x: Math.random() * width,
        y: height * (0.12 + Math.random() * 0.95),
        vx: (Math.random() - 0.5) * 10,
        vy: ['snow','petal'].includes(ambientKind) ? 9 + Math.random()*7 : -2 - Math.random() * 6,
        size: ambientKind === 'dust' ? .6+Math.random() : 1.2+Math.random()*1.2,
        ttl: 10 + Math.random() * 12,
        life: 0,
        phase: Math.random() * TAU,
        twinkle: 0.6 + Math.random() * 1.4,
        alpha: 0.1 + Math.random() * 0.13,
        tone: Math.random() < 0.34 ? "accent" : "soft",
      };
    }

    function shock(x, y, power) {
      if (!live() || motion === "reduced") return;
      rings.push({
        x, y,
        r: 5 + power * 2,
        speed: 110 + power * 100,
        life: 0,
        ttl: 0.32 + power * 0.16,
        width: 0.7 + power * 0.5,
      });
      if (rings.length > MAX_RINGS) rings.shift();
    }

    function burst(x, y, opts = {}) {
      if (!live() || intensity <= .02) return;
      const power = clamp(Number(opts.power) || 1, 0.3, 2);
      const reduced = motion === "reduced";
      const count = Math.round((reduced ? 3 : 6 + 8 * intensity) * power);
      for (let i = 0; i < count; i++) push(spark(x, y, opts.tone, power));
      if (!reduced && !light) {
        const puffs = Math.round(1 + 1.5 * intensity);
        for (let i = 0; i < puffs; i++) push(puff(x, y, power));
      }
      shock(x, y, power);
      kick();
    }

    function trail(x, y, dx, dy) {
      if (!live() || motion !== "full" || intensity <= 0.02) return;
      const speed = Math.hypot(dx, dy);
      const count = Math.min(4, 1 + Math.floor(speed / 20) + (intensity > 0.75 ? 1 : 0));
      for (let i = 0; i < count; i++) {
        push({
          kind: "trail",
          x: x + (Math.random() - 0.5) * 7,
          y: y + (Math.random() - 0.5) * 7,
          vx: -dx * 1.15 + (Math.random() - 0.5) * 34,
          vy: -dy * 1.15 + (Math.random() - 0.5) * 34,
          size: 0.9 + Math.random() * 1.7,
          ttl: 0.36 + Math.random() * 0.44,
          life: 0,
          tone: Math.random() < 0.4 ? "accent" : "soft",
        });
      }
      kick();
    }

    // ── simulation ─────────────────────────────────────────────────────────

    function repel(dt) {
      if (!pointer.active) return;
      const radius = 92 + 58 * intensity;
      const force = 560 * dt;
      for (const p of particles) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > radius * radius || dist2 < 0.01) continue;
        const dist = Math.sqrt(dist2);
        const push = (1 - dist / radius) * force * (p.kind === 'mote' ? .18 : 1);
        p.vx += (dx / dist) * push;
        p.vy += (dy / dist) * push;
      }
    }

    function ambient(dt) {
      if (motion !== "full" || intensity <= 0.05) return;
      const target = Math.round(light ? 4 + intensity * 6 : 6 + intensity * 10);
      ambientClock += dt;
      let motes = 0;
      for (const p of particles) if (p.kind === "mote") motes++;
      if (motes < target && ambientClock > 0.5) {
        ambientClock = 0;
        push(mote());
      }
    }

    function step(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === "mote") {
          p.vx += Math.sin(p.life * .7 + p.phase) * 2 * dt;
          p.vx *= 1 - Math.min(0.9, 0.35 * dt);
          if (p.y < -14) p.y = height + 10;
        } else {
          const drag = p.kind === "spark" ? 2.1 : 3.4;
          const gravity = p.kind === "spark" ? 65 : 16;
          p.vx *= 1 - Math.min(0.9, drag * dt);
          p.vy = p.vy * (1 - Math.min(0.9, drag * dt)) + gravity * dt;
        }
        if (p.life >= p.ttl || p.x < -60 || p.x > width + 60 || p.y > height + 80) particles.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.life += dt;
        ring.r += ring.speed * dt;
        ring.speed *= 1 - Math.min(0.9, 2.1 * dt);
        if (ring.life >= ring.ttl) rings.splice(i, 1);
      }
      const follow = Math.min(1, dt * 15);
      if (aura.tx > -900) {
        aura.x += (aura.tx - aura.x) * follow;
        aura.y += (aura.ty - aura.y) * follow;
      }
      const goal = pointer.active && motion === "full" && intensity > .02 ? 1 : 0;
      aura.alpha += (goal - aura.alpha) * Math.min(1, dt * 7);
    }

    function glow(key, x, y, radius, alpha) {
      if (alpha <= 0.004) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprites[key], x - radius, y - radius, radius * 2, radius * 2);
    }

    function drawAura() {
      if (aura.alpha <= 0.02 || aura.x < -900) return;
      const radius = 40 + 38 * intensity;
      const scale = light ? 0.5 : 0.75;
      glow("soft", aura.x, aura.y, radius, aura.alpha * 0.06 * scale);
    }

    function drawRing(ring) {
      const k = ring.life / ring.ttl;
      if (k >= 1) return;
      const alpha = (1 - k) * (1 - k) * (light ? 0.48 : 0.52);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(palette.soft, alpha);
      ctx.lineWidth = ring.width * (1 - k) + 0.5;
      ctx.beginPath();
      const turn = k * 1.3;
      ctx.arc(ring.x, ring.y, ring.r, turn, turn + Math.PI * .78);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, turn + Math.PI, turn + Math.PI * 1.78);
      ctx.stroke();
    }

    function drawMote(p) {
      const fade = Math.min(1, p.life / 1.4) * clamp(1 - p.life / p.ttl, 0, 1);
      const twinkle = 0.62 + 0.38 * Math.sin(p.life * p.twinkle + p.phase);
      const alpha = p.alpha * twinkle * fade * (light ? 0.6 : 0.88);
      glow(p.tone, p.x, p.y, p.size * 2.2, alpha);
      if (ambientKind === 'petal') {
        const angle = p.phase + p.life*.5, r=p.size*1.5;
        const dx=Math.cos(angle)*r,dy=Math.sin(angle)*r;
        ctx.globalAlpha=Math.min(.36,alpha*2);ctx.strokeStyle=rgba(palette[p.tone],1);ctx.lineWidth=.9;
        ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x-dy*.55,p.y+dx*.55);ctx.lineTo(p.x+dx,p.y+dy);ctx.lineTo(p.x+dy*.55,p.y-dx*.55);ctx.lineTo(p.x-dx,p.y-dy);ctx.stroke();
      } else if (ambientKind === 'snow') {
        const r=p.size*1.8;
        ctx.globalAlpha=Math.min(.4,alpha*2);ctx.strokeStyle=rgba(palette[p.tone],1);ctx.lineWidth=.7;ctx.beginPath();
        for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*r,dy=Math.sin(a)*r;ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);}ctx.stroke();
      } else if (ambientKind === 'star' || p.phase > Math.PI) {
        ctx.globalAlpha=alpha*.8;ctx.strokeStyle=rgba(palette[p.tone],1);ctx.lineWidth=.7;
        const radius=p.size*(1.3+.3*twinkle);
        ctx.beginPath();ctx.moveTo(p.x-radius,p.y);ctx.lineTo(p.x+radius,p.y);ctx.moveTo(p.x,p.y-radius);ctx.lineTo(p.x,p.y+radius);ctx.stroke();
      }
    }

    function drawSpark(p) {
      const alpha = Math.pow(1 - p.life / p.ttl, 1.6) * (light ? 0.62 : 0.8);
      if (alpha <= 0.01) return;
      const speed = Math.hypot(p.vx, p.vy);
      const radius = p.size * 1.6 + 1;
      if (speed > 16) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = rgba(palette[p.tone] || palette.accent, 1);
        ctx.lineWidth = Math.max(0.6, p.size * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.lineTo(p.x, p.y);
        // A short side barb makes the sliver read as a tiny quill.
        ctx.moveTo(p.x-p.vx*.015-p.vy*.012,p.y-p.vy*.015+p.vx*.012);
        ctx.lineTo(p.x,p.y);
        ctx.stroke();
      }
      glow(p.tone, p.x, p.y, radius, alpha);
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      ctx.lineCap = "round";
      drawAura();
      for (const ring of rings) drawRing(ring);
      for (const p of particles) {
        if (p.kind === "mote") drawMote(p);
        else drawSpark(p);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    function busy() {
      return particles.length > 0 || rings.length > 0 || aura.alpha > 0.02 || (motion === "full" && intensity > 0.05);
    }

    function frame(now) {
      raf = 0;
      if (!live() || doc.hidden) return;
      const ambientOnly=(!pointer.active || now-lastPointerAt>160) && rings.length===0 && particles.every(p=>p.kind==='mote');
      const interval=ambientOnly?1000/30:1000/60;
      if(last && now-last<interval-0.5){raf=win.requestAnimationFrame(frame);return;}
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      repel(dt);
      ambient(dt);
      step(dt);

      draw();
      if (busy()) raf = win.requestAnimationFrame(frame);
      else last = 0;
    }

    function kick() {
      if (!live() || doc.hidden || raf) return;
      last = 0;
      raf = win.requestAnimationFrame(frame);
    }

    // ── input ──────────────────────────────────────────────────────────────

    function onPointerMove(event) {
      if(!live() || doc.hidden)return;
      lastPointerAt = win.performance?.now?.() ?? event.timeStamp ?? 0;
      if (!pointer.active) {
        pointer.px=event.clientX;pointer.py=event.clientY;
        pointer.trailX=event.clientX;pointer.trailY=event.clientY;travel=0;
      }
      const dx = event.clientX - pointer.px;
      const dy = event.clientY - pointer.py;
      pointer.px = event.clientX;
      pointer.py = event.clientY;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      aura.tx = event.clientX;
      aura.ty = event.clientY;
      if (aura.x < -900) {
        aura.x = aura.tx;
        aura.y = aura.ty;
      }
      const distance = Math.hypot(dx, dy);
      travel += distance;
      if (travel > (intensity > 0.6 ? 9 : 16) && lastPointerAt-lastTrailAt>=40) {
        trail(event.clientX,event.clientY,clamp(event.clientX-pointer.trailX,-40,40),clamp(event.clientY-pointer.trailY,-40,40));
        pointer.trailX=event.clientX;pointer.trailY=event.clientY;lastTrailAt=lastPointerAt;travel=0;
      }
      kick();
    }

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      burst(event.clientX, event.clientY);
    }

    function onPointerLeave() {
      pointer.active = false;
      pointer.x = -999;
      pointer.y = -999;
    }

    function onHiddenChange() {
      if (doc.hidden) {
        if (raf) win.cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      } else {
        kick();
      }
    }

    function clear() {
      particles.length = 0;
      rings.length = 0;
      pointer.active=false;aura.alpha=0;travel=0;lastTrailAt=-Infinity;
      ctx.clearRect(0, 0, width, height);
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    function setOptions(next = {}) {
      if (next.intensity != null) intensity = clamp(Number(next.intensity) || 0, 0, 1);
      if (typeof next.motion === "string") motion = next.motion;
      if (!live() || motion === "reduced") {
        clear();
      }
      if (live() && motion === "full") kick();
    }

    function setActive(value) {
      active=value!==false;
      if(!active){onPointerLeave();aura.alpha=0;clear();}else kick();
    }
    function destroy() {
      destroyed = true;
      clear();
      win.removeEventListener("resize", resize);
      win.removeEventListener("pointermove", onPointerMove);
      win.removeEventListener("pointerdown", onPointerDown);
      doc.documentElement.removeEventListener("pointerleave", onPointerLeave);
      doc.removeEventListener("visibilitychange", onHiddenChange);
    }

    resize();
    refresh();
    win.addEventListener("resize", resize);
    win.addEventListener("pointermove", onPointerMove, { passive: true });
    if (options.handleClicks !== false) win.addEventListener("pointerdown", onPointerDown, { passive: true });
    doc.documentElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
    doc.addEventListener("visibilitychange", onHiddenChange);
    kick();

    return {
      burst,
      trail,
      shock,
      clear,
      refresh,
      setOptions,
      setActive,
      destroy,
      get count() { return particles.length + rings.length; },
    };
  }

  modules.VFX = { createVFX, hexToRgb, clamp, MAX_PARTICLES };
})();
