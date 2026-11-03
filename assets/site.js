// olly.st's only script: the Nostr key's Copy button, and the background
// animation (a slow aurora glow behind a sparse mesh of drifting nodes, with
// the odd pulse travelling along a link). The page works fully without it.
//
// Kept light on purpose: one canvas, the aurora drawn at 1/8 size and scaled
// up (it's blurry anyway), node count based on screen area, 30fps on small
// screens, paused while the tab is hidden, and a single still frame when the
// visitor prefers reduced motion or has Data Saver on.

(() => {
  setUpCopyButton();

  const canvas = document.querySelector(".mesh");
  const ctx = canvas && canvas.getContext("2d");
  if (!ctx) return;

  const aurora = document.createElement("canvas");
  const actx = aurora.getContext("2d");
  const AURORA_SCALE = 1 / 8;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  // Four glows. Positions and sizes are fractions of the screen; each drifts
  // round its home on its own slow loop.
  const blobs = [
    { x: 0.18, y: 0.12, r: 0.55, sx: 0.00007, sy: 0.00005, phase: 0 },
    { x: 0.82, y: 0.3, r: 0.5, sx: 0.00005, sy: 0.00008, phase: 2.1 },
    { x: 0.45, y: 0.95, r: 0.6, sx: 0.00006, sy: 0.00004, phase: 4.2 },
    { x: 0.95, y: 0.85, r: 0.35, sx: 0.00009, sy: 0.00006, phase: 1.3 },
  ];

  let width = 0;
  let height = 0;
  let linkDistance = 140;
  let frameInterval = 1000 / 60;
  let colours;
  let nodes = [];
  let pulses = [];
  let nextPulseAt = 0;
  let pointer = null;
  let frame = 0;
  let lastTime = 0;
  let lastDrawn = 0;
  let resizeTimer = 0;

  document.documentElement.classList.add("has-mesh");
  readColours();
  resize();
  start();

  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (!animating()) drawStill();
    }, 150);
  });

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reducedMotion.addEventListener("change", start);
  darkScheme.addEventListener("change", () => {
    readColours();
    if (!animating()) drawStill();
  });

  addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "mouse") pointer = { x: event.clientX, y: event.clientY };
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => (pointer = null));

  function animating() {
    return !reducedMotion.matches && !saveData;
  }

  function start() {
    stop();
    if (!animating()) {
      pointer = null;
      drawStill();
      return;
    }
    lastTime = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  // Colours come from CSS custom properties, so the light and dark themes
  // live in site.css alongside the rest of the palette.
  function readColours() {
    const style = getComputedStyle(document.documentElement);
    const value = (name) => style.getPropertyValue(name).trim();
    colours = {
      node: value("--mesh-node"),
      link: value("--mesh-link"),
      aurora: value("--mesh-aurora").split("|").map((rgb) => rgb.trim()),
      auroraAlpha: parseFloat(value("--mesh-aurora-alpha")) || 0.2,
      linkAlpha: parseFloat(value("--mesh-link-alpha")) || 0.2,
      blend: value("--mesh-blend") || "source-over",
    };
  }

  function resize() {
    width = innerWidth;
    height = innerHeight;
    const small = width < 700;
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    aurora.width = Math.max(1, Math.round(width * AURORA_SCALE));
    aurora.height = Math.max(1, Math.round(height * AURORA_SCALE));

    frameInterval = 1000 / (small ? 30 : 60);
    linkDistance = clamp(Math.min(width, height) * 0.2, 90, 160);

    const wanted = Math.round(clamp((width * height) / 16000, 16, 80));
    nodes = nodes.filter((node) => node.x <= width + 20 && node.y <= height + 20).slice(0, wanted);
    while (nodes.length < wanted) nodes.push(makeNode());
    pulses = [];
  }

  function makeNode() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 9; // pixels per second
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 1 + Math.random() * 1.6,
      // About one node in six glows in one of the accent colours.
      accent: Math.random() < 0.17 ? Math.floor(Math.random() * 4) : -1,
      ox: 0,
      oy: 0,
    };
  }

  function tick(time) {
    frame = requestAnimationFrame(tick);
    if (time - lastDrawn < frameInterval - 1) return;
    const dt = lastTime ? Math.min(time - lastTime, 100) / 1000 : 0;
    lastTime = time;
    lastDrawn = time;
    step(dt, time);
    draw(time);
  }

  function drawStill() {
    draw(12000);
  }

  function step(dt, time) {
    const margin = 20;
    const reach = 150;

    for (const node of nodes) {
      node.x += node.vx * dt;
      node.y += node.vy * dt;
      if (node.x < -margin) node.x = width + margin;
      else if (node.x > width + margin) node.x = -margin;
      if (node.y < -margin) node.y = height + margin;
      else if (node.y > height + margin) node.y = -margin;

      // Nodes near the mouse lean gently away from it, then drift back.
      let tx = 0;
      let ty = 0;
      if (pointer) {
        const dx = node.x - pointer.x;
        const dy = node.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < reach && distance > 0.1) {
          const push = (1 - distance / reach) * 28;
          tx = (dx / distance) * push;
          ty = (dy / distance) * push;
        }
      }
      node.ox += (tx - node.ox) * 0.08;
      node.oy += (ty - node.oy) * 0.08;
    }

    if (time >= nextPulseAt && pulses.length < 6) {
      spawnPulse(time);
      nextPulseAt = time + 700 + Math.random() * 1100;
    }
    pulses = pulses.filter((pulse) => time - pulse.born < pulse.duration);
  }

  // A pulse runs from a random node to its nearest neighbour.
  function spawnPulse(time) {
    const from = nodes[Math.floor(Math.random() * nodes.length)];
    let to = null;
    let best = linkDistance;
    for (const node of nodes) {
      if (node === from) continue;
      const distance = Math.hypot(node.x - from.x, node.y - from.y);
      if (distance < best) {
        best = distance;
        to = node;
      }
    }
    if (to) pulses.push({ from, to, born: time, duration: 1200 + best * 6, colour: Math.floor(Math.random() * 4) });
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    drawAurora(time);
    drawMesh(time);
  }

  function drawAurora(time) {
    const w = aurora.width;
    const h = aurora.height;
    const size = Math.max(w, h);
    actx.clearRect(0, 0, w, h);
    actx.globalCompositeOperation = colours.blend;

    blobs.forEach((blob, index) => {
      const x = (blob.x + Math.sin(time * blob.sx + blob.phase) * 0.12) * w;
      const y = (blob.y + Math.cos(time * blob.sy + blob.phase) * 0.1) * h;
      const radius = blob.r * size * (1 + Math.sin(time * 0.00011 + blob.phase) * 0.08);
      const rgb = colours.aurora[index % colours.aurora.length];
      const glow = actx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(${rgb}, ${colours.auroraAlpha})`);
      glow.addColorStop(0.55, `rgba(${rgb}, ${colours.auroraAlpha * 0.35})`);
      glow.addColorStop(1, `rgba(${rgb}, 0)`);
      actx.fillStyle = glow;
      actx.fillRect(0, 0, w, h);
    });

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(aurora, 0, 0, width, height);
  }

  function drawMesh(time) {
    const count = nodes.length;
    ctx.lineWidth = 1;

    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      const ax = a.x + a.ox;
      const ay = a.y + a.oy;
      for (let j = i + 1; j < count; j++) {
        const b = nodes[j];
        const dx = b.x + b.ox - ax;
        const dy = b.y + b.oy - ay;
        if (Math.abs(dx) > linkDistance || Math.abs(dy) > linkDistance) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= linkDistance) continue;
        const alpha = (1 - distance / linkDistance) * colours.linkAlpha;
        ctx.strokeStyle = `rgba(${colours.link}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + dx, ay + dy);
        ctx.stroke();
      }
    }

    if (pointer) {
      for (const node of nodes) {
        const dx = node.x + node.ox - pointer.x;
        const dy = node.y + node.oy - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= linkDistance * 1.2) continue;
        ctx.strokeStyle = `rgba(${colours.aurora[2]}, ${((1 - distance / (linkDistance * 1.2)) * 0.35).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(pointer.x, pointer.y);
        ctx.lineTo(pointer.x + dx, pointer.y + dy);
        ctx.stroke();
      }
    }

    for (const node of nodes) {
      const colour = node.accent >= 0 ? colours.aurora[node.accent] : colours.node;
      ctx.fillStyle = `rgba(${colour}, ${node.accent >= 0 ? 0.9 : 0.55})`;
      ctx.beginPath();
      ctx.arc(node.x + node.ox, node.y + node.oy, node.accent >= 0 ? node.radius + 0.6 : node.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const pulse of pulses) {
      const progress = (time - pulse.born) / pulse.duration;
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const x = lerp(pulse.from.x + pulse.from.ox, pulse.to.x + pulse.to.ox, eased);
      const y = lerp(pulse.from.y + pulse.from.oy, pulse.to.y + pulse.to.oy, eased);
      const fade = Math.sin(progress * Math.PI);
      const rgb = colours.aurora[pulse.colour];
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
      glow.addColorStop(0, `rgba(${rgb}, ${(0.9 * fade).toFixed(3)})`);
      glow.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function setUpCopyButton() {
    const button = document.querySelector(".copy");
    if (!button || !navigator.clipboard || !window.isSecureContext) return;
    const status = button.nextElementSibling;
    const label = button.textContent;
    let timer = 0;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Copied";
        status.textContent = "Nostr key copied";
      } catch {
        button.textContent = "Couldn't copy";
        status.textContent = "Couldn't copy the Nostr key";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = label;
        status.textContent = "";
      }, 2000);
    });
  }
})();
