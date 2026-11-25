const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createGame } = require("../game.js");
const { openProfile, RELIC_PAIR_BONUS, summarizeRun } = require("../profile.js");

function memoryStorage() {
  const cache = new Map();
  return { getItem: name => cache.get(name), setItem: (name, value) => cache.set(name, value) };
}

test("saves avatar, sound and motion when the profile is reopened", () => {
  const storage = memoryStorage(), profile = openProfile(storage);
  assert.equal(profile.settings.avatar, "knight");
  profile.update({ avatar: "ranger", sound: false, reducedMotion: true });
  assert.deepEqual(openProfile(storage).settings, { avatar: "ranger", dice: "parchment", sound: false, reducedMotion: true });
});

test("only an escape banks earned gold, and cosmetic unlocks persist", () => {
  const storage = memoryStorage(), profile = openProfile(storage);
  const g = createGame(10);
  assert.equal(profile.bank, 0);
  assert.equal(profile.purchase("avatar", "sentinel"), "short");
  assert.equal(profile.update({ dice: "jade" }).dice, "parchment");
  g.player.gold += 44;
  g.status = "expired";
  profile.record(g, "knight");
  assert.equal(profile.bank, 0);
  g.status = "won";
  profile.record(g, "knight");
  assert.equal(profile.bank, 44);
  assert.equal(profile.purchase("avatar", "sentinel"), "bought");
  assert.equal(profile.purchase("dice", "jade"), "bought");
  assert.equal(profile.purchase("dice", "jade"), "owned");
  assert.equal(profile.bank, 4);
  profile.update({ avatar: "sentinel", dice: "jade" });
  const reopened = openProfile(storage);
  assert.ok(reopened.owns("avatar", "sentinel"));
  assert.ok(reopened.owns("dice", "jade"));
  assert.equal(reopened.settings.avatar, "sentinel");
  assert.equal(reopened.settings.dice, "jade");
  assert.equal(reopened.bank, 4);
});

test("practice grants neither rank, history nor bank gold", () => {
  const profile = openProfile(memoryStorage());
  const g = createGame(7, "practice");
  g.status = "won";
  g.player.gold += 23;
  g.player.relics = 2;
  assert.equal(summarizeRun(g, "knight").gold, 23);
  assert.equal(summarizeRun(g, "knight").relicBonus, 0);
  assert.equal(profile.record(g, "knight"), null);
  assert.equal(profile.bank, 0);
  assert.deepEqual(profile.best(), []);
  assert.deepEqual(profile.recent(), []);
});

test("Debug wins never enter history or bank gold", () => {
  const profile = openProfile(memoryStorage());
  const g = createGame(7, "debug", "sand");
  g.status = "won";
  g.player.gold += 40;
  g.player.relics = 2;
  assert.equal(summarizeRun(g, "knight").relicBonus, 0);
  assert.equal(profile.record(g, "knight"), null);
  assert.deepEqual(profile.recent(), []);
  assert.equal(profile.bank, 0);
});

test("both relics add a persistent bonus only on timed escapes", () => {
  const storage = memoryStorage(), profile = openProfile(storage);
  const g = createGame(7);
  g.player.relics = 2;
  g.status = "lost";
  assert.deepEqual([summarizeRun(g, "mage").score, summarizeRun(g, "mage").relicBonus], [300, 0]);
  g.status = "won";
  g.secondsLeft = 12;
  const run = profile.record(g, "mage", 1000);
  assert.equal(run.score, 300 + 500 + 60 + RELIC_PAIR_BONUS);
  assert.equal(openProfile(storage).best()[0].relicBonus, RELIC_PAIR_BONUS);
});

test("only the final escape banks gold and awards completed relic pairs", () => {
  const { createExpedition } = require("../game.js");
  const profile = openProfile(memoryStorage());
  const g = createExpedition(17, "timed");
  g.player.gold += 20;
  g.player.relics = 5;
  g.relicPairs = 2;
  g.cleared = 3;
  g.status = "stairs";
  assert.equal(profile.record(g, "mage"), null);
  assert.equal(profile.bank, 0);
  g.status = "expired";
  const loss = summarizeRun(g, "mage");
  assert.deepEqual([loss.cleared, loss.relics, loss.relicBonus], [3, 5, 0]);
  g.status = "won";
  const win = profile.record(g, "mage");
  assert.deepEqual([win.cleared, win.relics, win.relicBonus], [4, 5, 500]);
  assert.equal(profile.bank, 20);
});

test("scores exclude starting gold and rank escapes, while recent runs keep their original order", () => {
  const storage = memoryStorage(), profile = openProfile(storage);
  const won = createGame(17), expired = createGame(2);
  assert.equal(profile.record(won, "mage"), null);
  won.status = "won";
  won.player.gold += 10;
  won.player.relics = 1;
  won.player.kills = 2;
  won.secondsLeft = 20;
  expired.status = "expired";
  expired.secondsLeft = 0;
  assert.equal(profile.record(won, "mage", 1000).score, 850);
  assert.equal(profile.record(expired, "knight", 2000).score, 0);
  const reopened = openProfile(storage);
  assert.deepEqual(reopened.best().map(r => r.outcome), ["won", "expired"]);
  assert.deepEqual(reopened.recent().map(r => r.outcome), ["expired", "won"]);
  assert.equal(reopened.best()[0].gold, 10);
  assert.equal(reopened.best()[0].avatar, "mage");
});

test("the best score survives even after the run leaves the recent history", () => {
  const storage = memoryStorage(), profile = openProfile(storage);
  const g = createGame(7);
  g.status = "won";
  profile.record(g, "knight", 1);
  g.status = "lost";
  for (let i = 2; i <= 70; i++) profile.record(g, "knight", i);
  const reopened = openProfile(storage);
  assert.equal(reopened.recent().length, 60);
  assert.equal(reopened.recent().some(run => run.outcome === "won"), false);
  assert.equal(reopened.best().length, 10);
  assert.equal(reopened.best()[0].outcome, "won");
});

test("unavailable or malformed storage does not break a run", () => {
  const profile = openProfile({
    getItem: () => '{"settings":{"avatar":{"toString":null,"valueOf":null}},"runs":[null,{"outcome":"?"}]}',
    setItem() { throw new Error("storage disabled"); },
  });
  assert.equal(profile.settings.avatar, "knight");
  assert.deepEqual(profile.recent(), []);
  assert.equal(profile.update({ avatar: "scout" }).avatar, "scout");
  const game = createGame(22);
  game.status = "lost";
  assert.equal(profile.record(game, "scout").outcome, "lost");
  assert.equal(profile.recent().length, 1);
});
