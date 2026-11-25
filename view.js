(() => {
  "use strict";
  const { WIDTH, HEIGHT, TIME_LIMIT, START, DIRS, BIOMES, FLOOR_ORDER, ZONES, ENEMIES, BESTIARY, LOOT, key, zoneAt, passable, distance, gateBearing, createExpedition, nextFloor, rerollStats, act, enemyAhead, resolveReply, startClock, tickClock, pauseGame, resumeGame, enableDebug, lowHealth } = window.Underways;
  const { AVATARS, DICE_STYLES, OUTCOMES, RELIC_PAIR_BONUS, summarizeRun, openProfile } = window.UnderwaysProfile;
  let storage;
  try { storage = window.localStorage; } catch { /* use a session-only profile */ }
  const profile = openProfile(storage);
  let settings = profile.settings;
  const get = id => document.getElementById(id);
  const world = get("world"), map = get("map");
  const ctx = world.getContext("2d"), m = map.getContext("2d");
  ctx.imageSmoothingEnabled = m.imageSmoothingEnabled = false;
  const T = 16;
  const palette = {
    entry: ["#514d3e", "#5e5745", "#39382e"],
    south: ["#50483e", "#5b5145", "#362e28"],
    west: ["#3a4636", "#485542", "#263627"],
    center: ["#4c483c", "#5a513f", "#35332e"],
    east: ["#4f3b36", "#5c443b", "#392b29"],
    north: ["#37534c", "#42645b", "#233c36"],
  };
  const image = src => {
    const img = new Image();
    img.src = `assets/${src}.png`;
    return img;
  };
  const dungeon = image("dungeon"), rpg = image("rpg"), minimap = image("minimap"), wingArt = image("wing-landmarks");
  const biomeArt = image("biome-tiles");
  const stairsArt = new Image();
  stairsArt.src = "assets/stairs-down.svg";
  const landmarkSprites = { west: 0, center: 1, east: 4, north: 3, south: null };
  const keys = {
    w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3,
  };
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduceMotion = () => settings.reducedMotion || prefersReducedMotion.matches;
  let g, lastInput = -Infinity, started = 0, logLine, oldPos, oldEnemies, flipped = false;
  const NUMBER_DURATION = 900;
  let phase = "select", resumePhase = "ready", rollTimer, rollingFaces, defeatTimer, clockInterval, lastDrop, dropTurn, audio;
  let floaters = [], defeats = [], landmarks = new Map();
  let finalScore, newBest;
  let relicToastTimer, relicBonusAnnounced = false;
  let selectedMode = "timed";
  const ATTACK_BEAT = 210, REPLY_BEAT = 230;
  let replyTimer, combatUntil = 0;
  let debugBiome = "stone", fullMap = true;
  const revealing = () => g.mode === "debug" && fullMap;
  const hasStairs = () => g.depth < g.floorCount;

  function cue(notes, wave = "triangle", volume = .07) {
    if (!settings.sound || !window.AudioContext) return;
    try {
      audio ??= new AudioContext();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      for (const [frequency, offset, duration] of notes) {
        const osc = audio.createOscillator(), gain = audio.createGain();
        const at = audio.currentTime + offset;
        osc.type = wave;
        osc.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(.001, at);
        gain.gain.exponentialRampToValueAtTime(volume, at + .009);
        gain.gain.exponentialRampToValueAtTime(.001, at + duration);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + duration);
      }
    } catch {
      // Audio availability does not affect gameplay.
    }
  }

  function sprite(target, img, sx, sy, size, x, y, drawSize = size) {
    if (img.complete && img.naturalWidth) {
      target.drawImage(img, sx * size, sy * size, size, size, x, y, drawSize, drawSize);
    }
  }

  function rect(color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  const hash = (x, y) => ((Math.imul(x + 93, 872341) ^ Math.imul(y + 45, 2711917)) >>> 0) % 256;

  function placeLandmarks() {
    landmarks = new Map();
    const best = {};
    for (const cell of g.floor) {
      const x = cell % WIDTH, y = Math.floor(cell / WIDTH);
      const zone = zoneAt(x, y);
      if (!Object.hasOwn(landmarkSprites, zone) || y <= 1 || passable(g, x, y - 1)) continue;
      if (Math.abs(START.x - x) + Math.abs(START.y - y) < 7) continue;
      const room = passable(g, x - 1, y) && passable(g, x + 1, y);
      const score = (room ? 256 : 0) + hash(x + (g.seed & 65535), y + (g.seed >>> 16));
      if (!best[zone] || score > best[zone].score) best[zone] = { cell: key(x, y - 1), score };
    }
    for (const [zone, { cell }] of Object.entries(best)) landmarks.set(cell, zone);
  }

  function dressWall(zone, v, x, y) {
    if (g.biome === "overgrown" || zone === "west" && g.biome === "stone") {
      if (v % (g.biome === "overgrown" ? 3 : 5) === 0) return;
      for (const [i, stem] of [[0, 3 + v % 3], [1, 10 + v % 3]]) {
        const length = 4 + ((v >> i) % 7);
        rect("#243c22", x + stem, y, 2, length + 1);
        rect("#739b54", x + stem + 1, y + 1, 1, length);
        rect("#91ac60", x + stem - 1, y + length - 2, 2, 1);
      }
      if (v % 4 === 0) sprite(ctx, biomeArt, v % 8 ? 0 : 9, 0, T, x, y);
    } else if (g.biome === "flooded") {
      rect("#17565d50", x, y + 6, 16, 10);
      rect("#80bbc47c", x + 2, y + 11, 12, 1);
    } else if (g.biome === "sand") {
      rect("#8e643a72", x, y, 16, 16);
      if (v % 4 === 0) sprite(ctx, biomeArt, 7, 0, T, x, y);
    }
  }

  function terrain(tx, ty, x, y, visible) {
    const zone = zoneAt(tx, ty);
    const [base, light, dark] = palette[zone];
    const v = hash(tx, ty);
    if (passable(g, tx, ty)) {
      rect(v % 3 === 0 ? light : base, x, y, T, T);
      if (g.biome === "stone" && v % 3 === 0 && zone !== "west") {
        sprite(ctx, biomeArt, 6, 0, T, x, y);
        rect(`${base}66`, x, y, T, T);
      } else if (g.biome === "overgrown") {
        rect(v % 3 ? "#3b4d33" : "#415840", x, y, T, T);
        if (v % 4 === 0) sprite(ctx, biomeArt, v % 8 ? 1 : 8, 0, T, x, y);
      } else if (g.biome === "flooded") {
        rect("#405b5b", x, y, T, T);
        if ((tx + ty) % 4 !== 0 && zone !== "entry") {
          sprite(ctx, biomeArt, v % 3 ? 2 : 3, 0, T, x, y);
          rect("#173c4099", x, y, T, T);
        }
      } else if (g.biome === "sand") {
        rect("#8b7451", x, y, T, T);
        sprite(ctx, biomeArt, v % 4 ? 4 : 5, 0, T, x, y);
        rect("#5d452f3d", x, y, T, T);
      }
      rect(dark, x, y + 15, 16, 1);
      rect(dark, x + 15, y, 1, 16);
      rect("#ffffff16", x + 2, y + 2, 11, 1);
      rect("#00000035", x + v % 11 + 2, y + v % 7 + 4, 2, 1);
      if (v % 4 === 0) {
        rect("#00000032", x + 3, y + 9, 4, 1);
        rect("#00000024", x + 6, y + 10, 2, 1);
      }
      if (!passable(g, tx, ty - 1)) rect("#080e0f40", x, y, 16, 3);
      if (g.biome === "stone" || zone === "west" && g.biome === "overgrown") floorDetail(zone, v, x, y);
      const id = key(tx, ty), trap = g.traps.get(id), rune = g.runes.get(id);
      if (trap) {
        rect("#201d15", x + 1, y + 1, 14, 14);
        rect(trap.spent ? "#554738" : "#d48a49", x + 2, y + 2, 12, 12);
        rect("#5a4933", x + 3, y + 3, 10, 10);
        for (let i = 0; i < 3; i++) {
          const sx = x + 4 + i * 3;
          rect(trap.spent ? "#302b22" : "#ffac61", sx, y + 8, 2, 3);
          if (!trap.spent) rect("#ffe1a0", sx, y + 6, 1, 2);
        }
      } else if (rune) {
        rect("#202c39", x + 2, y + 2, 12, 12);
        rect("#284f6b", x + 3, y + 3, 10, 10);
        const ink = rune.used ? "#8fb9db" : "#adf2ff";
        rect(ink, x + 7, y + 4, 2, 8);
        rect(ink, x + 5, y + 6, 2, 2);
        rect(ink, x + 9, y + 8, 2, 2);
      }
      if (tx === g.exit.x && ty === g.exit.y && hasStairs()) {
        sprite(ctx, stairsArt, 0, 0, T, x, y);
      } else if (tx === g.exit.x && ty === g.exit.y) {
        sprite(ctx, dungeon, 9, 0, T, x, y);
        rect("#298373", x + 5, y + 4, 6, 10);
        rect("#54bca6", x + 4, y + 7, 8, 6);
        rect("#94ebc8", x + 7, y + 5, 2, 9);
        rect("#ecffe0", x + 7, y + 8, 2, 2);
        rect("#baf1d3", x + 3, y + 14, 10, 1);
        rect("#56ba9d66", x + 2, y + 15, 12, 1);
      }
    } else {
      const below = passable(g, tx, ty + 1);
      rect(dark, x, y, 16, 16);
      if (below) {
        sprite(ctx, dungeon, 4, 2, 16, x, y);
        rect(zone === "west" ? "#56805245" : zone === "east" ? "#99574444" : "#22262132", x, y, 16, 16);
        rect("#0b141684", x, y + 13, 16, 3);
        dressWall(zone, v, x, y);
        const mark = landmarks.get(key(tx, ty));
        if (mark) {
          rect("#151d17", x + 1, y + 2, 14, 12);
          rect("#00000055", x + 2, y + 13, 12, 1);
          if (mark === "south") sprite(ctx, dungeon, 3, 5, T, x, y);
          else sprite(ctx, wingArt, landmarkSprites[mark], 0, T, x, y);
          rect(`${ZONES[mark].color}55`, x + 3, y + 14, 10, 1);
        } else if ((v % 11 === 0 || (ty === 12 && (tx === 17 || tx === 19))) && visible) {
          sprite(ctx, dungeon, 5, 2, 16, x, y);
          rect("#f4b8745c", x + 3, y + 14, 10, 2);
        }
      } else {
        if (g.biome === "flooded" && DIRS.some(([dx, dy]) => passable(g, tx + dx, ty + dy))) {
          rect("#14333a", x, y, T, T);
          sprite(ctx, biomeArt, 3, 0, T, x, y);
          rect("#09232bbc", x, y, T, T);
          if (!visible) rect("#0d1413aa", x, y, T, T);
          return;
        }
        rect(v % 3 === 0 ? "#27332a" : "#202a24", x, y, 16, 16);
        rect("#0e1711", x, y + 7, 16, 1);
        rect("#101816", x, y + 15, 16, 1);
        rect("#ffffff11", x + 1, y + 1, 14, 1);
        rect("#ffffff0d", x + 1, y + 8, 14, 1);
        const seam = v % 6 + 3;
        rect("#0e1711", x + seam, y, 1, 7);
        rect("#101816", x + 16 - seam, y + 8, 1, 7);
      }
    }
    if (!visible) rect("#0d1413aa", x, y, 16, 16);
  }

  function floorDetail(zone, v, x, y) {
    const xx = x + 2 + v % 8, yy = y + 5 + v % 5;
    if (zone === "west") {
      rect("#6d855785", xx, yy, 5, 2);
      rect("#84905c63", xx + 2, yy - 2, 3, 2);
      rect("#283627", x + 2, y + 12, 6, 1);
      rect("#283627", x + 6, y + 10, 1, 2);
    } else if (zone === "east") {
      rect("#301e1e", x + 2, y + 10, 6, 2);
      rect("#301e1e", x + 7, y + 8, 6, 2);
      rect("#d46d4699", x + 4, y + 10, 3, 1);
      rect("#ffac5c8f", x + 8, y + 8, v % 4 + 1, 1);
    } else if (zone === "center") {
      rect("#a294735f", x + 2, y + 11, 3, 1);
      if (v % 3 === 0) {
        rect("#bcb0978f", xx, yy, 4, 3);
        rect("#4a4235", xx, yy + 1, 1, 1);
        rect("#4a4235", xx + 3, yy + 1, 1, 1);
      }
    } else if (zone === "north") {
      rect("#8cc6ba50", x + 3, y + 6, 9, 1);
      rect("#8cc6ba40", x + 7, y + 4, 1, 6);
      rect("#1e3937", x + 2, y + 12, 11, 1);
    } else if (zone === "south") {
      for (let i = 2; i < 14; i += 4) rect("#957c635e", x + i, y + 5, 1, 8);
      rect("#342a23", x + 1, y + 8, 14, 1);
    }
  }

  function entity(sx, sy, px, py, flipped = false) {
    rect("#13191788", px + 2, py + 13, 12, 3);
    if (flipped) {
      ctx.save();
      ctx.translate(px + T, py);
      ctx.scale(-1, 1);
      sprite(ctx, dungeon, sx, sy, T, 0, 0);
      ctx.restore();
    } else {
      sprite(ctx, dungeon, sx, sy, T, px, py);
    }
  }

  function litWall(x, y) {
    if (passable(g, x, y)) return false;
    return DIRS.some(([dx, dy]) =>
      passable(g, x + dx, y + dy) && (revealing() || g.visible.has(key(x + dx, y + dy))));
  }

  function chest(x, y) {
    rect("#d9a66124", x + 3, y + 5, 10, 9);
    sprite(ctx, dungeon, ...LOOT.gold.sprite, T, x, y);
    rect("#ffe1a0", x + 13, y + 3, 1, 1);
  }

  function drawHourglass(x, y) {
    rect("#86e3e326", x + 2, y + 1, 12, 14);
    rect("#193533", x + 4, y + 1, 8, 14);
    for (const row of [2, 12]) rect("#9cb790", x + 3, y + row, 10, 2);
    for (const [row, inset] of [[4, 0], [5, 1], [6, 2], [7, 2], [8, 2], [9, 1], [10, 0], [11, 0]]) {
      rect("#a9f4eb", x + 5 + inset, y + row, 6 - 2 * inset, 1);
    }
    rect("#f3be5d", x + 6, y + 5, 4, 1);
    rect("#f3be5d", x + 7, y + 6, 2, 1);
    rect("#f3be5d", x + 6, y + 11, 4, 1);
  }

  function render() {
    const now = performance.now();
    const age = now - started;
    const still = reduceMotion();
    const t = still ? 1 : Math.min(1, age / 115);
    const ease = t * (2 - t);
    const p = g.player;
    const lerp = (a, b) => a + (b - a) * ease;
    const px = Math.round((world.width - T) / 2), py = Math.round((world.height - T) / 2);
    const cx = Math.round(lerp(oldPos.x, p.x) * T) - px;
    const cy = Math.round(lerp(oldPos.y, p.y) * T) - py;
    const left = Math.floor(cx / T), top = Math.floor(cy / T);
    rect("#0d1511", 0, 0, world.width, world.height);
    for (let ty = top; ty < Math.ceil((cy + world.height) / T); ty++) {
      for (let tx = left; tx < Math.ceil((cx + world.width) / T); tx++) {
        const x = tx * T - cx, y = ty * T - cy;
        const valid = tx >= 0 && tx < WIDTH && ty >= 0 && ty < HEIGHT;
        if (valid && (g.seen.has(key(tx, ty)) || revealing() && passable(g, tx, ty))) {
          terrain(tx, ty, x, y, revealing() || g.visible.has(key(tx, ty)));
        } else if (valid && litWall(tx, ty)) {
          terrain(tx, ty, x, y, revealing());
        } else if (hash(tx, ty) % 4 === 0) {
          rect("#223128", x + 5, y + 6, 1, 1);
        }
      }
    }
    const light = ctx.createRadialGradient(px + 8, py + 8, 3, px + 8, py + 8, 118);
    light.addColorStop(0, "#ffc98130");
    light.addColorStop(.4, "#c1915316");
    light.addColorStop(1, "#09150e48");
    rect(light, 0, 0, world.width, world.height);
    for (const e of g.enemies) {
      if (!e.aim || (!revealing() && !g.visible.has(key(e.x, e.y)))) continue;
      for (let i = 1; i <= 4; i++) {
        const x = e.x + e.aim.dx * i, y = e.y + e.aim.dy * i;
        if ((!revealing() && !g.visible.has(key(x, y))) || !passable(g, x, y)) break;
        const left = x * T - cx, top = y * T - cy;
        rect("#b26eab66", left, top, T, T);
        rect("#331b3cbb", left + 7 - Math.abs(e.aim.dx) * 7, top + 7 - Math.abs(e.aim.dy) * 7,
          3 + Math.abs(e.aim.dx) * 13, 3 + Math.abs(e.aim.dy) * 13);
        rect("#f3b6f2", left + 8 - Math.abs(e.aim.dx) * 8, top + 8 - Math.abs(e.aim.dy) * 8,
          1 + Math.abs(e.aim.dx) * 15, 1 + Math.abs(e.aim.dy) * 15);
      }
    }
    for (const item of g.loot) {
      if (!revealing() && !g.visible.has(key(item.x, item.y))) continue;
      const x = item.x * T - cx, y = item.y * T - cy;
      if (item.type === "gold") chest(x, y);
      else if (item.type === "hourglass") drawHourglass(x, y);
      else {
        rect("#d9a66124", x + 3, y + 5, 10, 9);
        sprite(ctx, dungeon, ...LOOT[item.type].sprite, T, x, y);
        rect("#ffe1a0", x + 13, y + 3, 1, 1);
      }
    }
    for (const e of g.enemies) {
      if (!revealing() && !g.visible.has(key(e.x, e.y))) continue;
      const from = oldEnemies.get(e) || e;
      const x = Math.round(lerp(from.x, e.x) * T) - cx;
      const y = Math.round(lerp(from.y, e.y) * T) - cy;
      const type = ENEMIES[e.type];
      if (e.disguised) {
        chest(x, y);
        if (revealing()) rect("#f4a887", x + 12, y + 1, 2, 2);
        continue;
      }
      if (e.windup) {
        rect("#e6934d99", x + 1, y + 1, 14, 14);
        rect("#33231e", x + 2, y + 2, 12, 12);
        if (e.type === "warden") {
          const facingRight = e.x < p.x;
          entity(...type.sprite, x + (facingRight ? 1 : -1), y - 2, e.x > p.x);
          sprite(ctx, dungeon, 10, 9, T, x + (facingRight ? 6 : -6), y - 8);
        } else {
          entity(...type.sprite, x, y - 2, e.x > p.x);
          rect("#ff9d7b", x + 5, y + 13, 6, 1);
        }
      } else {
        entity(...type.sprite, x, y, e.x > p.x);
      }
      if (distance(e, p) <= 3 || e.hp < type.hp) {
        const above = e.windup ? 6 : 4;
        rect("#100c0c", x + 1, y - above, 14, 3);
        rect("#602f2d", x + 2, y - above + 1, 12, 1);
        rect(e.windup ? "#ffcb87" : "#df8a68", x + 2, y - above + 1, Math.ceil(12 * e.hp / type.hp), 1);
      }
      if (e.aim || e.windup) {
        const tint = e.aim ? "#f3b3ef" : "#ffae77";
        rect("#1d1616", x + 11, y - 6, 5, 8);
        rect(tint, x + 13, y - 5, 1, 4);
        rect(tint, x + 13, y, 1, 1);
      }
    }
    defeats = defeats.filter(fx => now - fx.born < 340);
    if (!still) {
      const scraps = [[-1, -1], [1, -1], [-2, 0], [2, 0], [0, -2], [1, 1], [-1, 1]];
      for (const fx of defeats) {
        const age = (now - fx.born) / 340;
        const x = fx.x * T - cx + 8, y = fx.y * T - cy + 8;
        ctx.globalAlpha = 1 - age;
        for (const [dx, dy] of scraps) {
          rect(fx.enemy === "shade" ? "#e8b8ec" : fx.enemy === "slime" ? "#bfd88b" : "#ebbe91",
            Math.round(x + dx * (2 + 6 * age)), Math.round(y + dy * (2 + 5 * age) - 5 * age), 2, 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    rect("#e8c47742", px + 1, py + 13, 14, 3);
    const avatar = AVATARS[settings.avatar];
    ctx.save();
    if (avatar.filter) ctx.filter = avatar.filter;
    entity(...avatar.sprite, px, py - (t < 1 ? Math.round(Math.sin(t * Math.PI) * 2) : 0), flipped);
    ctx.restore();
    if (phase === "playing" && g.status === "playing" && lowHealth(p)) {
      rect("#100c0c", px - 2, py - 7, 20, 5);
      rect("#602f2d", px - 1, py - 6, 18, 3);
      rect("#ff8c83", px - 1, py - 6, Math.ceil(18 * p.hp / p.maxHP), 3);
    }
    rect("#e5c981", px + 6, py + 15, 4, 1);
    if (!still && age < 240) {
      ctx.globalAlpha = 1 - age / 240;
      for (const fx of g.effects) {
        const x = fx.x * T - cx, y = fx.y * T - cy;
        if (fx.kind === "strike") {
          for (let i = 0; i < 6; i++) rect("#f4db9f", x + 5 + i, y + 11 - i, 3, 1);
        } else if (fx.kind === "counter") {
          rect("#ffb27b", x + 6, y + 6, 4, 2);
          rect("#f3d69d", x + 7, y + 4, 2, 6);
        } else if (fx.kind === "hurt") {
          rect("#d952497e", px - 1, py - 1, 18, 18);
        } else if (fx.kind === "bolt") {
          const tx = fx.toX * T - cx, ty = fx.toY * T - cy;
          rect("#f4bdfa", Math.min(x, tx) + 7, Math.min(y, ty) + 7, Math.abs(tx - x) + 2, Math.abs(ty - y) + 2);
        } else if (fx.kind === "pickup") {
          const rise = Math.floor(age / 44);
          rect("#a9edb4", x + 7, y + 4 - rise, 3, 1);
          rect("#a9edb4", x + 8, y + 3 - rise, 1, 3);
        } else if (fx.kind === "rune") {
          rect("#b4f0ff", x + 6, y + 5, 4, 1);
          rect("#b4f0ff", x + 7, y + 3, 2, 5);
        }
      }
      ctx.globalAlpha = 1;
    }
    drawNumbers(now, cx, cy);
    if ((!still && (age < 240 || defeats.length)) || floaters.length) frame = requestAnimationFrame(render);
    else frame = 0;
  }

  let frame = 0;
  function queueRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function pruneNumbers(now) {
    floaters = floaters.filter(n => {
      if (now - n.born < NUMBER_DURATION) return true;
      n.el.remove();
      return false;
    });
  }

  function queueNumbers(now) {
    pruneNumbers(now);
    for (const effect of g.effects) {
      if (effect.kind !== "number") continue;
      const nearby = floaters.filter(n => Math.abs(n.x - effect.x) <= 1 && Math.abs(n.y - effect.y) <= 1);
      let lane = [0, 1, 2].find(id => nearby.every(n => n.lane !== id));
      if (lane === undefined) {
        lane = nearby[0].lane;
        nearby[0].el.remove();
        floaters = floaters.filter(n => n !== nearby[0]);
      }
      const el = document.createElement("span");
      el.className = `float-number ${effect.tone}`;
      el.textContent = `${effect.amount > 0 ? "+" : ""}${effect.amount} ${effect.unit}`;
      el.hidden = true;
      get("floating-text").append(el);
      floaters.push({ ...effect, born: now, lane, el });
    }
  }

  function drawNumbers(now, cx, cy) {
    pruneNumbers(now);
    if (!floaters.length) return;
    const still = reduceMotion();
    for (const n of floaters) {
      const age = now - n.born;
      const x = (n.x * T - cx + T / 2) / world.width * 100;
      const barGap = lowHealth(g.player) && n.x === g.player.x && n.y === g.player.y ? 8 : 0;
      const y = (n.y * T - cy - 1 - barGap) / world.height * 100;
      const lift = n.lane * 25 + (still ? 0 : Math.floor(age / 34));
      n.el.style.left = `clamp(34px, ${x}%, calc(100% - 34px))`;
      n.el.style.top = `max(31px, calc(${y}% - ${lift}px))`;
      n.el.style.opacity = still ? 1 : Math.min(1, (NUMBER_DURATION - age) / 210);
      n.el.hidden = x < 0 || x > 100 || y < 0 || y > 100;
    }
  }

  function resizeWorld() {
    const { width, height } = world.getBoundingClientRect();
    if (!height || !width) return;
    const logicalWidth = Math.max(T, Math.round(width / height * world.height));
    if (logicalWidth !== world.width) {
      world.width = logicalWidth;
      ctx.imageSmoothingEnabled = false;
    }
    queueRender();
  }

  function drawMap() {
    m.clearRect(0, 0, map.width, map.height);
    m.fillStyle = "#1b241e";
    for (let y = 1; y < map.height; y += 8) {
      for (let x = 1; x < map.width; x += 8) m.fillRect(x, y, 1, 1);
    }
    let surveyed = 0;
    for (const cell of g.floor) {
      if (!revealing() && !g.seen.has(cell)) continue;
      surveyed++;
      const x = cell % WIDTH, y = Math.floor(cell / WIDTH);
      m.fillStyle = g.visible.has(cell) ? "#8d9e7b" : "#566352";
      m.fillRect(x * 4, y * 4, 4, 4);
    }
    for (const [id, trap] of g.traps) {
      if (!revealing() && !g.seen.has(id)) continue;
      m.fillStyle = trap.spent ? "#876b4a" : "#f0a255";
      m.fillRect(trap.x * 4 + 1, trap.y * 4 + 1, 2, 2);
    }
    for (const [id, rune] of g.runes) {
      if (!revealing() && !g.seen.has(id)) continue;
      const x = rune.x * 4, y = rune.y * 4;
      m.fillStyle = "#406680";
      m.fillRect(x, y, 4, 4);
      m.fillStyle = "#a7eaff";
      m.fillRect(x + 1, y + 1, 2, 2);
    }
    if (revealing()) {
      m.fillStyle = "#e8ad6a";
      for (const item of g.loot) m.fillRect(item.x * 4 + 1, item.y * 4 + 1, 2, 2);
      m.fillStyle = "#f08885";
      for (const enemy of g.enemies) m.fillRect(enemy.x * 4 + 1, enemy.y * 4 + 1, 2, 2);
    }
    if (revealing() || g.seen.has(key(g.exit.x, g.exit.y))) {
      const { x, y } = g.exit;
      m.fillStyle = hasStairs() ? "#e5bd81" : "#7dd6ca";
      m.fillRect(x * 4 - 1, y * 4 - 1, 6, 6);
      if (hasStairs()) sprite(m, stairsArt, 0, 0, T, x * 4 - 2, y * 4 - 2, 8);
      else sprite(m, minimap, 4, 3, 8, x * 4 - 2, y * 4 - 2, 8);
    }
    const x = g.player.x * 4, y = g.player.y * 4;
    m.fillStyle = "#382e1c";
    m.fillRect(x - 2, y - 2, 8, 8);
    m.fillStyle = "#f1d796";
    m.fillRect(x - 1, y - 1, 6, 6);
    sprite(m, minimap, 1, 3, 8, x - 2, y - 2, 8);
    m.fillStyle = "#f1d796";
    m.fillRect(x + 1, y + 1, 2, 2);
    get("survey").textContent = phase === "playing" ? `${Math.round(100 * surveyed / g.floor.size)}%` : "—";
    get("debug-map-legend").hidden = !revealing();
  }

  function drawDebrief() {
    const chart = get("debrief-map");
    const plot = chart.getContext("2d");
    const scale = 6;
    const square = (color, x, y, w, h) => {
      plot.fillStyle = color;
      plot.fillRect(x, y, w, h);
    };
    square("#101913", 0, 0, chart.width, chart.height);
    for (const cell of g.floor) {
      const x = cell % WIDTH, y = Math.floor(cell / WIDTH);
      square(g.seen.has(cell) ? "#778064" : "#34483d", x * scale, y * scale, scale, scale);
    }
    const pin = ({ x, y }, color, inside) => {
      const px = x * scale, py = y * scale;
      square("#080f0c", px - 2, py - 2, 10, 10);
      square(color, px - 1, py - 1, 8, 8);
      square(inside, px + 1, py + 1, 4, 4);
    };
    pin(START, "#c4b4e4", "#101913");
    if (g.player.x === START.x && g.player.y === START.y) {
      square("#f1d796", START.x * scale + 1, START.y * scale + 1, 4, 4);
    } else {
      pin(g.player, "#f1d796", "#b08848");
    }
    if (hasStairs()) {
      pin(g.exit, "#e5bd81", "#795a3c");
      plot.imageSmoothingEnabled = false;
      sprite(plot, stairsArt, 0, 0, T, g.exit.x * scale - 2, g.exit.y * scale - 2, 10);
    }
    else pin(g.exit, "#89f1d9", "#256a5b");
    const ns = g.exit.y < START.y - 2 ? "north" : g.exit.y > START.y + 2 ? "south" : "";
    const ew = g.exit.x < START.x - 2 ? "west" : g.exit.x > START.x + 2 ? "east" : "";
    const label = `The ${hasStairs() ? "stairs were" : "exit was"} ${ns}${ew} of your starting point.`;
    get("gate-location").textContent = label;
    chart.setAttribute("aria-label", `Full dungeon map. ${label}`);
  }

  function paintClock() {
    const seconds = g.secondsLeft;
    const timer = get("timer");
    const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (text !== timer.textContent) {
      timer.textContent = text;
      get("clock-fill").style.width = `${Math.min(1, seconds / TIME_LIMIT) * 100}%`;
    }
    const clock = get("clock");
    const active = phase === "playing" && g.status === "playing";
    clock.hidden = !active || g.mode !== "timed";
    const badge = get("practice-badge");
    badge.hidden = !active || g.mode === "timed";
    badge.textContent = g.mode === "debug" ? "Debug · Untimed · Invulnerable" : "Practice · Untimed";
    clock.classList.toggle("urgent", seconds <= 10);
  }

  function paintGuide() {
    const guide = get("gate-guide");
    guide.hidden = phase !== "playing" || g.status !== "playing" || !g.runes.has(key(g.player.x, g.player.y));
    if (guide.hidden) return;
    const { x, y, name } = gateBearing(g.player, g.exit);
    get("gate-guide-arrow").style.transform = `rotate(${Math.atan2(x, -y) * 180 / Math.PI}deg)`;
    const label = `${hasStairs() ? "Stairs" : "Gate"} direction: ${name}`;
    if (guide.getAttribute("aria-label") !== label) guide.setAttribute("aria-label", label);
  }

  function syncClock(now) {
    const previous = g.secondsLeft;
    const expired = tickClock(g, now);
    paintClock();
    if (expired) {
      cue([[185, 0, .18], [110, .16, .38]]);
      update();
    } else if (g.secondsLeft <= 10 && g.secondsLeft < previous) {
      cue([[g.secondsLeft <= 3 ? 840 : 660, 0, .09]], "triangle", .065);
    }
    return expired;
  }

  function openPause(destination = "pause-menu") {
    if (phase !== "playing" || g.status !== "playing") return;
    if (g.pausedAt === null) {
      const now = performance.now();
      if (syncClock(now) || !pauseGame(g, now)) return;
      clearInterval(clockInterval);
      clearTimeout(replyTimer);
    }
    const target = get(destination);
    if (!target.open) target.showModal();
  }

  function keepPlaying() {
    if (!resumeGame(g, performance.now())) return;
    get("pause-menu").close();
    if (g.mode === "timed") clockInterval = setInterval(() => syncClock(performance.now()), 100);
    if (g.replyPending) scheduleReply();
    get("world").focus({ preventScroll: true });
    update();
  }

  function paintRelicGoal() {
    const goal = get("relic-goal"), toast = get("relic-toast");
    const active = phase === "playing" && g.status === "playing" && g.mode === "timed";
    goal.hidden = !active;
    if (!active) {
      clearTimeout(relicToastTimer);
      toast.hidden = true;
      return;
    }
    const count = g.floorRelics;
    const ready = count === 2;
    goal.classList.toggle("ready", ready);
    get("relic-goal-status").textContent = ready ? "Finish the expedition to claim it" : count === 1 ? "Find one more on this floor" : "Find both on this floor";
    if (ready && !relicBonusAnnounced) {
      relicBonusAnnounced = true;
      toast.hidden = false;
      relicToastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
    }
  }

  function update() {
    const p = g.player;
    const beat = get("combat-beat");
    beat.hidden = !g.replyPending || g.status !== "playing";
    beat.textContent = "Enemy response next";
    const hasRolls = phase === "rolled" || phase === "playing";
    const zone = ZONES[zoneAt(p.x, p.y)];
    get("biome-name").textContent = BIOMES[g.biome].name;
    get("biome-name").style.color = BIOMES[g.biome].color;
    get("debug-pause").hidden = g.mode !== "debug";
    get("debug-enable").hidden = g.mode === "debug";
    get("zone").style.color = zone.color;
    get("zone").lastElementChild.textContent = zone.name;
    get("turn").textContent = String(g.turn).padStart(3, "0");
    get("depth-label").hidden = g.floorCount === 1;
    get("depth-label").textContent = `Floor ${g.depth}/${g.floorCount} ·`;
    get("map-goal").textContent = hasStairs() ? "Stairs" : "Exit";
    get("map-goal").previousElementSibling.classList.toggle("stairs-pin", hasStairs());
    get("debrief-goal").textContent = hasStairs() ? "Stairs" : "Exit";
    get("debrief-goal").previousElementSibling.classList.toggle("stairs-pin", hasStairs());
    get("pause-open").hidden = phase !== "playing" || g.status !== "playing";
    get("touch-controls").hidden = get("pause-open").hidden;
    paintClock();
    paintGuide();
    get("hp").textContent = hasRolls ? `${p.hp} / ${p.maxHP}` : "—";
    Array.from(get("health").children).forEach((pip, i) => pip.classList.toggle("full", hasRolls && i < p.hp));
    get("attack").textContent = hasRolls ? p.attack : "—";
    get("gold").textContent = hasRolls ? p.gold : "—";
    get("relics").textContent = `${g.floorRelics} / 2`;
    paintRelicGoal();
    if (phase === "playing" && logLine !== g.log[0]) {
      const log = get("log");
      log.replaceChildren(...g.log.map(entry => {
        const line = document.createElement("p");
        line.className = entry.kind;
        line.textContent = entry.text;
        return line;
      }));
      log.scrollTop = 0;
      logLine = g.log[0];
    }
    const drop = get("drop-roll");
    if (g.lastRoll && g.lastRoll !== lastDrop) {
      lastDrop = g.lastRoll;
      dropTurn = g.turn;
      const { roll, modifier, amount } = lastDrop;
      drop.textContent = `Loot roll: ${roll}${modifier ? ` + ${modifier}` : ""} → ${amount} gold`;
      drop.classList.remove("reveal");
      void drop.offsetWidth;
      drop.classList.add("reveal");
    }
    drop.hidden = !lastDrop || g.turn - dropTurn >= 4 || g.status !== "playing";
    const unranked = g.mode !== "timed";
    const finished = g.status !== "playing" && g.status !== "stairs";
    if (g.status === "stairs" && get("floor-clear").hidden) {
      clearInterval(clockInterval);
      get("floor-clear-kicker").textContent = `Floor ${g.depth}/${g.floorCount} cleared`;
      get("floor-clear-next").textContent = `Next: ${BIOMES[FLOOR_ORDER[g.depth]].name}`;
      get("floor-clear-stats").textContent = `${p.hp}/${p.maxHP} HP · ${p.gold} gold · ${p.relics} relics carried`;
      get("floor-clear").hidden = false;
      get("hud").hidden = true;
      get("next-floor").focus({ preventScroll: true });
    }
    if (finished && !finalScore) {
      const best = profile.best()[0];
      finalScore = unranked ? summarizeRun(g, settings.avatar) : profile.record(g, settings.avatar);
      newBest = !unranked && (!best || finalScore.score > best.score);
      paintBest();
      paintWallet();
    }
    if (finished && !defeatTimer && get("result").hidden) {
      clearInterval(clockInterval);
      document.querySelector("dialog[open]")?.close();
      const escaped = g.status === "won";
      const expired = g.status === "expired";
      get("result-kicker").textContent = expired ? "Time expired" : escaped ? "Expedition complete" : "Expedition lost";
      get("result-title").textContent = expired ? "Out of time." : escaped ? "You found the gate." : "You died.";
      get("result-flavor").hidden = g.status !== "lost";
      get("result-score").textContent = unranked ? `${g.mode === "debug" ? "Debug" : "Practice"} run · Unranked` : `${finalScore.score.toLocaleString()} pts${newBest ? " · New high score!" : ""}`;
      get("relic-bonus").hidden = !finalScore.relicBonus;
      get("relic-bonus").textContent = `Relic pairs recovered · +${finalScore.relicBonus} pts`;
      get("result-copy").textContent = `${g.cleared}/${g.floorCount} floors cleared · ${finalScore.gold} gold found · ${p.relics}/${2 * g.floorCount} relics · ${p.kills} defeated${escaped && !unranked ? ` · ${g.secondsLeft}s left` : ""}`;
      get("bank-reward").hidden = unranked || !escaped || !finalScore.gold;
      get("bank-reward").textContent = `+${finalScore.gold} gold banked · ${profile.bank.toLocaleString()} total`;
      get("debrief").hidden = escaped;
      if (!escaped) drawDebrief();
      get("hud").hidden = true;
      get("result").hidden = false;
      get("shop-open").hidden = false;
      get("replay").focus({ preventScroll: true });
    }
    drawMap();
    queueRender();
  }

  function scheduleReply() {
    clearTimeout(replyTimer);
    replyTimer = setTimeout(() => {
      const now = performance.now();
      if (g.pausedAt !== null || (g.mode === "timed" && syncClock(now))) return;
      oldPos = { ...g.player };
      oldEnemies = new Map(g.enemies.map(e => [e, { x: e.x, y: e.y }]));
      if (!resolveReply(g)) return;
      const hit = g.effects.some(e => e.kind === "hurt");
      started = now;
      combatUntil = now + (hit ? REPLY_BEAT : 65);
      queueNumbers(now);
      if (g.status === "lost") showDefeat();
      else if (hit) cue([[102, 0, .15]], "sawtooth");
      update();
    }, ATTACK_BEAT);
  }

  function showDefeat() {
    cue([[185, 0, .18], [110, .16, .38]]);
    clearInterval(clockInterval);
    defeatTimer = setTimeout(() => { defeatTimer = null; update(); }, 650);
  }

  function input(action, repeat = false) {
    const now = performance.now();
    if (phase !== "playing" || g.status !== "playing" || g.pausedAt !== null || (g.mode === "timed" && syncClock(now)) ||
        g.replyPending || now < combatUntil || now - lastInput < 105) return;
    if (repeat && enemyAhead(g, action)) return;
    lastInput = now;
    oldPos = { ...g.player };
    oldEnemies = new Map(g.enemies.map(e => [e, { x: e.x, y: e.y }]));
    if (action === 1 || action === 3) flipped = action === 3;
    const moved = act(g, action, { stageCombat: true });
    started = moved ? now : now - 240;
    const touchedRune = moved && g.effects.some(e => e.kind === "rune");
    if (moved) {
      queueNumbers(now);
      if (!reduceMotion()) defeats.push(...g.effects.filter(e => e.kind === "defeat").map(e => ({ ...e, born: now })));
    }
    if (g.status === "won") cue([[392, 0, .15], [523, .12, .18], [659, .25, .28]]);
    else if (g.status === "stairs") cue([[392, 0, .13], [523, .12, .22]]);
    else if (g.status === "lost") showDefeat();
    else if (g.lastRoll && g.lastRoll !== lastDrop) cue([[587, 0, .09], [784, .07, .14]]);
    else if (g.effects.some(e => e.kind === "mimic")) cue([[196, 0, .1], [98, .09, .13]], "square");
    else if (g.effects.some(e => e.kind === "hurt")) cue([[102, 0, .15]], "sawtooth");
    else if (g.effects.some(e => e.kind === "strike")) cue([[155, 0, .09]], "square");
    else if (touchedRune) cue([[523, 0, .09], [698, .09, .14]]);
    else if (g.effects.some(e => e.kind === "pickup" && e.type === "hourglass")) cue([[524, 0, .09], [659, .08, .11], [880, .17, .18]]);
    else if (g.effects.some(e => e.kind === "pickup")) cue([[440, 0, .08], [659, .06, .14]]);
    else if (g.player.x !== oldPos.x || g.player.y !== oldPos.y) cue([[g.turn % 2 ? 83 : 72, 0, .05]], "triangle", .022);
    if (g.replyPending) scheduleReply();
    else if (g.effects.some(e => e.kind === "counter" || e.kind === "bolt")) combatUntil = now + REPLY_BEAT;
    update();
  }

  function loadExpedition(seed) {
    loadFloor(createExpedition(seed, selectedMode, selectedMode === "debug" ? debugBiome : undefined));
  }

  function loadFloor(floor) {
    clearTimeout(replyTimer);
    combatUntil = 0;
    g = floor;
    placeLandmarks();
    oldPos = { ...g.player };
    oldEnemies = new Map();
    flipped = false;
    started = -Infinity;
    lastInput = -Infinity;
    lastDrop = null;
    logLine = null;
    finalScore = null;
    newBest = false;
    clearTimeout(relicToastTimer);
    relicBonusAnnounced = false;
    floaters = [];
    defeats = [];
    get("floating-text").replaceChildren();
    get("floor-clear").hidden = true;
  }

  const diceCells = [...get("dice-grid").children];
  const diceSprites = diceCells.flatMap((cell, i) => {
    const row = document.createElement("div");
    row.className = "die-row";
    row.setAttribute("aria-hidden", "true");
    const dice = Array.from({ length: i === diceCells.length - 1 ? 2 : 1 }, () => {
      const face = document.createElement("i");
      face.className = "die";
      row.append(face);
      return face;
    });
    cell.insertBefore(row, cell.querySelector("strong"));
    return dice;
  });
  function setFaces(faces) {
    diceSprites.forEach((face, i) => { face.style.backgroundPositionX = `${-(faces[i] || 0) * 24}px`; });
  }
  function showDice(results, faces = []) {
    setFaces(faces);
    diceCells.forEach((cell, i) => {
      cell.querySelector("strong").textContent = results[i][0];
      cell.querySelector("small").textContent = results[i][1];
    });
  }

  function paintStartStep(focus = false) {
    const choosing = phase === "select";
    get("choose-explorer").hidden = !choosing;
    get("roll-step").hidden = choosing;
    if (focus) {
      const id = choosing ? "confirm-avatar" : phase === "rolled" ? "descend" : "roll";
      get(id).focus({ preventScroll: true });
    }
  }

  function paintMode() {
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === selectedMode));
    }
    const note = get("mode-note");
    note.textContent = selectedMode === "debug" ? "Choose a theme. Explore without a timer or damage."
      : selectedMode === "practice" ? "Explore without a clock. No ranked score or banked gold."
        : "Four floors. 60 seconds each. Find the stairs, then escape through the final gate.";
    get("debug-start").hidden = selectedMode !== "debug";
  }

  function prep(focus = false) {
    clearTimeout(rollTimer);
    clearInterval(rollingFaces);
    clearTimeout(defeatTimer);
    defeatTimer = null;
    clearInterval(clockInterval);
    get("pause-menu").close();
    phase = "select";
    resumePhase = "ready";
    loadExpedition(0);
    showDice([["—", "10 + d6"], ["—", "d6"], ["—", "2d6"]]);
    get("dice-grid").classList.remove("rolling");
    get("dice-grid").removeAttribute("aria-busy");
    get("health").replaceChildren(...Array.from({ length: 12 }, () => document.createElement("i")));
    get("rolls").replaceChildren();
    get("rolls").parentElement.hidden = true;
    get("log").textContent = "Roll your explorer to begin.";
    get("roll").hidden = false;
    get("roll").disabled = false;
    get("roll").textContent = "Roll dice";
    get("change-avatar").disabled = false;
    get("reroll").hidden = true;
    get("descend").hidden = true;
    get("briefing").hidden = false;
    get("result").hidden = true;
    get("shop-open").hidden = true;
    get("debrief").hidden = true;
    get("hud").hidden = true;
    paintMode();
    paintStartStep(focus);
    update();
    if (focus) window.scrollTo(0, 0);
  }

  function rollExplorer() {
    if (phase === "ready") loadExpedition(crypto.getRandomValues(new Uint32Array(1))[0]);
    else if (phase === "rolled") {
      if (!rerollStats(g)) return;
    } else return;
    phase = "rolling";
    get("change-avatar").disabled = true;
    get("reroll").hidden = true;
    get("descend").hidden = true;
    get("roll").hidden = false;
    get("roll").disabled = true;
    get("roll").textContent = "Rolling…";
    get("dice-grid").classList.add("rolling");
    get("dice-grid").setAttribute("aria-busy", "true");
    showDice([["· ·", "10 + d6"], ["· ·", "d6"], ["· ·", "2d6"]]);
    if (!reduceMotion()) {
      const tumble = () => setFaces(diceSprites.map(() => 1 + Math.floor(Math.random() * 6)));
      tumble();
      rollingFaces = setInterval(tumble, 90);
    }
    cue([[150, 0, .055], [192, .09, .06], [225, .18, .08]], "square");
    rollTimer = setTimeout(showExplorer, reduceMotion() ? 0 : 410);
  }

  function showExplorer() {
    clearInterval(rollingFaces);
    phase = "rolled";
    get("dice-grid").classList.remove("rolling");
    get("dice-grid").removeAttribute("aria-busy");
    get("roll").hidden = true;
    get("change-avatar").disabled = false;
    get("reroll").hidden = false;
    get("descend").hidden = false;
    const { health, power, gold } = g.rolls;
    const results = [
      [g.player.maxHP, `10 + ${health}`],
      [g.player.attack, `rolled ${power}`],
      [g.player.gold, `${gold.join(" + ")}`],
    ];
    showDice(results, [health, power, ...gold]);
    get("health").replaceChildren(...Array.from({ length: g.player.maxHP }, () => document.createElement("i")));
    get("rolls").replaceChildren(...["Health", "Power", "Gold"].flatMap((label, i) => {
      const term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = `${results[i][1]} → ${results[i][0]}`;
      return [term, detail];
    }));
    get("rolls").parentElement.hidden = false;
    get("log").textContent = "Your dice are in. Descend when ready.";
    update();
    get("descend").focus({ preventScroll: true });
  }

  function descend() {
    if (phase !== "rolled") return;
    phase = "playing";
    get("briefing").hidden = true;
    beginFloor();
  }

  function beginFloor() {
    startClock(g, performance.now());
    if (g.mode === "timed") clockInterval = setInterval(() => syncClock(performance.now()), 100);
    get("hud").hidden = false;
    get("world").focus({ preventScroll: true });
    cue([[262, 0, .18], [392, .11, .22]]);
    update();
  }

  function atlasIcon([x, y], filter) {
    const icon = document.createElement("i");
    icon.className = "avatar-icon";
    icon.style.backgroundPosition = `${-32 * x}px ${-32 * y}px`;
    if (filter) icon.style.filter = filter;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }
  const avatarIcon = id => atlasIcon(AVATARS[id].sprite, AVATARS[id].filter);

  const avatarButtons = Object.entries(AVATARS).map(([id, { name }]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avatar = id;
    const label = document.createElement("span");
    label.textContent = name;
    button.append(avatarIcon(id), label);
    button.addEventListener("click", () => {
      if (phase !== "select" || !profile.owns("avatar", id)) return;
      settings = profile.update({ avatar: id });
      paintSettings();
      queueRender();
    });
    return button;
  });
  get("avatar-picker").replaceChildren(...avatarButtons);

  function paintSettings() {
    for (const button of avatarButtons) {
      button.hidden = !profile.owns("avatar", button.dataset.avatar);
      button.setAttribute("aria-pressed", String(button.dataset.avatar === settings.avatar));
    }
    get("confirm-avatar").textContent = `Continue as ${AVATARS[settings.avatar].name}`;
    get("change-avatar").textContent = `Change explorer · ${AVATARS[settings.avatar].name}`;
    get("dice-grid").dataset.diceStyle = settings.dice;
    const sound = get("sound"), motion = get("motion"), system = prefersReducedMotion.matches;
    sound.setAttribute("aria-pressed", String(settings.sound));
    sound.textContent = settings.sound ? "Sound: on" : "Sound: off";
    motion.setAttribute("aria-pressed", String(reduceMotion()));
    motion.textContent = system ? "Motion: reduced by system" : settings.reducedMotion ? "Reduced motion: on" : "Reduced motion: off";
    motion.disabled = system;
    get("game-screen").classList.toggle("motion-reduced", reduceMotion());
  }

  function paintBest() {
    const run = profile.best()[0], best = get("title-best");
    best.hidden = !run;
    if (run) best.textContent = `Best score · ${run.score.toLocaleString()}`;
  }

  const runTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
  function historyRow(run) {
    const row = document.createElement("li"), detail = document.createElement("div");
    const result = document.createElement("strong"), stats = document.createElement("small");
    const date = document.createElement("small"), score = document.createElement("span");
    result.className = `run-outcome ${run.outcome}`;
    result.textContent = `${OUTCOMES[run.outcome]} · ${AVATARS[run.avatar].name}`;
    stats.textContent = `${run.cleared}/${run.floorCount} floors · ${run.gold} gold · ${run.relics}/${2 * run.floorCount} relics${run.relicBonus ? " · Relic bonus" : ""}`;
    date.textContent = runTime.format(run.at);
    score.className = "run-score";
    score.textContent = run.score.toLocaleString();
    score.setAttribute("aria-label", `${run.score.toLocaleString()} points`);
    detail.append(result, stats, date);
    row.append(avatarIcon(run.avatar), detail, score);
    return row;
  }

  function showHistory() {
    const recent = profile.recent();
    get("history-empty").hidden = recent.length > 0;
    get("history-tables").hidden = recent.length === 0;
    get("high-scores").replaceChildren(...profile.best().map(historyRow));
    get("recent-runs").replaceChildren(...recent.map(historyRow));
    get("history-menu").showModal();
  }

  function paintWallet() {
    get("shop-balance").textContent = `${profile.bank.toLocaleString()}g`;
  }

  function shopCard(kind, id, entry) {
    const card = document.createElement("div"), name = document.createElement("strong");
    const action = document.createElement("button");
    card.className = "shop-card";
    action.type = "button";
    action.dataset.shopKey = `${kind}-${id}`;
    name.textContent = entry.name;
    if (kind === "avatar") {
      card.append(avatarIcon(id));
    } else {
      const preview = document.createElement("i");
      preview.className = "die shop-die";
      preview.setAttribute("aria-hidden", "true");
      card.dataset.diceStyle = id;
      card.append(preview);
    }
    const owned = profile.owns(kind, id), equipped = kind === "dice" && settings.dice === id;
    card.classList.toggle("owned", owned);
    card.classList.toggle("equipped", equipped);
    action.disabled = owned ? kind === "avatar" || equipped : profile.bank < entry.price;
    action.textContent = !owned ? `${action.disabled ? "Costs" : "Unlock"} ${entry.price}g` : kind === "avatar" ? "Unlocked" : equipped ? "Equipped" : "Equip";
    action.setAttribute("aria-label", `${action.textContent}: ${entry.name}`);
    action.addEventListener("click", () => {
      const notice = get("shop-notice");
      const buying = !profile.owns(kind, id);
      if (buying && profile.purchase(kind, id) !== "bought") return;
      if (kind === "dice") {
        settings = profile.update({ dice: id });
        notice.textContent = `${entry.name} ${buying ? "unlocked and equipped" : "equipped"}.`;
      } else if (buying) {
        notice.textContent = `${entry.name} unlocked. Choose it at the start of a run.`;
      }
      paintSettings();
      paintShop(action.dataset.shopKey);
    });
    card.append(name, action);
    return card;
  }

  function paintShop(focus = "") {
    paintWallet();
    get("shop-avatars").replaceChildren(...Object.entries(AVATARS)
      .filter(([, entry]) => entry.price).sort((a, b) => a[1].price - b[1].price)
      .map(([id, entry]) => shopCard("avatar", id, entry)));
    get("shop-dice").replaceChildren(...Object.entries(DICE_STYLES).sort((a, b) => (a[1].price || 0) - (b[1].price || 0))
      .map(([id, entry]) => shopCard("dice", id, entry)));
    if (focus) {
      const menu = get("shop-menu");
      (menu.querySelector(`[data-shop-key="${focus}"]:enabled`) || menu.querySelector('[data-shop-tab][aria-pressed="true"]')).focus();
    }
  }

  function menuSwitch(attribute) {
    const buttons = [...document.querySelectorAll(`[${attribute}]`)];
    const select = current => {
      for (const button of buttons) {
        const active = button === current;
        button.setAttribute("aria-pressed", String(active));
        get(button.getAttribute("aria-controls")).hidden = !active;
      }
    };
    for (const button of buttons) button.addEventListener("click", () => select(button));
    select(buttons[0]);
  }
  menuSwitch("data-shop-tab");
  menuSwitch("data-help-tab");

  function enemyCard([id, enemy]) {
    const entry = BESTIARY[id], card = document.createElement("article");
    card.className = "enemy-card";
    const head = document.createElement("div"), name = document.createElement("h4"), role = document.createElement("small");
    head.className = "enemy-heading";
    name.textContent = enemy.name;
    role.textContent = entry.behavior;
    const title = document.createElement("div");
    title.append(name, role);
    head.append(atlasIcon(enemy.sprite), title);
    const stats = document.createElement("div");
    stats.className = "enemy-stats";
    const damage = entry.min ? `${entry.min}–${enemy.damage}` : enemy.damage;
    for (const line of [`${enemy.hp} HP`, `${damage} damage`, entry.special].filter(Boolean)) {
      const badge = document.createElement("span");
      badge.textContent = line;
      stats.append(badge);
    }
    const tip = document.createElement("p");
    tip.textContent = entry.tip;
    card.append(head, stats, tip);
    return card;
  }
  get("bestiary").replaceChildren(...Object.entries(ENEMIES).map(enemyCard));

  function decorate() {
    if (!rpg.complete || !rpg.naturalWidth) return;
    const stamp = document.createElement("canvas");
    stamp.width = stamp.height = 16;
    const stampCtx = stamp.getContext("2d");
    sprite(stampCtx, rpg, 8, 7, 16, 0, 0);
    stamp.className = "brand-stamp";
    const sigil = document.querySelector(".sigil");
    sigil.replaceChildren(stamp);
  }

  for (const img of [dungeon, minimap, rpg, wingArt, biomeArt, stairsArt]) {
    img.addEventListener("load", () => {
      decorate();
      drawMap();
      queueRender();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]") &&
        phase === "playing" && g.status === "playing") {
      event.preventDefault();
      if (!event.repeat) openPause();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || document.querySelector("dialog[open]")) return;
    if (event.key === " " && event.target instanceof HTMLButtonElement) return;
    const k = event.key.toLowerCase();
    if (k === "f" && document.fullscreenEnabled) {
      event.preventDefault();
      if (!event.repeat) toggleFullscreen();
      return;
    }
    if (!Object.hasOwn(keys, k)) return;
    event.preventDefault();
    input(keys[k], event.repeat);
  });
  for (const button of document.querySelectorAll("[data-action]")) {
    const direction = Number(button.dataset.action);
    let holdDelay, holdRepeat, pointer;
    const release = () => {
      clearTimeout(holdDelay);
      clearInterval(holdRepeat);
      pointer = undefined;
    };
    button.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      pointer = event.pointerId;
      button.setPointerCapture(pointer);
      input(direction);
      holdDelay = setTimeout(() => {
        const step = () => {
          if (g.status !== "playing" || g.pausedAt !== null || enemyAhead(g, direction)) release();
          else input(direction, true);
        };
        holdRepeat = setInterval(step, 115);
        step();
      }, 260);
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(name, event => { if (pointer === event.pointerId) release(); });
    }
    button.addEventListener("contextmenu", event => event.preventDefault());
    button.addEventListener("click", event => {
      if (event.detail === 0 || event.pointerType === "mouse" && !event.sourceCapabilities?.firesTouchEvents) input(direction);
    });
  }
  get("restart").addEventListener("click", () => prep(true));
  get("replay").addEventListener("click", () => prep(true));
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => {
      if (phase !== "select" || button.dataset.mode === selectedMode) return;
      selectedMode = button.dataset.mode;
      resumePhase = "ready";
      prep();
      button.focus({ preventScroll: true });
    });
  }
  get("confirm-avatar").addEventListener("click", () => {
    if (phase !== "select") return;
    phase = resumePhase;
    paintStartStep(true);
  });
  get("change-avatar").addEventListener("click", () => {
    if (phase !== "ready" && phase !== "rolled") return;
    resumePhase = phase;
    phase = "select";
    paintStartStep(true);
  });
  get("roll").addEventListener("click", rollExplorer);
  get("reroll").addEventListener("click", rollExplorer);
  get("descend").addEventListener("click", descend);
  get("next-floor").addEventListener("click", () => {
    const next = nextFloor(g);
    if (!next) return;
    loadFloor(next);
    beginFloor();
  });
  get("pause-open").addEventListener("click", () => openPause());
  get("touch-pause").addEventListener("click", () => openPause());
  for (const id of ["debug-biome", "debug-live-biome"]) {
    const picker = get(id);
    for (const [value, { name }] of Object.entries(BIOMES)) picker.add(new Option(name, value));
    picker.value = debugBiome;
    picker.addEventListener("change", () => {
      if (g.mode !== "debug" || !Object.hasOwn(BIOMES, picker.value)) return;
      debugBiome = g.biome = picker.value;
      get("debug-biome").value = get("debug-live-biome").value = debugBiome;
      update();
    });
  }
  get("debug-fog").addEventListener("click", () => {
    if (g.mode !== "debug") return;
    fullMap = !fullMap;
    get("debug-fog").setAttribute("aria-pressed", String(fullMap));
    get("debug-fog").textContent = `Full map: ${fullMap ? "on" : "off"}`;
    update();
  });
  get("debug-enable").addEventListener("click", () => {
    if (!enableDebug(g)) return;
    debugBiome = g.biome;
    get("debug-biome").value = get("debug-live-biome").value = debugBiome;
    update();
    get("debug-live-biome").focus();
  });
  get("pause-resume").addEventListener("click", keepPlaying);
  get("pause-menu").addEventListener("cancel", event => {
    event.preventDefault();
    keepPlaying();
  });
  get("pause-help").addEventListener("click", () => openPause("help-menu"));
  get("pause-options").addEventListener("click", () => openPause("options-menu"));
  const openSupport = menu => {
    if (phase === "playing" && g.status === "playing") {
      openPause();
      if (g.pausedAt !== null) openPause(menu);
    } else get(menu).showModal();
  };
  get("options-open").addEventListener("click", () => openSupport("options-menu"));
  get("history-open").addEventListener("click", showHistory);
  get("help-open").addEventListener("click", () => openSupport("help-menu"));
  get("shop-open").addEventListener("click", () => {
    if (get("result").hidden) return;
    get("shop-notice").textContent = "";
    paintShop();
    get("shop-menu").showModal();
  });
  for (const menu of ["options-menu", "history-menu", "shop-menu", "help-menu"]) {
    get(menu).addEventListener("close", () => {
      if (phase === "playing" && g.status === "playing" && g.pausedAt === null) get("world").focus({ preventScroll: true });
    });
  }
  get("sound").addEventListener("click", () => {
    settings = profile.update({ sound: !settings.sound });
    paintSettings();
    if (settings.sound) cue([[440, 0, .13]]);
  });
  get("motion").addEventListener("click", () => {
    settings = profile.update({ reducedMotion: !settings.reducedMotion });
    paintSettings();
    queueRender();
  });
  prefersReducedMotion.addEventListener("change", () => {
    paintSettings();
    queueRender();
  });

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await get("game-screen").requestFullscreen();
    } catch {
      // Fullscreen may be unavailable in embedded browsers.
    }
  }
  get("fullscreen").hidden = !document.fullscreenEnabled;
  get("fullscreen").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    get("fullscreen").setAttribute("aria-pressed", String(active));
    get("fullscreen").textContent = active ? "Exit fullscreen" : "Fullscreen";
    if (!document.querySelector("dialog[open]") && phase === "playing" && g.status === "playing") get("world").focus({ preventScroll: true });
  });
  const viewportObserver = new ResizeObserver(resizeWorld);
  viewportObserver.observe(world);
  get("relic-goal-points").textContent = `+${RELIC_PAIR_BONUS} pts`;
  get("relic-toast-points").textContent = `Escape to claim +${RELIC_PAIR_BONUS} points`;
  paintSettings();
  paintBest();
  paintWallet();
  prep(true);
})();
