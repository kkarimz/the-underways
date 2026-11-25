const assert = require("node:assert/strict");
const { test } = require("node:test");
const { WIDTH, HEIGHT, DIRS, START, ENEMIES, BESTIARY, key, passable, gateBearing, createGame, rerollStats, act, startClock, tickClock } = require("../game.js");
const { pauseGame, resumeGame, lowHealth } = require("../game.js");

function walk(g, ...points) {
  for (const [x, y] of points) {
    while (g.player.x !== x || g.player.y !== y) {
      const p = g.player;
      assert.equal(g.status, "playing", `stopped at ${p.x},${p.y}`);
      const dx = Math.sign(x - p.x), dy = Math.sign(y - p.y);
      assert.ok(act(g, DIRS.findIndex(([a, b]) => dx === a && dy === b)), `blocked at ${p.x},${p.y}`);
    }
  }
}

function pathTo(g, target, blocked = null) {
  const { player } = g;
  const visited = new Set(blocked instanceof Set ? blocked : [blocked]);
  visited.add(key(player.x, player.y));
  const queue = [{ x: player.x, y: player.y, from: null }];
  for (const tile of queue) {
    if (tile.x === target.x && tile.y === target.y) {
      const path = [];
      for (let step = tile; step.from; step = step.from) path.unshift([step.x, step.y]);
      return path;
    }
    for (const [dx, dy] of DIRS) {
      const x = tile.x + dx, y = tile.y + dy;
      const id = key(x, y);
      if (!visited.has(id) && passable(g, x, y)) {
        visited.add(id);
        queue.push({ x, y, from: tile });
      }
    }
  }
  return null;
}

function travel(g, target) {
  const path = pathTo(g, target, target === g.exit ? null : key(g.exit.x, g.exit.y));
  assert.ok(path, `No path to ${target.x},${target.y}`);
  walk(g, ...path);
}

const finish = g => travel(g, g.exit);

test("terrain, enemy spawns and loot are reachable", () => {
  for (let seed = 0; seed < 200; seed++) {
    const g = createGame(seed);
    const visited = new Set([key(START.x, START.y)]);
    const queue = [START];
    for (const { x, y } of queue) {
      for (const [dx, dy] of DIRS) {
        const a = x + dx, b = y + dy, cell = key(a, b);
        if (passable(g, a, b) && !visited.has(cell)) {
          visited.add(cell);
          queue.push({ x: a, y: b });
        }
      }
    }
    assert.equal(visited.size, g.floor.size);
    const placements = [START, ...g.enemies, ...g.loot, ...g.traps.values(), ...g.runes.values(), g.exit]
      .map(({ x, y }) => key(x, y));
    for (const id of placements) assert.ok(visited.has(id));
    assert.equal(new Set(placements).size, placements.length);
    assert.ok(!g.seen.has(key(g.exit.x, g.exit.y)));
    assert.equal(g.enemies.length, 16);
    for (const type of ["slime", "skeleton", "spider", "beetle", "shade", "warden", "goblin", "mimic"]) {
      assert.ok(g.enemies.some(e => e.type === type));
    }
    assert.equal(g.enemies.filter(e => e.disguised).length, 1);
  }
});

test("every wing gets a rune and both trapped shortcuts are optional", () => {
  let shorterRoute = false;
  for (let seed = 0; seed < 120; seed++) {
    const g = createGame(seed);
    assert.deepEqual(new Set([...g.runes.values()].map(rune => rune.zone)), new Set(["center", "south", "north", "east", "west"]));
    assert.equal(g.traps.size, 2);
    const safe = pathTo(g, g.exit, new Set(g.traps.keys()));
    assert.ok(safe && safe.length <= 64);
    if (safe.length > pathTo(g, g.exit).length) shorterRoute = true;
  }
  assert.ok(shorterRoute, "accepting a trap sometimes gives a faster route to the gate");
});

test("the gate is 24–44 steps away and no one interior tile blocks every route", () => {
  for (let seed = 0; seed < 120; seed++) {
    const g = createGame(seed);
    const path = pathTo(g, g.exit);
    assert.ok(path.length >= 24 && path.length <= 44, `seed ${seed}: ${path.length} steps`);
    for (const [x, y] of path.slice(0, -1)) {
      assert.ok(pathTo(g, g.exit, key(x, y)), `seed ${seed}: bottleneck at ${x},${y}`);
    }
  }
});

test("an explorer can reach the gate without collecting a relic", () => {
  for (let seed = 0; seed < 48; seed++) {
    const g = createGame(seed);
    finish(g);
    assert.equal(g.status, "won");
    assert.equal(g.player.relics, 0);
    assert.equal(act(g, "wait"), false);
  }
});

test("both optional relics can be collected by backtracking before escape", () => {
  const g = createGame(0);
  const basePower = g.player.attack;
  const [first, second] = g.loot.filter(item => item.type === "relic");
  travel(g, g.loot.find(item => item.type === "blade"));
  travel(g, first);
  assert.equal(g.player.relics, 1);
  assert.equal(g.player.attack, basePower + 1);
  travel(g, second);
  assert.equal(g.player.relics, 2);
  finish(g);
  assert.equal(g.status, "won");
});

test("blocked moves are free and enemies can defeat the player", () => {
  const g = createGame(7);
  assert.equal(act(g, "heal"), false);
  assert.equal(act(g, "constructor"), false);
  g.enemies = [];
  walk(g, [START.x - 1, START.y], [START.x - 1, START.y + 1]);
  assert.equal(act(g, 2), false);
  assert.equal(g.turn, 2);
  g.enemies = [{ x: START.x, y: START.y + 1, type: "skeleton", hp: 3 }];
  for (let i = 0; i < 4 && g.player.hp === g.player.maxHP; i++) act(g, "wait");
  const before = g.player.hp;
  assert.ok(before < g.player.maxHP);
  for (let i = 0; i < 20 && g.status === "playing"; i++) act(g, "wait");
  assert.equal(g.status, "lost");
});

const popups = g => g.effects.filter(e => e.kind === "number").map(({ x, y, amount, unit, tone }) => ({ x, y, amount, unit, tone }));

test("one-shot spike plates cost two HP, can be dodged, and stop taking turns on defeat", () => {
  const g = createGame(7);
  g.enemies = [];
  const trap = g.traps.values().next().value;
  const step = DIRS.findIndex(([dx, dy]) => passable(g, trap.x - dx, trap.y - dy));
  const [dx, dy] = DIRS[step];
  Object.assign(g.player, { x: trap.x - dx, y: trap.y - dy });
  const hp = g.player.hp;
  assert.equal(act(g, step), true);
  assert.equal(trap.spent, true);
  assert.equal(g.player.hp, hp - 2);
  assert.equal(popups(g)[0].amount, -2);
  act(g, (step + 2) % 4);
  act(g, step);
  assert.equal(g.player.hp, hp - 2);

  trap.spent = false;
  g.player.hp = 1;
  act(g, (step + 2) % 4);
  act(g, step);
  assert.equal(g.status, "lost");
  assert.equal(popups(g)[0].amount, -1);
  assert.equal(act(g, "wait"), false);
});

test("crossing a rune triggers the guide without leaving text or revealing the gate", () => {
  const g = createGame(7);
  g.enemies = [];
  const rune = [...g.runes.values()].find(r => Math.hypot(r.x - g.exit.x, r.y - g.exit.y) > 10);
  assert.equal(rune.used, false);
  const step = DIRS.findIndex(([dx, dy]) => passable(g, rune.x - dx, rune.y - dy));
  const [dx, dy] = DIRS[step];
  Object.assign(g.player, { x: rune.x - dx, y: rune.y - dy });
  assert.equal(act(g, step), true);
  assert.equal(rune.used, true);
  assert.deepEqual(g.effects, [{ x: rune.x, y: rune.y, kind: "rune" }]);
  assert.equal(g.log.length, 1);
  assert.ok(!g.seen.has(key(g.exit.x, g.exit.y)), "don't reveal the exit tile remotely");
  act(g, (step + 2) % 4);
  assert.ok(!g.effects.some(e => e.kind === "rune"));
  act(g, step);
  assert.ok(g.effects.some(e => e.kind === "rune"));
});

test("the gate bearing changes with the explorer's position", () => {
  const exit = { x: 12, y: 12 };
  assert.deepEqual(gateBearing({ x: 12, y: 18 }, exit), { x: 0, y: -1, name: "north" });
  assert.deepEqual(gateBearing({ x: 4, y: 18 }, exit), { x: 1, y: -1, name: "northeast" });
  assert.deepEqual(gateBearing({ x: 4, y: 12 }, exit), { x: 1, y: 0, name: "east" });
});

test("combat numbers report exact damage and kills never award gold", () => {
  const g = createGame(7);
  const { x, y } = START;
  g.player.attack = 2;
  g.enemies = [{ x: x + 1, y, type: "skeleton", hp: 3 }];
  act(g, 1);
  assert.deepEqual(popups(g), [
    { x: x + 1, y, amount: -2, unit: "HP", tone: "strike" },
    { x, y, amount: -1, unit: "HP", tone: "hurt" },
  ]);
  const gold = g.player.gold;
  act(g, 1);
  assert.deepEqual(popups(g), [
    { x: x + 1, y, amount: -1, unit: "HP", tone: "strike" },
  ]);
  assert.equal(g.player.gold, gold);
  assert.equal(g.lastRoll, null);
  assert.equal(g.player.kills, 1);
  assert.equal(g.log[0].text, "Skeleton defeated.");
  assert.equal(g.enemies.length, 0);

  g.player.hp = 1;
  g.turn = 3;
  g.enemies = [{ x, y, type: "spider", hp: 4 }];
  act(g, "wait");
  assert.deepEqual(popups(g), [{ x: x + 1, y, amount: -1, unit: "HP", tone: "hurt" }]);
  assert.equal(g.status, "lost");
});

test("staged attacks show damage before the enemy reply and reject extra inputs", () => {
  const { enemyAhead, resolveReply } = require("../game.js");
  const g = createGame(7);
  const { x, y, hp } = g.player;
  const skeleton = { x: x + 1, y, type: "skeleton", hp: 3 };
  g.enemies = [skeleton];
  g.player.attack = 2;
  startClock(g, 0);
  assert.equal(enemyAhead(g, 1), skeleton);
  assert.equal(enemyAhead(g, 3), undefined);
  assert.equal(act(g, 1, { stageCombat: true }), true);
  assert.equal(skeleton.hp, 1);
  assert.equal(g.player.hp, hp);
  assert.equal(g.turn, 1);
  assert.deepEqual(popups(g).map(e => e.tone), ["strike"]);
  assert.equal(act(g, 1, { stageCombat: true }), false);
  pauseGame(g, 100);
  assert.equal(resolveReply(g), false);
  resumeGame(g, 500);
  assert.equal(resolveReply(g), true);
  assert.equal(g.player.hp, hp - 1);
  assert.equal(g.turn, 1);
  assert.deepEqual(popups(g).map(e => e.tone), ["hurt"]);
  assert.equal(resolveReply(g), false);
  act(g, 1, { stageCombat: true });
  assert.equal(g.enemies.length, 0);
  assert.equal(resolveReply(g), true);
  assert.equal(g.player.hp, hp - 1);
});

test("mimics lie still until bumped, telegraph a bite, and drop no gold", () => {
  const g = createGame(7);
  const { x, y } = START;
  const mimic = { x: x + 1, y, type: "mimic", hp: 5, disguised: true };
  g.enemies = [mimic];
  g.loot = [];
  const { hp, gold } = g.player;
  act(g, "wait");
  assert.equal(mimic.disguised, true);
  assert.equal(g.player.hp, hp);
  act(g, 1);
  assert.equal(mimic.disguised, false);
  assert.equal(mimic.windup, true);
  assert.equal(mimic.hp, 5);
  assert.equal(g.player.hp, hp);
  assert.equal(g.player.x, x);
  assert.match(g.log[0].text, /chest is a mimic/i);
  act(g, 3);
  assert.equal(g.player.hp, hp);
  assert.match(g.log[0].text, /bite misses/);
  act(g, 1);
  g.player.attack = 6;
  act(g, 1);
  assert.equal(g.enemies.length, 0);
  assert.equal(g.player.kills, 1);
  assert.equal(g.player.gold, gold);
  assert.equal(g.lastRoll, null);
});

test("every enemy has a field-guide entry with its combat role and a tip", () => {
  assert.deepEqual(Object.keys(BESTIARY), Object.keys(ENEMIES));
  for (const [id, { behavior, tip, min }] of Object.entries(BESTIARY)) {
    assert.ok(behavior && tip);
    assert.ok(ENEMIES[id].hp > 0 && ENEMIES[id].damage > 0);
    if (min) assert.ok(min < ENEMIES[id].damage);
  }
});

test("goblin skirmishers retreat to an open tile after a hit", () => {
  const g = createGame(7);
  const { x, y } = START;
  const goblin = { x: x + 1, y, type: "goblin", hp: 3 };
  g.enemies = [goblin];
  act(g, "wait");
  assert.equal(goblin.x, x + 1);
  assert.equal(goblin.y, y - 1);
  assert.match(g.log[0].text, /Goblin skirmisher hits you/);
});

test("new enemy tells give you a turn to dodge, and beetles close in on odd turns", () => {
  const { x, y } = START;
  const encounter = (type, offset) => {
    const g = createGame(7);
    g.enemies = [{ x: x + offset, y, type, hp: 5 }];
    return g;
  };
  const beetle = encounter("beetle", 2);
  act(beetle, "wait");
  assert.equal(beetle.enemies[0].x, x + 1);
  for (const [type, distance, dodge, damage] of [["shade", 2, 0, 2], ["warden", 1, 3, 3]]) {
    const safe = encounter(type, distance);
    act(safe, "wait");
    assert.ok(safe.enemies[0].aim || safe.enemies[0].windup);
    assert.equal(safe.player.hp, safe.player.maxHP);
    act(safe, dodge);
    assert.equal(safe.player.hp, safe.player.maxHP);
    assert.match(safe.log[0].text, /misses/);

    const hit = encounter(type, distance);
    act(hit, "wait");
    act(hit, "wait");
    assert.equal(hit.player.hp, hit.player.maxHP - damage);
    assert.equal(popups(hit)[0].amount, -damage);
  }
});

test("healing and non-gold loot report the gained amount", () => {
  const g = createGame(7);
  const { x, y } = START;
  g.enemies = [];
  for (const [type, unit] of [["blade", "power"], ["relic", "relic"]]) {
    g.loot = [{ x: x + 1, y, type }];
    act(g, 1);
    assert.deepEqual(popups(g), [{ x: x + 1, y, amount: 1, unit, tone: "gain" }]);
    act(g, 3);
  }
});

test("floor tonics heal immediately without adding to inventory", () => {
  const g = createGame(7);
  g.enemies = [];
  const { x, y, maxHP } = g.player;
  g.player.hp = maxHP - 3;
  g.loot = [{ x: x + 1, y, type: "tonic" }, { x, y, type: "tonic" }];
  act(g, 1);
  assert.equal(g.player.hp, maxHP - 1);
  assert.equal(Object.hasOwn(g.player, "tonics"), false);
  assert.deepEqual(popups(g), [{ x: x + 1, y, amount: 2, unit: "HP", tone: "gain" }]);
  act(g, 3);
  assert.equal(g.player.hp, maxHP);
  assert.deepEqual(popups(g), [{ x, y, amount: 1, unit: "HP", tone: "gain" }]);
  assert.equal(g.loot.length, 0);
});

test("the overhead health bar threshold includes 30% but not higher or zero HP", () => {
  assert.equal(lowHealth({ hp: 3, maxHP: 10 }), true);
  assert.equal(lowHealth({ hp: 4, maxHP: 13 }), false);
  assert.equal(lowHealth({ hp: 0, maxHP: 10 }), false);
});

test("pause freezes turns and preserves the exact time remaining", () => {
  const g = createGame(7);
  assert.equal(pauseGame(g, 0), false);
  startClock(g, 1000);
  assert.equal(pauseGame(g, 53_250), true);
  assert.equal(g.secondsLeft, 8);
  assert.equal(act(g, 0), false);
  assert.equal(g.turn, 0);
  assert.equal(tickClock(g, 100_000), false);
  assert.equal(resumeGame(g, 100_000), true);
  assert.equal(g.deadline, 107_750);
  assert.equal(tickClock(g, 107_749), false);
  assert.equal(tickClock(g, 107_750), true);
});

test("starting rolls are reproducible, varied, and match the explorer's stats", () => {
  const results = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const g = createGame(seed);
    const { health, power, gold } = g.rolls;
    assert.deepEqual(g.rolls, createGame(seed).rolls);
    for (const die of [health, power, ...gold]) assert.ok(die >= 1 && die <= 6);
    assert.equal(g.player.hp, 10 + health);
    assert.equal(g.player.attack, power >= 4 ? 3 : 2);
    assert.equal(Object.hasOwn(g.rolls, "supply"), false);
    assert.equal(g.player.gold, gold[0] + gold[1]);
    results.add(JSON.stringify(g.rolls));
  }
  assert.ok(results.size > 1);
});

test("rerolling changes starting stats but not the dungeon, and locks on descent", () => {
  const g = createGame(7);
  const first = g.rolls;
  const layout = () => JSON.stringify([[...g.floor], g.exit, g.enemies, g.loot]);
  const original = layout();
  assert.equal(rerollStats(g), true);
  assert.notDeepEqual(g.rolls, first);
  assert.equal(layout(), original);
  assert.equal(g.player.gold, g.rolls.gold[0] + g.rolls.gold[1]);
  assert.equal(g.player.hp, 10 + g.rolls.health);
  assert.equal(g.d6(), createGame(7).d6(), "rerolls do not affect the loot dice");
  startClock(g, 0);
  const rerolled = g.rolls;
  assert.equal(rerollStats(g), false);
  assert.equal(g.rolls, rerolled);
});

test("coin stashes roll d6 + 4 and report the roll", () => {
  const g = createGame(7);
  g.enemies = [];
  const startingGold = g.player.gold;
  travel(g, g.loot.find(item => item.type === "gold"));
  const amount = g.player.gold - startingGold;
  assert.ok(amount >= 5 && amount <= 10);
  assert.ok(g.log.some(entry => entry.text.includes(`+${amount} coins (${amount - 4} + 4)`)));
  assert.deepEqual(g.lastRoll, { amount, roll: amount - 4, modifier: 4, source: "Found a coin stash." });
  assert.deepEqual(popups(g), [{ x: g.player.x, y: g.player.y, amount, unit: "gold", tone: "gain" }]);
});

test("fresh seeds generate different floor plans, encounters and loot with gates in every wing", () => {
  const generations = Array.from({ length: 48 }, (_, seed) => createGame(seed));
  for (const field of ["exit", "enemies", "loot", "floor"]) {
    const serialized = g => JSON.stringify(field === "floor" ? [...g.floor].sort((a, b) => a - b) : g[field]);
    assert.ok(new Set(generations.map(serialized)).size >= (field === "exit" ? 16 : 48), `${field} should vary`);
    assert.equal(serialized(generations[2]), serialized(createGame(2)));
  }
  for (const { player } of generations) {
    assert.equal(player.x, Math.floor(WIDTH / 2));
    assert.equal(player.y, Math.floor(HEIGHT / 2));
  }
  const rows = generations.map(g => g.exit.y);
  assert.ok(rows.some(y => y < HEIGHT / 3));
  assert.ok(rows.some(y => y >= HEIGHT / 3 && y < HEIGHT * 2 / 3));
  assert.ok(rows.some(y => y >= HEIGHT * 2 / 3));
});

test("the timer starts on descent and expires at exactly one minute", () => {
  const g = createGame(7);
  assert.equal(tickClock(g, 20_000), false);
  assert.equal(g.secondsLeft, 60);
  startClock(g, 20_000);
  startClock(g, 21_000);
  assert.equal(tickClock(g, 70_000), false);
  assert.equal(g.secondsLeft, 10);
  assert.equal(tickClock(g, 79_999), false);
  assert.equal(g.secondsLeft, 1);
  assert.equal(tickClock(g, 80_000), true);
  assert.equal(g.secondsLeft, 0);
  assert.equal(g.status, "expired");
  assert.equal(act(g, 0), false);
  assert.equal(tickClock(g, 81_000), false);
});

test("practice stays untimed without allowing a reroll after descent", () => {
  const g = createGame(7, "practice");
  assert.ok(!g.loot.some(item => item.type === "hourglass"));
  startClock(g, 10_000);
  assert.equal(g.deadline, null);
  assert.equal(rerollStats(g), false);
  assert.equal(tickClock(g, 600_000), false);
  assert.equal(g.status, "playing");
  finish(g);
  assert.equal(g.status, "won");
});

test("three stair landings lead to the final gate with fresh timers and carried stats", () => {
  const { createExpedition, nextFloor, FLOOR_ORDER } = require("../game.js");
  let g = createExpedition(7, "timed");
  const rolls = g.rolls;
  const starts = new Set();
  g.player.hp -= 3;
  g.player.attack++;
  g.player.forgedBlade = true;
  for (let i = 0; i < FLOOR_ORDER.length; i++) {
    assert.equal(g.biome, FLOOR_ORDER[i]);
    assert.equal(g.depth, i + 1);
    assert.equal(g.secondsLeft, 60);
    assert.equal(g.deadline, null);
    assert.equal(g.rolls, rolls);
    assert.equal(g.player.attack, rolls.power >= 4 ? 4 : 3);
    assert.equal(g.floorRelics, 0);
    assert.equal(g.player.forgedBlade, true);
    assert.equal(g.loot.filter(l => l.type === "hourglass").length, 1);
    starts.add([...g.floor].join(","));
    const clock = 100_000 * i;
    startClock(g, clock);
    assert.equal(g.deadline, clock + 60_000);
    g.enemies = [];
    g.floorRelics = 2;
    g.player.relics += 2;
    finish(g);
    assert.equal(g.cleared, i + 1);
    assert.equal(g.relicPairs, i + 1);
    assert.equal(g.status, i === 3 ? "won" : "stairs");
    assert.equal(tickClock(g, clock + 90_000), false);
    assert.equal(act(g, 0), false);
    if (i < 3) {
      const { hp, gold, relics } = g.player, turns = g.turn;
      g = nextFloor(g);
      assert.deepEqual([g.player.hp, g.player.gold, g.player.relics, g.turn], [hp, gold, relics, turns]);
      assert.deepEqual([g.player.x, g.player.y], [START.x, START.y]);
      assert.equal(rerollStats(g), false);
    }
  }
  assert.equal(starts.size, 4);
  assert.equal(nextFloor(g), null);
  assert.equal(createExpedition(7, "debug", "sand").floorCount, 1);
});

test("debug can select all four visual themes without changing the generated layout", () => {
  const seeds = Array.from({ length: 32 }, (_, seed) => createGame(seed).biome);
  assert.equal(new Set(seeds).size, 4);
  const layouts = ["stone", "overgrown", "flooded", "sand"].map(theme => {
    const g = createGame(7, "debug", theme);
    assert.equal(g.biome, theme);
    return [...g.floor];
  });
  for (const layout of layouts) assert.deepEqual(layout, layouts[0]);
});

test("converting a paused run to Debug stops its clock and makes the player invulnerable", () => {
  const { enableDebug } = require("../game.js");
  const g = createGame(7);
  const { x, y } = g.player;
  startClock(g, 1_000);
  assert.equal(enableDebug(g), false);
  assert.equal(pauseGame(g, 51_000), true);
  g.player.hp = 1;
  assert.equal(enableDebug(g), true);
  assert.equal(g.mode, "debug");
  assert.equal(g.player.hp, g.player.maxHP);
  resumeGame(g, 100_000);
  assert.equal(g.deadline, null);
  assert.equal(tickClock(g, 900_000), false);
  g.enemies = [{ x: x + 1, y, type: "beetle", hp: 2 }];
  act(g, "wait");
  assert.equal(g.player.hp, g.player.maxHP);
  assert.equal(g.status, "playing");
});

test("the timed maze has one hourglass that grants ten seconds once", () => {
  const g = createGame(7);
  const items = g.loot.filter(item => item.type === "hourglass");
  assert.equal(items.length, 1);
  g.enemies = [];
  startClock(g, 1_000);
  tickClock(g, 56_000);
  assert.equal(g.secondsLeft, 5);
  travel(g, items[0]);
  assert.equal(g.secondsLeft, 15);
  assert.equal(g.deadline, 71_000);
  assert.equal(g.loot.some(item => item.type === "hourglass"), false);
  assert.equal(popups(g).at(-1).amount, 10);
  assert.equal(popups(g).at(-1).unit, "sec");
  assert.equal(tickClock(g, 61_000), false);
  assert.equal(tickClock(g, 71_000), true);
});

test("reaching the gate before zero stops the clock", () => {
  const g = createGame(7);
  startClock(g, 1_000);
  tickClock(g, 50_000);
  finish(g);
  assert.equal(g.status, "won");
  assert.equal(tickClock(g, 66_000), false);
  assert.equal(g.secondsLeft, 11);
});
