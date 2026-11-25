(function (root) {
  "use strict";

  const WIDTH = 37, HEIGHT = 29;
  const TIME_LIMIT = 60;
  const HOURGLASS_SECONDS = 10;
  const TRAP_DAMAGE = 2;
  const START = { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) };
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const BIOMES = {
    stone: { name: "Stone Keep", color: "#b1bbc4" },
    overgrown: { name: "Overgrown Ruins", color: "#acd691" },
    flooded: { name: "Flooded Crypt", color: "#9fe4e5" },
    sand: { name: "Buried Temple", color: "#e8c491" },
  };
  const FLOOR_ORDER = ["overgrown", "stone", "flooded", "sand"];
  const ZONES = {
    entry: { name: "The Threshold", color: "#9c927f" },
    south: { name: "Lower Halls", color: "#bcaa91" },
    west: { name: "Mosswood", color: "#a3bd83" },
    center: { name: "Bone Galleries", color: "#d5ac73" },
    east: { name: "Ember Vault", color: "#e88c78" },
    north: { name: "North Gallery", color: "#7dd6ca" },
  };
  const ENEMIES = {
    slime: { name: "Dungeon ooze", hp: 2, damage: 1, sprite: [0, 9] },
    skeleton: { name: "Skeleton", hp: 3, damage: 1, sprite: [0, 8] },
    spider: { name: "Giant spider", hp: 4, damage: 2, sprite: [2, 10] },
    beetle: { name: "Giant beetle", hp: 2, damage: 1, sprite: [0, 10] },
    shade: { name: "Specter", hp: 3, damage: 1, sprite: [1, 10] },
    warden: { name: "Ogre", hp: 5, damage: 3, sprite: [1, 9] },
    goblin: { name: "Goblin skirmisher", hp: 3, damage: 1, sprite: [3, 9] },
    mimic: { name: "Mimic", hp: 5, damage: 2, sprite: [8, 7] },
  };
  const SPECTER_BOLT = 2;
  const BESTIARY = {
    slime: { behavior: "Slow advance", tip: "Wait just out of reach and let it come to you." },
    skeleton: { behavior: "Melee guard", tip: "Let it approach, then strike before stepping into its reach." },
    spider: { behavior: "Alternating bites", min: 1, tip: "Its bite alternates between light and heavy damage. Avoid trading hits." },
    beetle: { behavior: "Fast pursuit", tip: "It moves every turn when it sees you nearby. Don't assume you can outrun it in a straight corridor." },
    shade: { behavior: "Ranged bolt", special: `${SPECTER_BOLT} HP bolt`, tip: "Purple tiles mark its shot. Step sideways or break line of sight." },
    warden: { behavior: "Heavy swing", tip: "When the ogre raises its weapon, back away for one turn. Attack after the swing." },
    goblin: { behavior: "Hit and retreat", tip: "It backs away after hitting if there's room. Fight it in a tight corridor." },
    mimic: { behavior: "Treasure disguise", tip: "A chest may open its jaws when bumped. Step back before the bite, or leave it behind." },
  };
  const LOOT = {
    gold: { name: "Old coins", sprite: [5, 7] },
    tonic: { name: "Healing tonic", sprite: [8, 9] },
    blade: { name: "Forged blade", sprite: [8, 8] },
    relic: { name: "Vault relic", sprite: [5, 8] },
    hourglass: { name: "Hourglass" },
  };

  const key = (x, y) => y * WIDTH + x;
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;

  function zoneAt(x, y) {
    if (x >= 17 && x <= 19 && y >= 13 && y <= 15) return "entry";
    if (y >= 24 && x >= 14 && x <= 22) return "south";
    if (y <= 5 && x >= 14 && x <= 22) return "north";
    if (x < 13) return "west";
    if (x > 23) return "east";
    return "center";
  }

  function shuffled(items, rng) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const edgeKey = (a, b) => key((a.x + b.x) / 2, (a.y + b.y) / 2);

  function routesFrom(start, blocked = new Set(), blockedEdges = new Set()) {
    const routes = new Map([[start, [start]]]);
    const queue = [start];
    for (const node of queue) {
      for (const next of node.links) {
        if (routes.has(next) || blocked.has(next) || (blockedEdges.size && blockedEdges.has(edgeKey(node, next)))) continue;
        routes.set(next, [...routes.get(node), next]);
        queue.push(next);
      }
    }
    return routes;
  }

  function chooseTraps(shortcuts, center, gate) {
    // Only trap extra links: the spanning tree stays open, including every vault.
    const traps = new Map();
    const noNodes = new Set();
    for (let i = 0; i < 2; i++) {
      const blocked = new Set(traps.keys());
      const route = routesFrom(center, noNodes, blocked).get(gate);
      const main = new Set(route.slice(1).map((node, j) => edgeKey(route[j], node)));
      let best;
      for (const [a, b] of shortcuts) {
        const id = edgeKey(a, b);
        if (blocked.has(id)) continue;
        const avoid = new Set([...blocked, id]);
        const safeRoute = routesFrom(center, noNodes, avoid).get(gate);
        if (safeRoute.length > 17) continue;
        const detour = routesFrom(a, noNodes, avoid).get(b).length - 2;
        const x = id % WIDTH, y = Math.floor(id / WIDTH);
        const spread = [...traps.values()].every(trap => distance(trap, { x, y }) >= 12);
        const score = (safeRoute.length - route.length) * 16 + (main.has(id) ? 12 : 0) +
          (spread ? 8 : 0) + Math.min(detour, 6);
        if (!best || score > best.score) best = { id, x, y, score };
      }
      if (!best) break;
      traps.set(best.id, { x: best.x, y: best.y, spent: false });
    }
    return traps;
  }

  function placeRunes(floor, gate, traps, rng) {
    const runes = new Map();
    for (const zone of Object.keys(ZONES)) {
      if (zone === "entry") continue;
      const candidates = [...floor].map(id => ({ id, x: id % WIDTH, y: Math.floor(id / WIDTH) }))
        .filter(p => (p.x % 4 === 2) !== (p.y % 4 === 2) &&
          !traps.has(p.id) && zoneAt(p.x, p.y) === zone && distance(p, START) >= 8);
      const awayFromGate = candidates.filter(p => distance(p, gate) >= 8);
      const pool = awayFromGate.length ? awayFromGate : candidates;
      const spot = pool[Math.floor(rng() * pool.length)];
      if (spot) runes.set(spot.id, { x: spot.x, y: spot.y, zone, used: false });
    }
    return runes;
  }

  function gateBearing(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const x = Math.abs(dx) * 2 < Math.abs(dy) ? 0 : Math.sign(dx);
    const y = Math.abs(dy) * 2 < Math.abs(dx) ? 0 : Math.sign(dy);
    const name = `${y < 0 ? "north" : y > 0 ? "south" : ""}${x < 0 ? "west" : x > 0 ? "east" : ""}`;
    return { x, y, name };
  }

  function makeMaze(rng) {
    // Space junctions four tiles apart so small chambers don't create accidental shortcuts.
    const cols = Math.floor(WIDTH / 4), rows = Math.floor(HEIGHT / 4);
    const nodes = Array.from({ length: cols * rows }, (_, i) => ({
      x: 2 + (i % cols) * 4, y: 2 + Math.floor(i / cols) * 4, links: [],
    }));
    const center = nodes.find(node => distance(node, START) === 0);
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
      if (i % cols < cols - 1) edges.push([nodes[i], nodes[i + 1]]);
      if (i + cols < nodes.length) edges.push([nodes[i], nodes[i + cols]]);
    }
    const parent = new Map(nodes.map(node => [node, node]));
    const root = node => parent.get(node) === node ? node : root(parent.get(node));
    const connect = ([a, b]) => { a.links.push(b); b.links.push(a); };
    const spare = [];
    const incident = ([a, b]) => a === center || b === center;
    // Seed four ways out of the starting room, then build a randomized spanning tree.
    for (const edge of [...edges.filter(incident), ...shuffled(edges.filter(e => !incident(e)), rng)]) {
      const [a, b] = edge, ra = root(a), rb = root(b);
      if (ra === rb) spare.push(edge);
      else {
        parent.set(ra, rb);
        connect(edge);
      }
    }
    const leafSites = shuffled(nodes.filter(node => node.links.length === 1), rng);
    const farLeaves = leafSites.filter(node => distance(node, center) >= 16);
    const first = farLeaves[0] || leafSites[0];
    const second = farLeaves.find(node => distance(first, node) >= 16) || leafSites.find(node => node !== first);
    const vaults = [first, second];
    const shortcuts = shuffled(spare.filter(edge => !edge.some(node => vaults.includes(node))), rng);
    const opened = [];
    const openShortcuts = count => {
      for (const edge of shortcuts.splice(0, count)) {
        connect(edge);
        opened.push(edge);
      }
    };
    openShortcuts(15 + Math.floor(rng() * 5));

    let routes, gates;
    do {
      routes = routesFrom(center);
      gates = nodes.filter(node => {
        const path = routes.get(node);
        if (node.links.length < 2 || distance(center, node) < 16 || path.length < 7 || path.length > 12) return false;
        // A second path must leave the center in a different direction and not rejoin
        // the first until the gate. Avoid endings behind one mandatory choke point.
        const alternate = routesFrom(center, new Set(path.slice(1, -1))).get(node);
        return alternate && alternate.length <= 17;
      });
      if (gates.length || !shortcuts.length) break;
      openShortcuts(4);
    } while (true);
    if (!gates.length) throw new Error("No gate with two routes.");
    const gate = gates[Math.floor(rng() * gates.length)];
    const floor = new Set();
    for (const node of nodes) {
      floor.add(key(node.x, node.y));
      if (node === center || node === gate || vaults.includes(node) || rng() < .23) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) floor.add(key(node.x + dx, node.y + dy));
        }
      }
      for (const next of node.links) {
        const dx = Math.sign(next.x - node.x), dy = Math.sign(next.y - node.y);
        for (let i = 1; i < 4; i++) floor.add(key(node.x + dx * i, node.y + dy * i));
      }
    }
    return { floor, nodes, routes, vaults, center, gate, traps: chooseTraps(opened, center, gate) };
  }

  function populate(maze, rng, timed) {
    const { nodes, routes, vaults, center, gate } = maze;
    const taken = new Set([center, gate, ...vaults]);
    const enemies = [], loot = [];
    const point = ({ x, y }) => ({ x, y });
    const pick = items => items[Math.floor(rng() * items.length)];
    const steps = node => routes.get(node).length - 1;
    function reserve(prefer, backup = () => true) {
      const free = nodes.filter(node => !taken.has(node));
      const node = pick(free.filter(prefer)) || pick(free.filter(backup)) || pick(free);
      taken.add(node);
      return node;
    }
    function enemy(node, types) {
      const type = pick(types);
      enemies.push({ ...point(node), type, hp: ENEMIES[type].hp });
    }
    function drop(node, type) {
      loot.push({ ...point(node), type });
    }
    for (const [i, vault] of vaults.entries()) {
      const entrance = vault.links[0];
      const side = rng() < .5 ? -1 : 1;
      const dx = Math.sign(vault.x - entrance.x), dy = Math.sign(vault.y - entrance.y);
      drop({ x: vault.x + dx + side * dy, y: vault.y + dy + side * dx }, "relic");
      enemy(vault, i === 0 ? ["skeleton", "shade", "spider"] : ["skeleton", "spider", "warden"]);
    }
    // Leave useful supplies close to the starting room, before the first threats.
    const supply = reserve(node => steps(node) === 1);
    drop(supply, "tonic");
    drop(reserve(node => steps(node) <= 2 && distance(node, supply) >= 8), "tonic");
    drop(reserve(node => steps(node) >= 2 && steps(node) <= 4), "blade");
    drop(reserve(node => steps(node) >= 5 && node.links.length <= 2), "blade");
    const roster = ["slime", "beetle", null, "skeleton", "spider", "shade", "warden", null, null, null, null, null];
    for (const [i, guaranteed] of roster.entries()) {
      const near = i < 3;
      const set = node => near ? steps(node) >= 3 && steps(node) <= 4 : steps(node) >= (guaranteed === "warden" ? 6 : 4);
      const node = reserve(node => set(node) && enemies.every(e => distance(e, node) >= 8), set);
      const types = guaranteed ? [guaranteed] : near ? ["slime", "beetle", "skeleton"] :
        node.x > START.x ? ["skeleton", "spider", "slime", "shade"] : ["slime", "beetle", "shade", "skeleton"];
      enemy(node, types);
    }
    for (let i = 0; i < 10; i++) {
      const type = i < 5 ? "gold" : i < 7 ? "tonic" : pick(["gold", "gold", "tonic"]);
      drop(reserve(node => i < 5 ? steps(node) >= 2 : steps(node) >= 3 && node.links.length <= 2), type);
    }
    const roomy = node => DIRS.every(([dx, dy]) => maze.floor.has(key(node.x + dx, node.y + dy)));
    enemy(reserve(node => steps(node) >= 4 && roomy(node) && enemies.every(e => distance(e, node) >= 8),
      node => steps(node) >= 4), ["goblin"]);
    const optionalChest = node => steps(node) >= 4 && node.links.length === 1;
    const chest = reserve(node => optionalChest(node) && enemies.every(e => distance(e, node) >= 8),
      node => steps(node) >= 4 && node.links.length <= 2);
    enemy(chest, ["mimic"]);
    enemies.at(-1).disguised = true;
    if (timed) {
      const gateRoute = routes.get(gate);
      const detour = node => !gateRoute.includes(node);
      drop(reserve(node => steps(node) >= 3 && steps(node) <= 6 && node.links.length <= 2 && detour(node),
        node => steps(node) >= 3 && detour(node)), "hourglass");
    }
    return { enemies, loot };
  }

  function random(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createGame(seed = Date.now(), mode = "timed", biome) {
    seed >>>= 0;
    if (mode !== "practice" && mode !== "debug") mode = "timed";
    const themes = Object.keys(BIOMES);
    if (!Object.hasOwn(BIOMES, biome)) biome = themes[Math.floor(random(seed ^ 0x312be7d0)() * themes.length)];
    const rng = random(seed), statsDice = random(seed ^ 0x393ecce7), lootDice = random(seed ^ 0x7a650cd3);
    const statDie = () => 1 + Math.floor(statsDice() * 6);
    const d6 = () => 1 + Math.floor(lootDice() * 6);
    const maze = makeMaze(rng);
    const { enemies, loot } = populate(maze, rng, mode !== "practice");
    const runes = placeRunes(maze.floor, maze.gate, maze.traps, random(seed ^ 0xcc11fe8c));
    const g = {
      seed, mode, biome, statDie, d6, depth: 1, floorCount: 1, cleared: 0, relicPairs: 0, floorRelics: 0,
      floor: maze.floor, exit: { x: maze.gate.x, y: maze.gate.y },
      seen: new Set(), visible: new Set(),
      player: {
        ...START, relics: 0, kills: 0, forgedBlade: false,
      },
      enemies, loot, traps: maze.traps, runes,
      turn: 0, status: "playing", deadline: null, secondsLeft: TIME_LIMIT, effects: [], lastRoll: null, log: [
        { text: "Stand on a blue rune to see the gate arrow. Amber spike plates mark risky shortcuts.", kind: "note" },
      ],
      pausedAt: null,
    };
    rerollStats(g);
    reveal(g);
    return g;
  }

  function createExpedition(seed, mode, biome) {
    if (mode === "debug") return createGame(seed, mode, biome);
    const g = createGame(seed, mode, FLOOR_ORDER[0]);
    g.floorCount = FLOOR_ORDER.length;
    g.expeditionSeed = g.seed;
    g.log[0].text = "Find the stairs down. Blue runes point toward them.";
    return g;
  }

  function nextFloor(g) {
    if (g.status !== "stairs" || g.depth >= g.floorCount) return null;
    const depth = g.depth + 1;
    const seed = (g.expeditionSeed + Math.imul(depth - 1, 0x9e3779b9)) >>> 0;
    const next = createGame(seed, g.mode, FLOOR_ORDER[depth - 1]);
    Object.assign(next, {
      depth, floorCount: g.floorCount, expeditionSeed: g.expeditionSeed,
      cleared: g.cleared, relicPairs: g.relicPairs, turn: g.turn,
      rolls: g.rolls, statDie: g.statDie, started: false, statsLocked: true,
    });
    next.player = { ...g.player, ...START };
    if (depth < next.floorCount) next.log[0].text = "Find the stairs down. Blue runes point toward them.";
    return next;
  }

  function rerollStats(g) {
    if (g.started || g.statsLocked || g.turn !== 0 || g.status !== "playing") return false;
    const d6 = g.statDie;
    const rolls = { health: d6(), power: d6(), gold: [d6(), d6()] };
    const maxHP = 10 + rolls.health;
    g.rolls = rolls;
    Object.assign(g.player, {
      hp: maxHP, maxHP, attack: rolls.power >= 4 ? 3 : 2,
      gold: rolls.gold[0] + rolls.gold[1],
    });
    return true;
  }

  function passable(g, x, y) {
    return inBounds(x, y) && g.floor.has(key(x, y));
  }

  function canSee(g, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    let lastX = a.x, lastY = a.y;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(a.x + dx * i / steps), y = Math.round(a.y + dy * i / steps);
      if (x !== lastX && y !== lastY && !passable(g, x, lastY) && !passable(g, lastX, y)) return false;
      if (i < steps && !passable(g, x, y)) return false;
      lastX = x;
      lastY = y;
    }
    return true;
  }

  function reveal(g) {
    g.visible.clear();
    const p = g.player;
    for (let y = p.y - 7; y <= p.y + 7; y++) {
      for (let x = p.x - 7; x <= p.x + 7; x++) {
        if (inBounds(x, y) && Math.hypot(x - p.x, y - p.y) <= 7.1 && canSee(g, p, { x, y })) {
          g.visible.add(key(x, y));
          g.seen.add(key(x, y));
        }
      }
    }
  }

  function say(g, text, kind = "note") {
    g.log.unshift({ text, kind });
    g.log.length = Math.min(g.log.length, 24);
  }

  function startClock(g, now) {
    if (g.started || g.status !== "playing") return;
    g.started = true;
    if (g.mode === "timed") g.deadline = now + TIME_LIMIT * 1000;
  }

  function tickClock(g, now) {
    if (g.deadline === null || g.pausedAt !== null || g.status !== "playing") return false;
    g.secondsLeft = Math.max(0, Math.ceil((g.deadline - now) / 1000));
    if (g.secondsLeft > 0) return false;
    g.status = "expired";
    say(g, "Time ran out before you reached the gate.", "bad");
    return true;
  }

  function pauseGame(g, now) {
    if (!g.started || g.status !== "playing" || g.pausedAt !== null || tickClock(g, now)) return false;
    g.pausedAt = now;
    return true;
  }

  function resumeGame(g, now) {
    if (g.pausedAt === null || g.status !== "playing") return false;
    if (g.deadline !== null) g.deadline += Math.max(0, now - g.pausedAt);
    g.pausedAt = null;
    return true;
  }

  function enableDebug(g) {
    if (g.status !== "playing" || g.pausedAt === null || g.mode === "debug") return false;
    g.mode = "debug";
    g.deadline = null;
    g.player.hp = g.player.maxHP;
    return true;
  }

  function number(g, { x, y }, amount, unit, tone = "gain") {
    g.effects.push({ x, y, kind: "number", amount, unit, tone });
  }

  function awardGold(g, source) {
    const roll = g.d6();
    const modifier = 4;
    const amount = roll + modifier;
    g.player.gold += amount;
    g.lastRoll = { roll, modifier, amount, source };
    number(g, g.player, amount, "gold");
    say(g, `${source} +${amount} coins (${roll} + ${modifier}).`, "good");
  }

  function lootHere(g) {
    const p = g.player;
    const index = g.loot.findIndex(item => distance(item, p) === 0);
    if (index === -1) return;
    const [item] = g.loot.splice(index, 1);
    g.effects.push({ ...item, kind: "pickup" });
    if (item.type === "gold") {
      awardGold(g, "Found a coin stash.");
    } else if (item.type === "tonic") {
      const healed = healPlayer(g);
      say(g, healed ? `Drank the tonic on pickup. Recovered ${healed} HP.` : "Drank the tonic on pickup at full health.", "good");
    } else if (item.type === "relic") {
      p.relics++;
      g.floorRelics++;
      number(g, p, 1, "relic");
      say(g, "Recovered a vault relic!", "good");
    } else if (item.type === "hourglass") {
      if (g.deadline === null) {
        if (g.mode === "debug") say(g, "Hourglass picked up. The clock is disabled in Debug.", "note");
        return;
      }
      g.deadline += HOURGLASS_SECONDS * 1000;
      g.secondsLeft += HOURGLASS_SECONDS;
      number(g, p, HOURGLASS_SECONDS, "sec");
      say(g, `Hourglass recovered. +${HOURGLASS_SECONDS} seconds.`, "good");
    } else if (!p.forgedBlade) {
      p.forgedBlade = true;
      p.attack++;
      number(g, p, 1, "power");
      say(g, "Equipped a forged blade. Power +1.", "good");
    } else {
      awardGold(g, "Sold the spare blade.");
    }
  }

  function healPlayer(g) {
    const p = g.player, healed = Math.min(2, p.maxHP - p.hp);
    p.hp += healed;
    if (healed) number(g, p, healed, "HP");
    return healed;
  }

  function hurt(g, damage, text) {
    if (g.mode === "debug") return false;
    const p = g.player;
    const lost = Math.min(p.hp, damage);
    p.hp -= lost;
    g.effects.push({ x: p.x, y: p.y, kind: "hurt" });
    number(g, p, -lost, "HP", "hurt");
    say(g, `${text} ${lost}.`, "bad");
    if (!p.hp) g.status = "lost";
    return g.status === "lost";
  }

  function enterTile(g) {
    const p = g.player, id = key(p.x, p.y);
    const trap = g.traps.get(id);
    if (trap && !trap.spent) {
      trap.spent = true;
      g.effects.push({ x: p.x, y: p.y, kind: "trap" });
      if (hurt(g, TRAP_DAMAGE, "The spike plate hits you for")) return;
    }
    const rune = g.runes.get(id);
    if (rune) {
      rune.used = true;
      g.effects.push({ x: p.x, y: p.y, kind: "rune" });
    }
    lootHere(g);
  }

  function enemyTurn(g) {
    const p = g.player;
    for (const e of g.enemies) {
      if (e.disguised || e.wakeTurn === g.turn) continue;
      const d = distance(e, p);
      const type = ENEMIES[e.type];
      const dx = Math.sign(p.x - e.x), dy = Math.sign(p.y - e.y);
      if (e.type === "shade" && e.aim) {
        const aim = e.aim;
        e.aim = null;
        if (d <= 4 && dx === aim.dx && dy === aim.dy && canSee(g, e, p)) {
          g.effects.push({ x: e.x, y: e.y, toX: p.x, toY: p.y, kind: "bolt" });
          if (hurt(g, SPECTER_BOLT, "The specter's bolt hits you for")) return;
        } else {
          say(g, "The specter's bolt misses.");
        }
        continue;
      }
      if (e.windup) {
        e.windup = false;
        const attack = e.type === "mimic" ? "The mimic's bite" : "The ogre's heavy swing";
        if (d === 1) {
          g.effects.push({ x: e.x, y: e.y, kind: "counter" });
          if (hurt(g, type.damage, `${attack} hits you for`)) return;
        } else {
          say(g, `${attack} misses.`);
        }
        continue;
      }
      if (d === 1) {
        if (e.type === "warden" || e.type === "mimic") {
          e.windup = true;
          say(g, e.type === "mimic" ? "The mimic opens its jaws. Step back!" : "The ogre raises its weapon. Step back!", "bad");
        } else {
          const damage = e.type === "spider" && g.turn % 2 !== 0 ? 1 : type.damage;
          g.effects.push({ x: e.x, y: e.y, kind: "counter" });
          if (hurt(g, damage, `${type.name} hits you for`)) return;
          if (e.type === "goblin") {
            const retreat = DIRS.map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy }))
              .find(({ x, y }) => passable(g, x, y) && distance({ x, y }, p) === 2 &&
                distance({ x, y }, g.exit) > 0 && !g.enemies.some(other => other.x === x && other.y === y));
            if (retreat) Object.assign(e, retreat);
          }
        }
      } else if (d <= 5 && g.visible.has(key(e.x, e.y)) && canSee(g, e, p)) {
        if (e.type === "shade" && d <= 4 && (!dx || !dy)) {
          e.aim = { dx, dy };
          say(g, "The specter lines up a bolt. Step sideways!", "bad");
          continue;
        }
        if (e.type !== "beetle" && (g.turn + (e.type === "slime" ? 1 : 0)) % 2 !== 0) continue;
        for (const [dx, dy] of DIRS) {
          const x = e.x + dx, y = e.y + dy;
          if (distance({ x, y }, p) < d && passable(g, x, y) &&
              !g.enemies.some(other => other.x === x && other.y === y) &&
              distance({ x, y }, g.exit) > 0) {
            Object.assign(e, { x, y });
            break;
          }
        }
      }
    }
  }

  function resolveReply(g) {
    if (!g.replyPending || g.status !== "playing" || g.pausedAt !== null) return false;
    g.replyPending = false;
    g.effects = [];
    enemyTurn(g);
    return true;
  }

  function enemyAhead(g, action) {
    const step = DIRS[action];
    return Number.isInteger(action) && step
      ? g.enemies.find(e => e.x === g.player.x + step[0] && e.y === g.player.y + step[1])
      : undefined;
  }

  function act(g, action, { stageCombat = false } = {}) {
    if (g.status !== "playing" || g.pausedAt !== null || g.replyPending) return false;
    g.effects = [];
    const p = g.player;
    let attacked = false;
    if (Number.isInteger(action) && action >= 0 && action < DIRS.length) {
      const [dx, dy] = DIRS[action];
      const x = p.x + dx, y = p.y + dy;
      if (!passable(g, x, y)) return false;
      const enemyIndex = g.enemies.findIndex(e => e.x === x && e.y === y);
      const e = g.enemies[enemyIndex];
      attacked = Boolean(e);
      if (e?.disguised) {
        e.disguised = false;
        e.windup = true;
        e.wakeTurn = g.turn + 1;
        g.effects.push({ x, y, kind: "mimic" });
        say(g, "The chest is a mimic! Its jaws open—step back!", "bad");
      } else if (e) {
        const damage = Math.min(e.hp, p.attack);
        e.hp -= damage;
        g.effects.push({ x, y, kind: "strike" });
        number(g, e, -damage, "HP", "strike");
        if (e.hp <= 0) {
          g.effects.push({ x, y, kind: "defeat", enemy: e.type });
          g.enemies.splice(enemyIndex, 1);
          p.kills++;
          say(g, `${ENEMIES[e.type].name} defeated.`, "good");
          Object.assign(p, { x, y });
        } else {
          say(g, `Hit ${ENEMIES[e.type].name.toLowerCase()} for ${damage}.`);
        }
      } else {
        Object.assign(p, { x, y });
      }
      if (p.x === x && p.y === y) enterTile(g);
    } else if (action !== "wait") {
      return false;
    }
    g.turn++;
    reveal(g);
    if (g.status === "lost") return true;
    if (distance(p, g.exit) === 0) {
      g.cleared = g.depth;
      if (g.floorRelics === 2) g.relicPairs++;
      g.status = g.depth < g.floorCount ? "stairs" : "won";
      say(g, g.status === "stairs" ? "You reached the stairs down." : "You escaped the Underways.", "good");
    } else if (attacked && stageCombat) {
      g.replyPending = true;
    } else {
      enemyTurn(g);
    }
    return true;
  }

  const lowHealth = ({ hp, maxHP }) => hp > 0 && hp * 10 <= maxHP * 3;
  const api = { WIDTH, HEIGHT, TIME_LIMIT, TRAP_DAMAGE, START, DIRS, BIOMES, FLOOR_ORDER, ZONES, ENEMIES, BESTIARY, LOOT, key, zoneAt, distance, passable, gateBearing, createGame, createExpedition, nextFloor, rerollStats, act, enemyAhead, resolveReply, startClock, tickClock, pauseGame, resumeGame, enableDebug, lowHealth };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Underways = api;
})(globalThis);
