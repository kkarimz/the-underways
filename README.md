# The Underways

A turn-based 2D maze crawler. Every expedition generates new rooms, corridors, loops, enemies, and loot around a central starting room. One hidden exit can be reached by at least two independent routes. Two optional relics are guarded in dead-end treasure rooms. Orange spike plates mark short routes that cost 2 HP the first time you cross them. Both plates can be avoided by taking other routes. Stand on a blue wing rune to see an arrow pointing toward the gate. It disappears as soon as you step off.

## Play

Open `index.html` in a current browser on macOS or Windows. Keep the project files together. No internet, local server, or installation is needed for browser play.

- **WASD / arrows:** Move. A held key stops at enemies; press again to attack. Your hit and the enemy response play in order.
- **F:** Toggle fullscreen.
- **Esc:** Pause or resume; the pause menu also opens the Field Guide and Options.
- Walk over loot to collect it. Relics are optional; stepping onto the gate ends the expedition.

Choose your explorer at the start of each run, then press **Roll dice** to generate starting stats. Choose **Reroll stats** to try again without changing the maze, or press **Descend** to start. Once you descend, you have **60 seconds of real time** to reach the exit. The clock at the top center turns red and beeps every second from ten seconds down to one. If you die or time runs out, the debrief reveals the full maze and marks the exit, your starting point, and where the run ended.

Timed mazes have one glowing hourglass. Picking it up immediately adds **10 seconds**. Choose **Practice** on the opening screen for fresh mazes without a countdown or hourglass. Practice runs are not recorded for scores or history and cannot bank shop gold.

Expeditions descend through **Overgrown Ruins → Stone Keep → Flooded Crypt → Buried Temple**. Stairs down end floors 1–3; press **Descend** to start the next floor. Only floor 4 has the escape gate. HP, upgrades, and loot carry over, and the next timed floor starts with a fresh 60 seconds. Plants, water, and sand do not change movement. Standalone **Debug** lets you pick one floor, walk without a timer or damage, and toggle the full map. You can enable Debug during a regular expedition, which makes it permanently unranked.

Health is **10 + d6**, power is **2** (roll 1–3) or **3** (4–6), and starting gold is **2d6**. Expand **Starting dice** during play to review. Coin stashes and spare blades roll **d6 + 4**. Coin rolls flash on screen and stay in the field log. Defeating an enemy counts toward your score but never drops gold.

Floating numbers show actual HP lost or restored and the gold, power, or relics you gain.

Enemies act after you. Tonics heal up to 2 HP immediately on pickup and cannot be carried. A red health bar appears over your explorer at 30% HP or less.
Giant beetles move every turn, specters telegraph ranged bolts, ogres wind up before swinging, and goblin skirmishers retreat after a hit if they have room. A mimic looks like a normal treasure chest until you bump it, then opens its jaws before biting. Step out of the shot line or back away from a windup.

Open **Options** to change sound, reduced motion, and fullscreen. Opening it during a run pauses the expedition.

Open the **Field Guide** for controls, dungeon rules, and a bestiary with enemy HP, damage, and counterplay. The clock stays frozen while you read during a run.

An escape deposits the gold you found into your local bank. Deaths and timeouts never deposit gold, and starting gold can't be banked. The **Outfitter** is available from the result screen after any finished run and sells six extra explorers and five dice styles. Cosmetics never change your stats.

**Run history** saves the last 60 finished timed expeditions and the top 10 high scores on this device. Score is five points per gold earned in the maze, 150 per relic, and 25 per kill. The final escape adds 500 points plus five per second left on the final floor and **250 points per floor where you collected both relics**. Starting gold doesn't count.

## Desktop builds

Use Node.js 22.12 or newer. From the project directory:

```sh
npm ci
npm start          # Launch the desktop version locally
npm test
npm run package:mac
npm run package:win
```

The Mac command creates separate Apple silicon and Intel `.app` bundles in `dist/`. The Windows command builds a portable x64 folder; keep the whole folder together and open `The Underways.exe`. These are local builds, not signed or notarized public releases.

## Art

Tiny Dungeon, Monochrome RPG, and Minimap Pack by [Kenney](https://kenney.nl), CC0. Wing landmarks, dice faces, keyboard prompts, and the clock frame use selected art from Kenney's Roguelike Caves & Dungeons, Board Game Pack, Input Prompts Pixel 1-Bit, and UI Pack – Pixel Adventure. Original license notices are included in `assets/`.
Biome details use selected tiles from Kenney's Tiny Town, Roguelike Caves & Dungeons, and Desert Shooter Pack.

Pixelify Sans and Jersey 10 are bundled under the SIL Open Font License. Their license notices are also in `assets/`.
