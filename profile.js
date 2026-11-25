(function (root) {
  "use strict";

  const STORAGE_KEY = "underways.profile.v1";
  const MAX_RUNS = 60;
  const MAX_SCORES = 10;
  const RELIC_PAIR_BONUS = 250;
  const AVATARS = {
    knight: { name: "Knight", sprite: [1, 8] },
    mage: { name: "Mage", sprite: [0, 7] },
    ranger: { name: "Ranger", sprite: [4, 9] },
    scout: { name: "Scout", sprite: [2, 8] },
    wanderer: { name: "Wanderer", sprite: [4, 8] },
    sentinel: { name: "Sentinel", sprite: [1, 7], price: 25 },
    mystic: { name: "Mystic", sprite: [3, 8], price: 40 },
    sellsword: { name: "Sellsword", sprite: [2, 7], price: 18 },
    sage: { name: "Silver Sage", sprite: [3, 7], price: 32 },
    torchbearer: { name: "Torchbearer", sprite: [4, 7], price: 45 },
    duskblade: { name: "Duskblade", sprite: [1, 8], price: 65, filter: "hue-rotate(120deg) saturate(1.5)" },
  };
  const DICE_STYLES = {
    parchment: { name: "Parchment dice" },
    jade: { name: "Jade dice", price: 15 },
    ember: { name: "Ember dice", price: 30 },
    frost: { name: "Frost dice", price: 22 },
    amethyst: { name: "Amethyst dice", price: 36 },
    obsidian: { name: "Obsidian dice", price: 55 },
  };
  const CATALOG = { avatar: AVATARS, dice: DICE_STYLES };
  const OUTCOMES = { won: "Escaped", lost: "Fell in battle", expired: "Time expired" };
  const avatar = key => typeof key === "string" && Object.hasOwn(AVATARS, key) ? key : "knight";
  const whole = (value, limit = 1000000) => Number.isFinite(value) ? Math.min(limit, Math.max(0, Math.floor(value))) : 0;
  function item(kind, id) {
    if (typeof kind !== "string" || typeof id !== "string" || !Object.hasOwn(CATALOG, kind)) return null;
    return Object.hasOwn(CATALOG[kind], id) ? CATALOG[kind][id] : null;
  }

  function normalizeSettings(raw, owns) {
    return {
      avatar: owns("avatar", raw?.avatar) ? raw.avatar : "knight",
      dice: owns("dice", raw?.dice) ? raw.dice : "parchment",
      sound: raw?.sound !== false,
      reducedMotion: raw?.reducedMotion === true,
    };
  }

  function scoreRun(run) {
    return run.gold * 5 + run.relics * 150 + run.kills * 25 +
      (run.outcome === "won" ? 500 + run.secondsLeft * 5 + run.relicBonus : 0);
  }

  function normalizeRun(raw) {
    if (typeof raw?.outcome !== "string" || !Object.hasOwn(OUTCOMES, raw.outcome)) return null;
    const run = {
      outcome: raw.outcome, avatar: avatar(raw.avatar), gold: whole(raw.gold),
      floorCount: raw.floorCount === 4 ? 4 : 1,
      relics: whole(raw.relics, raw.floorCount === 4 ? 8 : 2), kills: whole(raw.kills), turns: whole(raw.turns),
      secondsLeft: whole(raw.secondsLeft, 70), at: whole(raw.at, 8640000000000000),
    };
    run.cleared = run.outcome === "won" ? run.floorCount : whole(raw.cleared, run.floorCount - 1);
    run.relicBonus = run.outcome === "won" && Number.isInteger(raw.relicBonus / RELIC_PAIR_BONUS)
      ? whole(raw.relicBonus, Math.floor(run.relics / 2) * RELIC_PAIR_BONUS) : 0;
    return { ...run, score: scoreRun(run) };
  }

  function summarizeRun(game, currentAvatar, now = Date.now()) {
    return normalizeRun({
      outcome: game.status, avatar: currentAvatar,
      gold: game.player.gold - game.rolls.gold.reduce((sum, die) => sum + die, 0),
      relics: game.player.relics, kills: game.player.kills, turns: game.turn,
      secondsLeft: game.secondsLeft, at: now,
      floorCount: game.floorCount, cleared: game.cleared,
      relicBonus: game.mode === "timed" ? RELIC_PAIR_BONUS * (game.floorCount === 4 ? game.relicPairs : Number(game.player.relics === 2)) : 0,
    });
  }

  function openProfile(storage) {
    let raw;
    try { raw = JSON.parse(storage?.getItem(STORAGE_KEY)); } catch { /* start with defaults */ }
    let bank = whole(raw?.bank);
    const unlocks = {};
    for (const kind of Object.keys(CATALOG)) {
      unlocks[kind] = new Set((Array.isArray(raw?.unlocks?.[kind]) ? raw.unlocks[kind] : [])
        .filter(id => item(kind, id)?.price));
    }
    function owns(kind, id) {
      const entry = item(kind, id);
      return !!entry && (!entry.price || unlocks[kind].has(id));
    }
    let settings = normalizeSettings(raw?.settings, owns);
    let runs = Array.isArray(raw?.runs)
      ? raw.runs.map(normalizeRun).filter(Boolean).sort((a, b) => b.at - a.at).slice(0, MAX_RUNS) : [];
    const ranked = entries => [...entries].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, MAX_SCORES);
    let highScores = ranked(Array.isArray(raw?.highScores) ? raw.highScores.map(normalizeRun).filter(Boolean) : runs);
    function save() {
      const unlocked = Object.fromEntries(Object.entries(unlocks).map(([kind, ids]) => [kind, [...ids]]));
      try { storage?.setItem(STORAGE_KEY, JSON.stringify({ settings, runs, highScores, bank, unlocks: unlocked })); } catch { /* keep this session usable */ }
    }
    return {
      get settings() { return { ...settings }; },
      get bank() { return bank; },
      owns,
      update(changes) {
        settings = normalizeSettings({ ...settings, ...changes }, owns);
        save();
        return { ...settings };
      },
      purchase(kind, id) {
        const entry = item(kind, id);
        if (!entry) return "invalid";
        if (owns(kind, id)) return "owned";
        if (bank < entry.price) return "short";
        bank -= entry.price;
        unlocks[kind].add(id);
        save();
        return "bought";
      },
      record(game, currentAvatar, now = Date.now()) {
        if (game.mode !== "timed") return null;
        const run = summarizeRun(game, currentAvatar, now);
        if (!run) return null;
        if (run.outcome === "won") bank = whole(bank + run.gold);
        runs = [run, ...runs].slice(0, MAX_RUNS);
        highScores = ranked([run, ...highScores]);
        save();
        return { ...run };
      },
      recent() { return runs.map(run => ({ ...run })); },
      best() { return highScores.map(run => ({ ...run })); },
    };
  }

  const api = { AVATARS, DICE_STYLES, OUTCOMES, RELIC_PAIR_BONUS, summarizeRun, openProfile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UnderwaysProfile = api;
})(globalThis);
