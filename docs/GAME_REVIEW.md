# Game Production Review — Batch 1

**Date:** 2026-09-24  
**Games:** PONG, ARCHER, TANKS  
**Review type:** Code/gameplay audit plus automated baseline verification

## Executive summary

The first batch has a solid engine and transport foundation, but it is not production-ready yet because several match states can fail to resolve, fast projectiles can miss hits during frame hitches, and remote clients do not receive enough information to understand the complete game state.

The highest-value work is not a visual overhaul. It is:

1. Make every round and match terminate deterministically.
2. Make collision resolution independent of frame rate.
3. Make active protection and power-up state visible on host and phone.
4. Remove random outcomes from recovery paths.
5. Add engine-level regression tests; the current tests mostly validate packets, not gameplay.

### Baseline verification

- `npm test`: **44 passed**
- `npm run check`: **passed**
- `npm run build`: **passed**
- Interactive browser/device playtest: **not run** — no connected desktop browser/device was available in this environment.

The green baseline is useful, but the existing tests do not exercise PONG's match loop or the ARCHER/TANKS collision and round-transition logic.

## Severity

- **P0** — release blocker; crashes, corrupts authoritative state, or makes a match unplayable.
- **P1** — must fix before production; can cause wrong results, hidden state, unfair play, or indefinite matches.
- **P2** — important production-quality improvement; hurts fairness, feel, maintainability, or clarity.
- **P3** — polish or optimization.

---

## PONG

### PONG-01 — Anti-stall recovery can randomly decide a round

**Priority:** P1 · **Gameplay/fairness**

**Evidence:** `src/games/game.js:503-553`

When the ball is stalled, `breakStall()` selects a random active paddle and redirects the ball toward that paddle's own goal. This is a recovery mechanism, but it can award a goal without player skill and can decide a set.

**Impact**

- A deadlock can be resolved by an arbitrary RNG result.
- The result is difficult to explain to players.
- Replays and balance testing are non-deterministic.

**Recommendation**

Replace the random goal direction with a deterministic, visible recovery:

- prefer the side least recently involved in the rally;
- reset the ball to a neutral center lane;
- reduce speed temporarily and show a short recovery telegraph;
- never directly aim at a goal as the first rescue action;
- add a hard anti-stall round clock as the final safety net.

**Acceptance criteria**

- A stalled ball never awards a goal solely because of recovery RNG.
- Recovery behavior is deterministic for the same state and seed.
- A round cannot remain in `PLAYING` indefinitely.

### PONG-02 — Zero-active-player and forfeit outcomes are implicit

**Priority:** P1 · **State/lifecycle**

**Evidence:** `src/games/game.js:416-480`

When no active paddles remain, `update()` returns to `LOBBY` without recording a formal forfeit/abort result. When one active paddle remains, it calls `onPlayerScoredOn(-1)`, which infers the winner from the remaining-player count. These paths are not a single, explicit resolution contract.

**Impact**

- A disconnect or empty-slot edge case can skip result presentation.
- Stale round/match fields can survive a transition.
- The host and controller can disagree about whether a round ended or the room returned to lobby.

**Recommendation**

Create one explicit `resolveRound(reason, winner)` path with reasons such as `GOAL`, `LAST_STANDING`, `FORFEIT`, and `ABORT`. Reset all result state through that path and broadcast the same terminal state used by the renderer.

**Acceptance criteria**

- Zero, one, and multiple active players have deterministic outcomes.
- Disconnect/forfeit tests do not require a physics goal to finish a round.
- No `MATCH_OVER`/`ROUND_OVER` state leaks into `LOBBY`.

### PONG-03 — Normal bot error is not scale-invariant

**Priority:** P2 · **Balance/AI**

**Evidence:** `src/ai/pongAI.js:80-105`

The normal bot uses a fixed `(Math.random() - 0.5) * 32` pixel error. That is large on a small arena and negligible on a large one. It also has no reaction delay, angle error, or speed-dependent miss model.

**Impact**

Bot difficulty changes substantially between portrait, tablet, and TV layouts.
The bot can feel unfair at one viewport and too easy at another.

**Recommendation**

Express error as a fraction of paddle length/arena size, then add bounded reaction latency and angle error. Keep a deterministic seeded mode for balance tests.

**Acceptance criteria**

- A bot's difficulty changes by less than the chosen tolerance across supported aspect ratios.
- Normal and GOD tiers have documented, measurable performance targets.

### PONG-04 — Phone slider is visually horizontal for vertical paddles

**Priority:** P2 · **Controls/UX**

**Evidence:** `src/controllers/controllerTemplates.js:423-507` and `src/games/paddle.js:116-135`

P3 and P4 move along the vertical axis, but the phone controller always renders a horizontal track and maps horizontal thumb position to `position`. The instruction text changes to “down/up,” but the gesture surface does not.

**Impact**

Players can understand the rule and still push the paddle in the wrong direction, especially on small screens.

**Recommendation**

Either render a vertical track for side paddles or label the control explicitly as a normalized one-dimensional position control. Keep the same network contract, but make the physical gesture match the paddle axis.

**Acceptance criteria**

- A first-time player can map thumb direction to paddle movement without reading a long instruction.
- P1–P4 controller layouts are covered by a responsive UI smoke test.

### PONG-05 — No engine-level PONG regression suite

**Priority:** P1 · **Production QA**

**Evidence:** `tests/` has network/room tests but no PONG engine or pure match-logic test.

**Impact**

The most complex first game in the registry has no automated protection for goals, lives, set scoring, stall recovery, resize behavior, or bot tiers.

**Recommendation**

Extract deterministic match helpers or add a lightweight test harness for:

- goal and life accounting;
- set/match completion;
- zero/one/multiple active players;
- stall recovery;
- normal/GOD bot bounds;
- 120 Hz fixed-step behavior.

---

## ARCHER

### ARCHER-01 — Ties can produce an infinite match

**Priority:** P1 · **Gameplay/lifecycle**

**Evidence:** `src/games/archer.js:617-639`

If two or more players tie for the highest score, `handleRoundEnd()` sets no round winner and awards no round win. After the transition timer, `startRound()` starts another round. There is no tiebreak, overtime, or match-length limit.

**Impact**

Two evenly matched players can repeat 60-second rounds forever.
The match has no guaranteed production-safe ending.

**Recommendation**

Choose one explicit rule and expose it in the HUD:

- short overtime with a visible sudden-death condition;
- a deterministic tiebreak based on hits, accuracy, or damage;
- a shared round win with a clearly labeled draw state;
- a hard match timer with a final winner rule.

**Acceptance criteria**

- Every score distribution produces a terminal match state within a bounded number of rounds.
- Ties are visible and explained to all clients.

### ARCHER-02 — Arrow hits are vulnerable to frame-rate tunneling

**Priority:** P1 · **Physics/gameplay**

**Evidence:** `src/games/archer.js:412-435, 517-569`

The arrow position is advanced once per frame and collision is tested only at the new endpoint. The maximum arrow speed is `300 + 420 = 720 px/s`; with the 80 ms frame cap, one step can be 57.6 px. The hit diameter is only `2 * (18 + 6) = 48 px`.

The same endpoint test is used for obstacles.

**Impact**

A fast arrow can pass through a player or thin obstacle during a frame hitch or a slow mobile frame. The authoritative result then disagrees with what the player saw.

**Recommendation**

Use swept collision:

- segment-vs-circle for players;
- segment-vs-expanded-AABB for obstacles;
- speed-based substeps or a shared swept-collision helper;
- deterministic hit ordering when an arrow crosses multiple targets.

**Acceptance criteria**

- A simulated arrow crossing a target's hit volume always registers exactly once.
- The same test passes at 30, 60, 120, and a 100 ms hitch frame.
- Obstacles cannot be skipped because of a single long step.

### ARCHER-03 — Spawn protection and power-up state are invisible

**Priority:** P1 · **Fairness/UX/networking**

**Evidence:**

- `src/games/archer.js:207-224` sets `spawnProt = 1.0`.
- `src/games/archer.js:304-339` applies turbo, quickdraw, multi-shot, slip, and shield effects.
- `src/games/archer.js:517-569` makes arrows ignore protected players.
- `src/games/archerView.js:51-64` does not serialize protection or most power-up timers.
- `src/games/archerView.js:147-223` only visibly communicates charge, shield, and stun.

A player can be immune to arrows without seeing an immunity marker. Active turbo, quickdraw, multi-shot, and slip state has no reliable host or phone indicator.

**Impact**

- Hits appear to be ignored for no visible reason.
- Players cannot make informed decisions about when to engage or retreat.
- Remote clients cannot render the same tactical state as the host.

**Recommendation**

Add a single active-effect state model and expose it through the packet and HUD:

- visible spawn-protection ring/countdown;
- compact badges for TURBO, QUICKDRAW, MULTI, SLIP, and SHIELD;
- remaining duration or charges where relevant;
- identical host/world-view/controller representation.

**Acceptance criteria**

- A protected player is visually identifiable before the first arrow arrives.
- Every power-up has a visible active, charge-count, or expiry state on both host and phone.

### ARCHER-04 — AI shoots without checking line of fire or cover

**Priority:** P1 · **AI/gameplay**

**Evidence:** `src/ai/archerAI.js:7-85`

The bot chooses the nearest living opponent and immediately charges when the target is in range. It does not test obstacles, line of sight, expected target movement, or whether the current position has a firing lane.

**Impact**

- Bots waste the 0.8-second cooldown by firing into pillars.
- They hold an exposed position instead of repositioning.
- Bot behavior diverges sharply from human tactical play.

**Recommendation**

Add a small target-utility model:

- line-of-fire and obstacle-aware shot checks;
- lane quality and distance scoring;
- cover/reposition behavior when the lane is blocked;
- target movement prediction based on charge time;
- bounded reaction delay for the normal tier.

**Acceptance criteria**

- A bot does not intentionally release a shot with a known blocked lane.
- Normal and GOD bots have different, measurable positioning/accuracy profiles.

### ARCHER-05 — ARCHER has no controller status builder

**Priority:** P2 · **Controls/UX/networking**

**Evidence:** `src/controllers/controllerStatus.js:13-81` has no `ARCHER` entry, although the registry sends `timeLeft`, `chg`, and `cd` from `src/core/engineRegistry.js:194-200`.

**Impact**

The phone receives relevant data but does not present a consistent live status. Round time and charge readiness are not consistently visible outside the canvas.

**Recommendation**

Add an ARCHER status builder and keep it schema-driven: remaining time, charge percentage, cooldown, and active power-up badges. The world view may also carry a compact timer if the top status strip is not guaranteed to be visible.

**Acceptance criteria**

- An ARCHER controller shows time and charge state without opening a debug view.
- The status is covered by a controller snapshot test.

### ARCHER-06 — Resize resets moving-obstacle phase during a live round

**Priority:** P2 · **Responsive gameplay**

**Evidence:** `src/games/archer.js:79-102, 104-109`

Every resize calls `buildMap()`, which recreates obstacles and resets `mapTime`. A device rotation or browser resize can therefore move a live wall back to its initial phase while players and arrows are being remapped.

**Impact**

Cover changes unexpectedly during play, and a resize can alter fairness or cause a sudden blocked/clear shot.

**Recommendation**

Separate map allocation from map reset. On live resize, remap obstacle rectangles and preserve normalized phase; reset phase only when a new round starts.

**Acceptance criteria**

- A live resize does not reset moving-wall phase.
- Map phase is deterministic per round.

---

## TANKS

### TANKS-01 — “Sudden death” has no gameplay effect and rounds can stall forever

**Priority:** P1 · **Gameplay/lifecycle**

**Evidence:** `src/games/tanks.js:738-853, 1070-1081, 1127-1130`

`roundTimer` only changes movement speed after 35 seconds. The sudden-death label is rendered, but there is no shrinking arena, escalating rule, forced target, damage pressure, or hard round timeout. `handleRoundEnd()` runs only when one or fewer tanks remain. If two or more tanks avoid each other, the round never ends. If all tanks die together, a draw awards no score and the next round can repeat indefinitely.

**Impact**

- A match can run forever.
- The displayed “SUDDEN DEATH” state misrepresents the actual rules.
- Draw rounds can silently consume the entire session.

**Recommendation**

Implement a real sudden-death phase and a bounded resolution rule. Possible mechanics are arena closure, ammo drain, escalating ricochet damage, periodic shrinking walls, or a final duel. Define simultaneous-death and timeout behavior explicitly.

**Acceptance criteria**

- Every round has a maximum duration.
- Sudden death changes an observable gameplay rule.
- Simultaneous death and timeout produce a clear, tested result.

### TANKS-02 — Spawn intro is visual-only

**Priority:** P1 · **Fairness/controls**

**Evidence:** `src/games/tanks.js:614-623, 738-855, 1123-1125`

`spawnIntroTimer` is set to two seconds and used to draw beacons, but the update loop does not gate driving, firing, or AI. Players can move and shoot during the “intro,” and bots can act immediately.

**Impact**

The spawn beacon does not provide the protection or countdown it visually implies.
Early shots can decide a round before all players can react.

**Recommendation**

Use an explicit `INTRO`/`ROUND_PAUSE` phase or a `canAct()` guard. Keep the host authoritative, block remote/local actions until the phase ends, and show a synchronized countdown to all clients.

**Acceptance criteria**

- No tank can drive or fire during the intro.
- AI and human inputs obey the same phase gate.
- The phone receives the same phase/countdown state as the host.

### TANKS-03 — Bullet collision can tunnel at low frame rates

**Priority:** P1 · **Physics/gameplay**

**Evidence:** `src/games/tanks.js:738-740, 671-702, 929-1021`

Bullets move directly from their old position to `nextX, nextY` and are tested only at that endpoint. At 440 px/s and the 100 ms update cap, a bullet can move 44 px per update. The tank hit diameter is approximately `2 * (26 * 0.65) = 33.8 px`.

**Impact**

Fast rounds can contain hits that appear to connect visually but do not register, especially on mobile or after a background-tab hitch.

**Recommendation**

Use swept segment collision for tanks and obstacles, or substep bullets based on speed and collision radius. Resolve the nearest impact along the segment and keep ricochet count deterministic.

**Acceptance criteria**

- A bullet crossing a tank's hit volume always kills or shields exactly once.
- Hitches up to 100 ms do not change hit outcomes.
- Ricochets do not re-hit the same surface incorrectly.

### TANKS-04 — World snapshots truncate active bullets

**Priority:** P1 · **Networking/gameplay**

**Evidence:** `src/games/tanksView.js:47-51`

The packet slices bullets to 12. A tank can fire a three-projectile burst followed by a normal chamber shot, allowing up to four active bullets per tank; four tanks can therefore produce up to 16 bullets. The authoritative simulation keeps all of them, but the phone receives only the first 12.

A direct serializer check with 24 synthetic bullets returned 12 entries.

**Impact**

Remote players see an incomplete world and cannot understand why a shot disappeared or which shot caused a hit. This violates the intended full-world-view contract.

**Recommendation**

- Set the packet cap to the true gameplay maximum, or enforce that maximum in the simulation.
- Include a stable projectile ID if the client will interpolate or reconcile them.
- Add a regression test for triple-shot overflow across all four tanks.

**Acceptance criteria**

- No legal authoritative bullet set is silently omitted.
- Host and client bullet counts match within the documented frame boundary.

### TANKS-05 — Tank bodies can overlap with no separation rule

**Priority:** P2 · **Gameplay/readability**

**Evidence:** `src/games/tanks.js:874-927`

`checkTankCollision()` checks arena bounds and obstacles only. It never checks another tank. Two tanks can occupy the same space, especially during turbo or wall slides.

**Impact**

- It is unclear whether overlap is allowed, blocking, or a scoring event.
- Turbos can create unreadable visual stacking.
- Ricochet and bullet ownership become harder to reason about.

**Recommendation**

Either implement circle-vs-circle separation with a soft push, or explicitly make overlap a designed mechanic and communicate it clearly. The chosen rule must be consistent on host and phone.

**Acceptance criteria**

- A player can predict what happens when two tanks touch.
- No tank can become permanently stuck inside another.

### TANKS-06 — Bot ricochet reasoning ignores obstacles

**Priority:** P2 · **AI/gameplay**

**Evidence:** `src/ai/tankAI.js:20-85`

`hasLineOfSight()` checks obstacles, but `checkRicochetShot()` calculates a wall bounce from the arena edges without checking whether an obstacle blocks the pre-bounce or post-bounce path. The bot can select a ricochet that the real projectile cannot make.

**Impact**

The GOD tier appears intelligent but makes invalid tactical choices and may fire into cover.

**Recommendation**

Trace the actual projectile path against the same obstacle/bounce rules used by the simulation. Score candidate shots by hit probability, cover, distance, and escape value.

**Acceptance criteria**

- A proposed ricochet is accepted only when the simulated path can reach the target.
- Normal and GOD tiers use the same geometric truth with different decision quality.

### TANKS-07 — World-view bullets and tracers are not interpolated

**Priority:** P2 · **Network/game feel**

**Evidence:** `src/ui/gamepadWorldView.js:97-120` interpolates players and arrows only; `src/ui/tanksWorldView.js:34-46` renders position-only bullets/tracers directly from 30 Hz frames.

Fast tank bullets visibly step at the snapshot rate, and the lack of projectile IDs makes safe interpolation impossible when bullets are added or removed.

**Recommendation**

Either add a bounded projectile snapshot with stable IDs/velocities and interpolate it, or render short motion trails from the authoritative positions. Keep the 30 Hz bandwidth budget intact.

**Acceptance criteria**

- Fast projectiles read smoothly on a 60 Hz phone without extrapolating through walls.
- Packet loss still produces a safe snap/recovery rather than a ghost hit.

---

## Cross-cutting findings

### NET-01 — ARCHER and TANKS advertise `roundId` but never advance it

**Priority:** P1 · **Networking/state contract**

**Evidence:**

- `src/games/archerView.js:35` and `src/games/worldCore.js:61` serialize `roundId`.
- `src/ui/gamepadWorldView.js:105-112` uses `roundId` to decide whether interpolation may continue.
- Neither `src/games/archer.js` nor `src/games/tanks.js` initializes or increments `roundId`.

**Impact**

A client cannot reliably identify round boundaries from the snapshot contract. It currently relies on `gameState` changes as an accidental fallback, which is fragile for future instant-reset or reconnect paths.

**Recommendation**

Initialize `roundId` in each engine, increment it in `startRound()`, reset it only in `resetMatch()`, and add a serializer/engine regression test for every round transition.

### NET-02 — World-frame validation checks shape more than gameplay meaning

**Priority:** P2 · **Reliability/security**

**Evidence:** `src/games/archerView.js:85-105` and `src/games/worldCore.js:91-102` validate many numeric fields but do not consistently enforce positive arena dimensions, boolean `joined/alive`, finite scores, valid winner indices, or allowed game states.

**Impact**

A malformed but numerically plausible frame can reach the renderer and produce invalid score, winner, or visibility state. Existing packet tests focus on a few representative malformed fields rather than the full contract.

**Recommendation**

Make the world-frame validator a strict boundary: validate all gameplay-discrete fields, positive geometry, score ranges, winner indices, and state enums. Add fuzz-style malformed-frame tests.

### TEST-01 — Gameplay logic is under-tested relative to transport code

**Priority:** P1 · **Production QA**

The current suite has strong protocol, world-packet, WebRTC, and race-logic coverage, but no engine-level tests for PONG, ARCHER, or TANKS. The most expensive production risks are state transitions and collision behavior, and those are exactly what packet mocks do not exercise.

**Recommendation**

Add pure or lightly DOM-bound logic modules for match resolution, swept projectile collision, phase gates, and AI target selection. Keep the authoritative engine as a thin adapter over those modules.

---

## Recommended implementation order for Batch 1

1. **Safety and termination first**
   - explicit round-resolution states;
   - ARCHER tiebreak/overtime;
   - TANKS sudden-death and hard timeout;
   - spawn/intro phase gates;
   - `roundId` lifecycle.

2. **Frame-rate-independent combat**
   - swept arrow collisions;
   - swept tank-bullet collisions;
   - deterministic simultaneous-impact ordering;
   - regression tests at normal and hitch frame rates.

3. **State visibility and networking parity**
   - Archer protection/power-up fields and status;
   - complete tank projectile snapshots;
   - strict frame validation;
   - projectile interpolation strategy.

4. **Gameplay quality**
   - fair PONG stall recovery;
   - Archer line-of-fire AI;
   - Tanks tank separation and ricochet reasoning;
   - viewport-scaled bot tuning.

5. **Feel and accessibility**
   - clearer round/timer language;
   - consistent controller status for all three games;
   - responsive control orientation;
   - final multi-device playtest matrix.

## Required playtest matrix after implementation

- LOCAL: 2, 3, and 4 humans; bots mixed into each seat.
- TV_CONSOLE: host-only display, host as P1, and remote players.
- ONLINE: P2–P4 phone world views, reconnect, and stale-frame recovery.
- Viewports: portrait phone, landscape phone, 4:3 tablet, 16:9 TV.
- Match flows: normal win, draw, simultaneous death, forfeit, disconnect, return to lobby.
- Combat flows: low frame rate, missed world frames, rapid actions, power-up pickup, spawn protection.

## Implementation pass 1 — 2026-09-24

The first implementation pass completed the highest-risk items from this review:

- PONG now has explicit round resolution, a deterministic neutral stall recovery, a hard round limit, scaled normal-bot error, and vertical phone sliders for P3/P4.
- ARCHER now resolves score ties with a hit tiebreak and bounded draw outcome, uses swept arrow collision, exposes protection/power-up state, shows controller status, preserves moving-wall phase on resize, and uses line-of-fire AI checks.
- TANKS now has a real shrinking sudden-death hazard, hard timeout/draw handling, spawn-intro action gates, substepped projectile updates, stable projectile IDs/velocity snapshots, interpolation support, tank separation, complete legal burst packets, synchronized intro state, and obstacle-aware ricochet checks.
- World-frame validation now checks positive geometry, state enums, round IDs, scores, winners, and discrete player flags.
- Added `tests/firstBatchGameEngine.test.mjs` plus packet regressions for the new contracts. The full automated suite currently has 52 passing tests.

Remaining follow-up: the required multi-device/browser playtest matrix and any balance tuning informed by real matches.

---

# Game Production Review — Batch 2

**Date:** 2026-09-24
**Games:** BRUTAL BOMB, BRUTAL CURVE, BRUTAL SNAKE
**Review type:** Gameplay + technical audit with targeted measurements

## Executive summary

All three engines are structurally healthy: no crashes, no dead states, and BOMB's bot AI is the best-written decision code in the repository. The problem is different from Batch 1. These three games are **not yet fun at a fixed difficulty**, because several core rules currently reward the wrong thing:

1. BOMB's duel is solved — the carrier is the fastest entity, and a last-second pass is a guaranteed kill with zero counterplay.
2. CURVE's INVERT power-up does the opposite of its label for local players, and does nothing to the bots it visually affects.
3. CURVE and SNAKE both score the wrong axis: points come from other players dying, and the round winner receives nothing.
4. All three still resolve combat at the new position only, so the "don't cross the line" games can miss the one hit that matters.
5. Elimination means spectating. In BOMB the first victim watches 25-40 seconds; nobody is punished for being last.

The Batch 1 fixes (phase gates, swept collision, effect visibility, `roundId`, strict validation) were all applied **inside the three engines** rather than lifted into `BaseMiniGame`. They must be re-derived for these games, and that duplication is now the main tax on every future batch. See XX-01.

### Baseline verification

- `npm test`: **52 passed**
- `npm run check`: **passed**
- `npm run build`: **passed**
- Interactive browser/device playtest: **not run** — no connected browser or device in this environment.

Two measurements were taken with synthetic data in Node on a desktop CPU. They are relative indicators, not device numbers, and are labelled as such where used.

### Severity

Same scale as Batch 1 (P0 release blocker → P3 polish).

---

## BRUTAL BOMB

### BOMB-01 — The carrier wins the duel by construction

**Priority:** P1 · **Gameplay/balance**

**Evidence:** `src/games/bomb.js:687` (carrier `× 1.16`), `:374-387` (pass cooldown 1.6s, giver immunity 1.6s, escape boost 1.35×), `:699` (receiver stumble to `0.15` speed for 0.6s), `:43` (dash cooldown 2.2s), `:322-324`/`:450` (11s timer in the 2-player endgame).

The carrier moves at 203 px/s; every pursuer moves at 175 px/s. Fleeing players cannot outrun the carrier, and their dash buys ~79 px every 2.2 s — a net separation the carrier's own dash matches. In the final 1.6 s a pass cannot be returned (the giver is immune and the cooldown has not expired) and the receiver is pinned to 26 px/s. So the last pass before detonation is a guaranteed kill.

**Impact**

- The dominant strategy for the carrier is: run at the weakest runner, tag at t<1.6 s. It always works.
- The victim has no decision to make, so the elimination reads as arbitrary rather than earned.
- Geometry (pillars, ink) is the *only* defence, which reads as luck on maps with little cover.

**Recommendation**

- Make the carrier no faster than the field (0.95-1.00× base); the tension should come from being chased, not from chasing with immunity.
- Scale late-pass punishment to the giver, not only the receiver: shorten the receiver's stumble as the bomb time drops, or let a counter-pass land on a non-immune third player.
- Combine with BOMB-02 so a late pass into a crowded corner becomes risky for both parties.

**Acceptance criteria**

- A 2-player endgame is survivable by the chaser through movement alone at least half the time in a scripted or simulated trial.
- A last-second pass can fail or backfire; it is never a deterministic kill.

### BOMB-02 — The bomb has no blast radius

**Priority:** P1 · **Gameplay**

**Evidence:** `src/games/bomb.js:418-454` — `explodeCarrier()` sets `carrier.isAlive = false` and spawns cosmetic particles. No other entity is tested against the blast.

**Impact**

- Positioning has no meaning beyond "don't be the carrier". Players can safely camp shoulder-to-shoulder, and crowding is free.
- The 32 px kinetic push in `transferBomb()` (`:389-401`) is the only spatial consequence of contact, so the arena's cover layout barely matters.
- It is the structural reason BOMB-01 has no counterplay: killing has no cost.

**Recommendation**

Give the explosion a real radius (arena-scaled, e.g. `size × 0.14`) that eliminates or heavily disables anyone inside it, with a visible telegraph ring on host and phone before detonation. Then the interesting decisions appear naturally: the carrier must pass *from a safe distance*, the chaser must not cluster, and the last second becomes a gamble for both sides.

**Acceptance criteria**

- Standing adjacent to the carrier at detonation is a losing choice.
- The blast radius is drawn before the explosion, and is present in the world packet so remote seats see it.

### BOMB-03 — Eliminated players spectate for tens of seconds

**Priority:** P1 · **Party flow**

**Evidence:** `src/games/bomb.js:442-453`, `:457-475` — a round ends only when one player remains; each detonation re-arms the timer at 9-15 s. `targetScore = 3` at `:76`.

**Impact**

A 4-player round is three detonations, roughly 35-40 s. The first victim watches that entire period, up to ~2 minutes across a match. For a couch/TV party game that is the fastest possible way to lose a player to their phone.

**Recommendation**

Prefer a lives model over elimination: everyone stays on the field, each detonation costs the carrier one life (3 lives), and the last player with lives wins the set. A dead-but-playing alternative (respawn with a 2-3 s "bomb-shy" debuff and no pass ability) also removes the downtime. Whatever is chosen, the round must end in a bounded time (see BOMB-01) and the eliminated player must always have a role.

**Acceptance criteria**

- No player is without input for more than ~5 seconds in a 4-player match.
- Set length is bounded and stated in the HUD.

### BOMB-04 — Pass detection is position-only, so dash-throughs lose the bomb

**Priority:** P1 · **Physics/fairness**

**Evidence:** `src/games/bomb.js:768` (`dist < minDist` at the new position only), `:540` (dt capped at 0.05), `:696` (dash 360 px/s), `:239-241`/`:228` (radius ≥ 14, so `minDist ≈ 28 px`).

One dash frame moves 18 px; two opposing dashers close 36 px — more than the 28 px contact distance. The pair can swap places with no transfer, and the carrier dies alone.

**Recommendation**

Use the shared swept primitives already in the repo: `segmentCircleIntersection` or substepping via `getProjectileSubsteps` (the `src/games/tanks.js:9,1088` adoption from Batch 1). Resolve the nearest contact point along the step and run the transfer there.

**Acceptance criteria**

- A scripted head-on dash at 30, 60, 120 Hz and a 100 ms hitch always registers exactly one pass.

### BOMB-05 — Non-carriers have no bodies

**Priority:** P2 · **Gameplay depth**

**Evidence:** `src/games/bomb.js:754-787` — the collision loop only tests the carrier against everyone else. Two fleeing players pass straight through each other, yet `transferBomb` pushes the pair 32 px apart (`:389-401`).

**Recommendation**

Add soft circle-vs-circle separation for all pairs, as Batch 1 did for TANKS (TANKS-05). This gives the chasers a real tool — blocking, herding the carrier into a pillar, body-screening a friend — without touching the network contract.

**Acceptance criteria**

- Two players cannot occupy the same point during play.
- No player is wedged inside another or inside a pillar after separation.

### BOMB-06 — SLIP is a trap that always catches its own user

**Priority:** P2 · **Gameplay/balance**

**Evidence:** `src/core/pickupSystem.js:47-59` — `EFFECTS.SLIP` pushes a puddle at `p.x, p.y`, i.e. under the collector. `src/games/bomb.js:741-748` then tests every player against puddles with `dPuddle < radius + 16.5`, so at distance 0 the collector slips 1.3 s on the very next frame. `src/ai/bombAI.js:732-751` treats SLIP as a desirable bait and does not model the self-slip.

**Impact**

For the carrier, picking SLIP is close to a death sentence (1.3 s at low traction while the field converges). Bots deliberately run to it. The item is nominally a trap but functions as a self-inflicted debuff.

**Recommendation**

Drop the puddle behind the collector (offset by facing angle plus one radius) and give the owner a short puddle-immunity window. Add the puddle's owner to the world packet so remote seats can read who dropped it.

**Acceptance criteria**

- Collecting SLIP never slips the collector.
- A bot's decision to take SLIP has a stated expected value in a balance test.

### BOMB-07 — `roundId` is a literal zero and validation is bypassed

**Priority:** P2 · **Networking/state**

**Evidence:** `src/games/bombView.js:33` serialises `Number(game.roundId) || 0`, but `src/games/bomb.js` never declares `roundId` (only `snake.js:93,219,249` and Batch 1's engines do). `src/games/bombView.js:85-106` hand-rolls a validator that re-declares `round1`/`finite`/`winnerSlot` instead of using `worldCore.isValidWorldBase`, so it skips the `gameState` enum, arena positivity, score range and winner-index checks.

**Impact** — `src/ui/gamepadWorldView.js:131-138` snaps interpolation on a `roundId` change; for BOMB that boundary silently degrades to `gameState` inference. Malformed-but-plausible frames can still reach the renderer (NET-02, still open).

**Recommendation** — Own `roundId` in the engine (init in `resetMatch`, increment in `startNewRound`) and adopt `createWorldSnapshot` + `isValidWorldBase` the way `src/games/curveView.js:14-20,91,150` already does.

### BOMB-08 — The rules that decide lives are invisible on the phone

**Priority:** P2 · **UX/networking parity**

**Evidence:** `src/core/engineRegistry.js:139-144` sends `carrier`, `bombTime` and a `cd` percentage built from a hard-coded `2.2`; `src/controllers/controllerStatus.js:33-38` renders only carrier + time and **discards the `cd` array it is given**. The world packet carries positions only — `carrier`, immunity, stumble, turbo and slip state are not serialised, and `gamepadWorldView.js:126-150` blends `players[].x/y/angle` so the carrier marker steps at 30 Hz.

**Impact** — A remote seat cannot tell whether a pass is currently legal, whether the person it is chasing is immune, or how much dash it has left. That information decides who dies. This is ARCHER-03 from Batch 1, in a game where it matters more.

**Recommendation** — Serialise effect state, render the same badges on host and phone, and use the `BOMB_DASH_COOLDOWN` constant instead of the `2.2` literal in the registry.

### BOMB-09 — Normal and God bots are nearly the same driver

**Priority:** P2 · **AI/balance**

**Evidence:** `src/ai/bombAI.js:432-907` — the tier flag gates constants and a few optional branches (`:98-152`, `:554`, `:668`, `:719-723`), but both tiers share intercept prediction, pillar routing, cover selection (`:698-710`), ink avoidance and stuck recovery, and neither has reaction latency or aiming error. Compare `src/ai/curveAI.js:50-63`, which models a tier properly (`mistake`, `think`, `rays`, `deadEndCheck`).

**Recommendation** — Give `bot_normal` a reaction delay, an error band expressed as a fraction of arena size (the PONG-03 lesson from Batch 1), and reduced lookahead; keep God's geometry tricks. Extract the shared tuning into one `TIER` table.

### BOMB-10 — Lobby, i18n and single-source violations

**Priority:** P3 · **Conventions**

- `src/games/bomb.js:150-166` re-implements `cycleSlotType` (`src/core/BaseGame.js:131`) and drops bot persona name/colour sync and `isJoined` refresh.
- `:875-881` (`'+1 SET:'`, `'TOPLAM SET:'`) and `:45-51` (map names) bypass `t()` while the same file uses `t()` elsewhere.
- `:912` draws the raw `🗺️` emoji on the lobby map button; AGENTS.md §7/§8 require `src/core/tabletopIcons.js`.
- `:117-131` `getTabletopSchema()` is a second source of truth alongside `src/controllers/controlDefs.js:18`; it also duplicates `BOMB_DASH_COOLDOWN`.
- `:93` `pickupSpawnTimer` is never reset, so the first pickup of a match inherits the previous match's countdown.
- Dead imports `:3`, `:19`, `:29` (`tickEffectTimers`, `advancePlayer` are imported but the logic is re-inlined at `:648-660` and `:736-738` — the exact copy-instead-of-import pattern AGENTS.md forbids).
- Three reset aliases (`:260`, `:281`, `:285`) and `startNewRound` vs `startRound` naming force per-engine aliases in the registry.

---

## BRUTAL CURVE

### CURVE-01 — INVERT is applied twice to humans and once to nobody

**Priority:** P0 · **Gameplay correctness**

**Evidence:** three inversion sites in `src/games/curve.js`:

- `:291-297` `onSlotSteer` — `steer = confused ? -dir : dir`
- `:475-483` keyboard/tabletop merge — `player.steer = confused ? -ks : ks` (overwrites the above)
- `:486-487` — `currentTurn = turnSpeed * (confused ? -1 : 1)`; `angle += steer * currentTurn * dt`

For a local or tabletop player the two negations cancel: **INVERT has no effect at all**. Remote phone input takes a different path (`:749-756`) that never negates `steer`, so remote seats get exactly one inversion from `:486` and **are** affected. Bots write `bot.steer` from raycasting (`src/ai/curveAI.js:159-173`) and are then mirrored by `:486`, so the item flips a bot's avoidance into steering into the wall it just rejected.

**Impact** — The same power-up is a no-op, a debuff, or a bot-kill switch depending on seat type. In ONLINE mode it punishes only the remote players, which reads as the host cheating.

**Recommendation** — Invert once, at the input-normalisation boundary, and never in the physics step. Decide explicitly whether bots should be affected: a clean rule is "confusion degrades bot steering quality" (raise `TIER.mistake`, shrink rays) rather than a hard mirror.

**Acceptance criteria**

- With INVERT active, a local human, a tabletop human and a remote human all turn the opposite way for the same thumb/key press.
- Bots under confusion degrade measurably and recover; they never drive into a raycast-confirmed wall.
- A regression test asserts the net sign for each of the three input paths.

### CURVE-02 — Points come from dying, the round winner gets nothing

**Priority:** P1 · **Gameplay/scoring**

**Evidence:** `src/games/curve.js:739-746` awards `+1` to every other living player on each death; `:758-762` `handleRoundEnd()` records a winner, awards nothing and never compares against `targetScore`.

**Impact**

- Points per round scale with player count: 2 players = 1 point/round, 3 = 3, 4 = 6. With `targetScore = 5` (`:47`) the same setting means a ~2-round match at 4 players and a ~5-round match at 2. There is no player-count normalisation anywhere in the file.
- The match can end *mid-round* (the check lives in `eliminatePlayer`), so the final round is abandoned part-way and the survivor's placement is never paid.
- `renderHUD` (`:953-974`) passes no `roundBannerTitle`/`Sub`/`Color`, so the 2.2 s ROUND_OVER screen never says who survived. BOMB at least banners it (`bomb.js:883-885`).

**Recommendation** — Pay placement at the round boundary (e.g. last-standing +3, then +2/+1 scaled by field size), resolve the match only between rounds, and show a round banner naming the survivor. Keep kill-adjacent awards if desired, but make the count player-count-normalised.

**Acceptance criteria**

- A 2-player and a 4-player match have the same expected length within one round.
- No match transitions to `MATCH_OVER` while players are still alive and moving.
- ROUND_OVER names the winner on host and phone.

### CURVE-03 — Heads tunnel across trails at exactly the speed that matters

**Priority:** P1 · **Physics/fairness**

**Evidence:** `src/games/curve.js:669-708` tests only the new head point; `:490-493` turbo is 1.5× on 160 px/s; `:409` caps dt at 0.08. A turbo frame advances 19.2 px against a hit diameter of ~9.6 px (`effectiveR = r + 1.8`), and the spatial query pad is 14 (`:688`) — smaller than the step.

**Impact** — In a game whose entire rule is "the line kills you", a hitch frame lets a head cross a wall for free. The authoritative result then contradicts what every client rendered.

**Recommendation** — Substep the integration with `getProjectileSubsteps` and test each swept sub-segment (Batch 1's `tanks.js:1088` pattern), or use `segmentCircleIntersection` against the trail. Raise the query pad to at least the maximum step.

**Acceptance criteria**

- A head crossing a trail registers once at 30/60/120 Hz and under a 100 ms hitch.
- `checkCollision` never returns false for a segment whose swept path crosses the head circle.

### CURVE-04 — Pickups ignore the ink field and the arena edges

**Priority:** P1 · **Gameplay**

**Evidence:** `src/games/curve.js:347-354` calls `spawnPickup` with no `obstacles`, and `src/core/pickupSystem.js:109` defaults to `game.pillars || game.obstacles || []` — CURVE has neither, so `pointBlocked` (`:130`) checks nothing. `:123-124` confines spawns to the central 70% of the arena. `:350-353` gives items a 14 s life with no despawn telegraph (`tickPickupTimers` `:187-199` silently deletes).

**Impact** — Items land on live trails, so collecting one can require a deliberate crash; the corners are structurally dead space, so the map contracts to a single contested middle; and items vanish without warning.

**Recommendation** — Exclude a corridor around all trails and the head positions, allow spawns across the arena with a margin, and blink items for the last ~2 s. Both this and BOMB's pickup placement belong in `spawnPickup` so every game inherits them.

### CURVE-05 — Remote steering has no dead-man and no release

**Priority:** P1 · **Controls/reliability**

**Evidence:** `src/games/curve.js:749-756` assigns `player.steer` and never decays it. SNAKE tracks `remoteSteerActive` (`snake.js:701-704`) and `src/core/slotManager.js:329` neutralises CURVE on disconnect, but nothing handles a *silent* controller — a phone that loses signal mid-turn keeps its ship turning in a circle until it dies. `src/controllers/controlDefs.js:81-82` already declares a neutral-latch payload for CURVE that the engine never consumes.

**Recommendation** — Stamp remote steer input with the host receive time and expire it after ~250 ms without a refresh; latch the declared neutral when the channel goes quiet. Same rule should be verified for SNAKE.

### CURVE-06 — The spawn beacon is decorative

**Priority:** P1 · **Fairness/controls**

**Evidence:** `src/games/curve.js:239` sets `spawnIntroTimer = 1.8`; `:416-418` only decrements it and `:949-951` draws beacons. Nothing gates movement, AI or input. At 160 px/s a player covers ~288 px before the beacon fades — well into the centre.

**Impact** — Identical to TANKS-02, which Batch 1 fixed with a phase gate. A player who taps at round start is already dead before the beacon finishes.

**Recommendation** — Reuse the Batch 1 gate rather than re-deriving it: an explicit `INTRO` phase or a `canAct()` guard that blocks local, remote and bot action, with the phase mirrored to clients. See XX-01.

### CURVE-07 — Bots share one colour and humans can lose theirs

**Priority:** P2 · **Readability/fairness**

**Evidence:** `src/games/curve.js:257` — `p.color = isBot ? '#8E8E93' : custom.color`. Two bots render identical grey trails, and there is no `CURVE_COLORS[i]` fallback when customisation returns no colour (`src/games/snake.js:204` has exactly that guard).

**Impact** — Trail ownership is the game's core information. Unreadable ownership, or a trail that falls back to the last `strokeStyle` (`:832-838`), means a player can die on a line they could not attribute.

**Recommendation** — Use persona colours for bots as SNAKE does, always fall back to `CURVE_COLORS[i]`, and label each head on both host and phone.

### CURVE-08 — SCISSORS rebuilds the trail array one splice at a time

**Priority:** P2 · **Performance**

**Evidence:** `src/games/curve.js:567-579` filters the whole segment array, then splices matched entries from the front in a loop. Synthetic Node measurement at the `SEG_MAX` cap (`:25`) of 24 000 segments: **9.3 ms** for one pick-up, plus the filter allocation. At 8 000 segments it is 1.3 ms; at 2 000 it is 0.1 ms. `SEG_MAX` is reachable at roughly 95 s of 4-player 60 Hz play (2.67 px per segment, 64 segments/s/player).

**Impact** — A mid-range phone at 5-8× the measured cost turns a power-up pickup into a 50-90 ms stall, i.e. a guaranteed dropped frame plus a dt-cap cascade, at the densest moment of the round. `spawnBombBlast` (`:379-386`) scans the full array too, but linearly, so it is far cheaper.

**Recommendation** — Rebuild once with a filter into a new array and mark the grid dirty (already done at `:579`), and prefer a per-owner index or run-length structure so removal is not proportional to the whole field.

### CURVE-09 — God-bot raycasting costs scale with the ink field

**Priority:** P2 · **Performance/AI**

**Evidence:** `src/ai/curveAI.js:9-47,57-62` — God thinks every 0.03 s over 200 px at 6 px steps with 7 rays, plus up to 13 gap-thread rays (`:139-145`) and a dead-end probe (`:168-176`). Synthetic Node measurement at 24 000 segments in an 800×600 arena (230 cells, ~104 segments per cell): **0.95 ms per God think ≈ 32 ms/s per God bot**; Normal is 0.29 ms per think ≈ 3 ms/s.

**Impact** — Desktop numbers, so read them as ratios: three God bots cost roughly ten times what three Normals cost, and the cost grows as the arena fills. On the host phone that is the worst possible moment.

**Recommendation** — Share rays between bots that think in the same window, clamp `maxDist` by the previous free distance, and drop `gapThread` sampling to a coarse pass then refine. Also worth asking the design question: is 200 px lookahead meaningful when the game is decided by the next turn?

### CURVE-10 — Host and phone draw the arena twice, and the trails do not interpolate

**Priority:** P2 · **Maintainability/network**

**Evidence:** `src/games/curve.js:781-839` inlines arena art in `render()`; `src/ui/curveWorldView.js:20-65` re-implements the same grid/frame for phones. BOMB and SNAKE instead share `draw*` functions with their view module (`bomb.js:30-37`, `snake.js:9-15`). The packet's `near` array is rebuilt back-to-front per owner (`curveView.js:71-90`), so index alignment between frames is not stable, and `gamepadWorldView.js:126-150` blends heads only — the lethal geometry visibly steps at 30 Hz. No `roundId` (BOMB-07 applies verbatim via `worldCore.js:61`).

**Recommendation** — Move host drawing into `curveView` draw functions (single source, per AGENTS.md §3), give segments stable ids or an ordered ring so they can be interpolated, and adopt the `roundId` lifecycle.

### CURVE-11 — The gap window is a random immunity, not an earned escape

**Priority:** P2 · **Gameplay clarity**

**Evidence:** `src/games/curve.js:452-466` opens a 0.16 s gap every ~2.4-4.6 s per player; `:680` returns "no collision" during it, and segments laid during it are permanently inert (`:505`, `:689`). The 0.4 s warning halo (`:913-921`) is drawn on the host canvas only and is absent from the world packet.

**Impact** — Surviving because a timer happened to open is indistinguishable, to the player who died, from a missed hit. Under turbo a gap also carves ~38 px of permanently harmless wall, which is a free tunnel through an opponent's trap. The mechanic softens the core rule instead of adding depth.

**Recommendation** — Either make it a charged resource the player triggers deliberately, or keep it automatic but (a) exclude gap segments from being a *safe* corridor for others, (b) telegraph it in the packet so all seats see the countdown, and (c) publish the state to the controller.

### CURVE-12 — Convention debt

**Priority:** P3 · **Conventions**

- Raw emoji in canvas text: `:583`, `:586`, `:602`, `:608` (`👻 ⚡ ❄️ 💣`) — AGENTS.md §7/§8 require `src/core/tabletopIcons.js`; `archerView.js:8` and others already use `drawTabletopIcon`.
- `applyPickup` (`:563-613`) re-declares `EFFECTS` values (ghost 4.0 / turbo 4.5 vs `pickupSystem.js:79,13` 4.0 / 3.5) instead of extending the registry; `collectPickups` already plays `playItemPickup()` (`:173`) and `:564` plays it again.
- `:711-713` is a vestigial `distToSegmentSquared` forwarder kept alive only because `curveAI.js:40` calls `game.distToSegmentSquared`; `curveAI.js:3` and `src/ai/snakeAI.js:3` each duplicate `physics2d.js:260`.
- Dead import `getQuadrant` (`:11`); `floatingTexts` is not initialised in the constructor (`:539`, `:360-370` guard it lazily); `startRound` (`:229`) has no minimum-player guard, unlike `bomb.js:296` and `snake.js:243`.
- `:254` adds a random angle offset per round, and gap timing is RNG — with no seed this cannot be balance-tested or replayed (XX-04).

---

## BRUTAL SNAKE

### SNAKE-01 — No round clock, and a mutual kill awards nothing

**Priority:** P1 · **Gameplay/lifecycle**

**Evidence:** `src/games/snake.js:589-592` ends a round only at `alive <= 1`; `:723-735` awards nothing when `winner` is null and `:447-452` starts another round. There is no timer, no shrink, no escalation (`grep roundTimer|matchTimer` → none).

**Impact** — Two careful snakes plus four foods can stall the round; a simultaneous death produces a silent, scoreless restart. Same shape as TANKS-01 and ARCHER-01 from Batch 1.

**Recommendation** — Add a round clock with a defined winner rule (longest snake, then food count, then index), and consider a real endgame pressure: an arena that closes or a speed ramp. Bound the round, explain the tie.

### SNAKE-02 — `scores[]` mixes sets won with fruit eaten

**Priority:** P1 · **Gameplay/scoring**

**Evidence:** `src/games/snake.js:727` adds a set point to the last survivor; `:553` adds a point for every GOLDEN_STAR eaten. Both write the same array, both are compared against `targetScore = 5` (`:87`). `foodCount` (`:553,558,563`) is tracked separately and never published.

**Impact** — A player can win the match purely by eating without ever surviving a round, and a player who wins three rounds outright can be overtaken by star farming mid-round. The HUD shows one number with two meanings, so no player can reason about the score.

**Recommendation** — Split `sets` (match) from `points` (round), display both, and use points as the tiebreak for SNAKE-01's clock. This is exactly the ARCHER-01 resolution Batch 1 chose.

### SNAKE-03 — Corpse fruit is dropped without validity checks

**Priority:** P1 · **Gameplay**

**Evidence:** `src/games/snake.js:679-685` drops up to 7 foods at raw body coordinates; the explicit-coordinate path in `spawnFood` (`:268-296`) skips the wall, control-box and body checks entirely. Drop count is constant regardless of how many snakes remain.

**Impact** — Fruit lands inside walls and under live tails, i.e. unreachable or lethal to collect — which reads as the game lying about a pickup. In a 4-player round, three cascading deaths add up to 21 extra items, so survivors hit `SNAKE_MAX_LEN` (`:27,540`) almost immediately and the length mechanic stops meaning anything for the rest of the round.

**Recommendation** — Route drops through the same validity sampler as normal spawns (walls, trail, control corners), scale the count by remaining players, and cap total live food.

### SNAKE-04 — The God snake bot does not exist

**Priority:** P1 · **AI/balance**

**Evidence:** `src/ai/snakeAI.js:53-101` never reads `bot.slotType`; there is one behaviour, one think interval (0.06 s) and one ray set (`:61-63`). Contrast `src/ai/curveAI.js:50-63`. The lobby offers a third tier (`slotTypes` `'bot_god'`, `snake.js:198-200` uses it only to pick a persona colour/name).

**Impact** — "GOD" is a label. Bots also have **no opponent model at all**: they never cut an opponent's path, which is how snake actually kills, and they greed food without checking the return route (`:82-96`).

**Recommendation** — Add a `TIER` table (think interval, ray count/angles, mistake rate, food priority, boost discipline) and an opponent-head term: threat avoidance at close range plus opportunistic cutting for God. Keep it fair — no speed or rule advantage, only decision quality.

### SNAKE-05 — Boost silently multiplies the turn radius, and the AI does not know

**Priority:** P1 · **Gameplay feel**

**Evidence:** `src/games/snake.js:527` speed × 1.65 with `turnSpeed` unchanged (`:205`) → minimum radius grows from ~41 px to ~68 px. `src/ai/snakeAI.js:94` boosts whenever `frontDist > 90` with no exit check, so bots routinely commit to a turn they cannot make. Nothing on the host or phone communicates the commitment; the 8 Hz packet sends `nrg`/`lock` (`engineRegistry.js:284-289`) and `controllerStatus.js:60-67` does show energy.

**Recommendation** — Either scale turn rate with speed so the radius is constant (a feel change, worth playtesting), or keep the physics and make it legible: draw the predicted turning arc while energy is above the lock threshold, and show "committed" on the controller during boost. Give the bot a lookahead that respects its boosted radius.

### SNAKE-06 — Trail hits are position-only, same as CURVE-03

**Priority:** P2 · **Physics**

**Evidence:** `src/games/snake.js:595-617` samples only the new head point; `:527` 231 px/s with the 0.08 dt cap (`:440`) → 18.5 px per step against an `(r + 3) = 8` radius, and the query pad is 12 (`:611`).

**Recommendation** — One shared swept-segment helper for CURVE and SNAKE, substepped with `getProjectileSubsteps`. Fixing them together is cheaper than twice.

### SNAKE-07 — A passing test locks in the weak frame contract

**Priority:** P2 · **Networking/tests**

**Evidence:** `src/games/snakeView.js:126-157` hand-rolls validation instead of `worldCore.isValidWorldBase`, and `tests/snakeWorldPacket.test.mjs:71-96` asserts that a frame **without** `roundId`, `gameState` or `scores` is valid. SNAKE is the only engine in this batch with a real `roundId` (`:93,219,249`) — and it is never validated, blended, or snapped on (`gamepadWorldView.js:131-138`).

**Recommendation** — Adopt `createWorldSnapshot`/`isValidWorldBase` and invert that assertion. Until the test changes, any hardening of the validator will look like a regression.

### SNAKE-08 — The lethal envelope does not match the drawn snake

**Priority:** P2 · **Fairness/readability**

**Evidence:** `src/games/snake.js:597` `r = 5` plus a fixed 3 px segment allowance (`:615`), while the body is drawn from its own width in `drawSnakePlayers`. The own-trail exemption is a time window (`:612`, 220 ms) rather than a distance, so the exempted *segment count* varies with frame rate even though the exempted distance stays ~31 px.

**Recommendation** — Derive the hit radius from the rendered body width and convert the grace to a distance-along-body (or segment count) exemption. Then a near-miss always looks like a near-miss.

### SNAKE-09 — Boost keys are undocumented and doubled

**Priority:** P2 · **Controls/UX**

**Evidence:** `src/games/snake.js:124-137` — `boost = boostKey || up || down`, so W/S (P1) and ↑/↓ (P2) are boost, while the guide at `:757-760` says `[WASD/SPACE]`. In a game where boosting multiplies the turn radius (SNAKE-05), an unannounced boost key is an unannounced death sentence.

**Recommendation** — State the real mapping in the guide and on the control overlay; drop the undocumented up/down aliases or label them.

### SNAKE-10 — Shared-module drift and dead paths

**Priority:** P3 · **Conventions**

- `:619-626` re-implements `physics2d.js:143` inline; the call at `:614` uses the import, so the method exists only for `snakeAI.js:45`. Direct AGENTS.md §8 violation.
- SNAKE imports none of `arenaKit`, `pickupSystem` or `playerEntity` (`:1-18`), while `SNAKE_MAPS` `'pillars'` and `'cross'` (`:38-63`) duplicate `arenaKit.buildLayout` presets that BOMB already calls by name (`bomb.js:219-223`).
- `:694` handles a `'SNAKE_DIR'` action no controller emits; `keyboardInput` always returns `targetAngle: null` (`:136`), making the branches at `:470` and `:511-522` unreachable from the keyboard.
- `initKeyboard` (`:105-122`) bypasses `bindStandardKeyboard` (`BaseGame.js:218`), so it loses the base's `preventDefault` and blur guards.
- Raw glyphs: `'◀'`/`'▶'`/`'🚀'` in `getTabletopSchema` (`:360-376`), `'★'`/`'⚡'` in `snakeView.js:228,241`; `:298` and `:302-303` put emoji in code comments as design shorthand.
- Dead import `getQuadrant` (`:17`); `SNAKE_NAMES` exported but unused in-file.

---

## Cross-cutting findings

### XX-01 — Batch 1's fixes were never lifted into `BaseMiniGame`

**Priority:** P1 · **Architecture**

Verified by a full method scan of `src/core/BaseGame.js`: there is **no** `resolveRound(reason, winner)`, no `INTRO`/`canAct()` phase gate, no round clock, no `roundId` field, no forfeit/timeout helper. Every Batch 1 fix for those concerns lives inside `game.js`, `archer.js` and `tanks.js`. That is why BOMB-01/03, CURVE-02/06 and SNAKE-01/02 are all still open: each engine re-invents round resolution and each gets it subtly wrong.

Eight more games are waiting behind this batch. Lift three things into `BaseMiniGame` now and migrate these three engines onto them as the proving ground:

1. `beginRound()` / `endRound(reason, winner)` with an explicit reason enum and a match-termination check in one place;
2. a phase gate (`canAct()`) that blocks local, remote and bot action during intro/countdown;
3. a round clock with a declarative per-game limit and winner rule.

### XX-02 — Swept collision exists but only two engines use it

**Priority:** P1 · **Physics**

`physics2d.js:155,185,250` provide `segmentCircleIntersection`, `segmentAabbIntersection` and `getProjectileSubsteps`; adoption is limited to ARCHER and TANKS (`GAME_REVIEW` Batch 1). BOMB (pass), CURVE (head-vs-trail) and SNAKE (head-vs-trail) all still resolve at the new position only, and all three are games where a single missed contact decides a life. BOMB-04, CURVE-03, SNAKE-06 should be one change against one shared helper.

### XX-03 — `roundId` is real in three engines and a literal zero elsewhere

**Priority:** P1 · **Networking** (NET-01, still open)

Only `archer.js`, `tanks.js` and `snake.js` own the field. BOMB and CURVE serialise `0`, so `gamepadWorldView.js:131-138` silently falls back to `gameState` for round boundaries in six more games. Fixing this in the base class (XX-01) closes it for the whole registry.

### XX-04 — Match-critical randomness is unseeded, so balance work cannot be tested

**Priority:** P2 · **QA/design**

Carrier choice and map choice (`bomb.js:304,320,448,567`), gap timing and spawn offsets (`curve.js:254,267,457`), and food type and placement (`snake.js:273-304`) all call `Math.random()` directly. Batch 1 asked for deterministic regression tests; without a seeded RNG injected through the engine, no test can reproduce "the same match" and no balance change can be measured. This blocks BOMB-01/09, CURVE-02 and SNAKE-04 verification.

### XX-05 — Only CURVE uses the shared world-core contract

**Priority:** P2 · **Networking/security** (NET-02, still open)

`curveView.js:14-20` uses `createWorldSnapshot`/`isValidWorldBase`; `bombView.js:10-16,85-106` and `snakeView.js:9-10,126-157` re-declare the same primitives and skip the state enum, arena positivity, score range, winner index and discrete flag checks. SNAKE's own test asserts the weak behaviour (SNAKE-07).

### XX-06 — Two sources of truth for the phone controls

**Priority:** P2 · **Conventions**

AGENTS.md §7 makes `CARTRIDGES[MOD].schema` declarative, yet BOMB (`bomb.js:117-131`), CURVE (`:282-289`) and SNAKE (`snake.js:360-376`) each also expose a `getTabletopSchema()` on the engine, duplicating `controllers/controlDefs.js:14-29` — including a second copy of BOMB's 2.2 s cooldown and `⚡`/`◀`/`▶` icon keys that only resolve through `tabletopIcons.js` aliases. Worse, `src/core/engineRegistry.js:139-144` hard-codes `/ 2.2` and `controllerStatus.js:33-38` **discards the `cd` array it receives**, so the phone shows no dash readiness. Pick one source and delete the other.

### XX-07 — Emoji in canvas and status UI

**Priority:** P2 · **Conventions/visual consistency**

`curve.js:583,586,602,608` draw raw emoji as canvas text, `bomb.js:912` on a lobby button, `snakeView.js:228,241` in-world, and `controllerStatus.js:15,23,27,71` in the status strip. `archerView.js:8`, `heistView.js:8` and `collapseView.js:8` already go through `drawTabletopIcon`. These three games are the visible holdouts.

### XX-08 — Test coverage is transport-shaped, gameplay-blind

**Priority:** P1 · **QA** (TEST-01, still open)

The `firstBatchGameEngine.test.mjs` harness (Proxy 2D context, fake canvas/window/document, engine loaded through a live Vite SSR server, then `game.update(ms)` called directly) is exactly the right tool — and it is used for PONG/ARCHER/TANKS only. The three tests for this batch (`bomb/curve/snake WorldPacket.test.mjs`) build plain-object fakes and never import an engine. Nothing currently covers: round/match resolution, bomb transfer and immunity, trail collision or tunneling, pickup application, boost economy, `startRound` guards (missing entirely in `curve.js:229`), mid-match resize remap, remote input per action, or bot tiers. CURVE-01 and CURVE-02 are the kind of bugs a single engine test each would have caught.

**Recommendation** — Create `tests/secondBatchGameEngine.test.mjs` on the existing harness, one describe block per game, and add it to `package.json`'s `test` script.

---

## Implementation plan — first three games

Ordered so each wave leaves the build green and each later wave is testable. Wave 1 and 2 are the "make it correct and fair" work; wave 3 is the "make it fun" work that depends on 1-2 being stable.

### Wave 0 — Base-class groundwork (XX-01, XX-03, XX-04)

1. Add `beginRound`/`endRound(reason, winner)`, `canAct()` phase gate and a declarative round clock to `BaseMiniGame`.
2. Own `roundId` in the base: init in `resetMatch`, increment in `beginRound`.
3. Inject a seeded RNG (engine-level, defaulting to time-seeded) and route every `Math.random()` call in the three games through it.
4. Add `tests/secondBatchGameEngine.test.mjs` skeleton on the existing harness and wire it into `npm test`.

*Exit:* PONG/ARCHER/TANKS still pass unchanged (opt-in API), and one trivial test drives a fake round to completion.

### Wave 1 — Correctness bugs (highest severity, lowest design risk)

1. **CURVE-01** INVERT single-inversion fix + a sign regression test for local / tabletop / remote / bot.
2. **CURVE-05** remote steer dead-man + neutral latch; verify the equivalent for SNAKE.
3. **BOMB-06** SLIP owner grace and drop-behind placement.
4. **CURVE-07 / SNAKE-07 / BOMB-07** colour fallbacks, `roundId` ownership, `isValidWorldBase` adoption; invert the SNAKE test assertion.
5. **XX-06** collapse the duplicate schema source of truth; make `controllerStatus` use the `cd` field it already receives.

*Exit:* four-player ONLINE matrix for the three modes, and `npm test`/`check`/`build` green.

### Wave 2 — Contact fairness (XX-02)

1. One shared swept-contact helper for line-following games, adopting `getProjectileSubsteps`.
2. Apply to **CURVE-03**, **SNAKE-06**, and the **BOMB-04** pass check.
3. Tests: contact registers once at 30/60/120 Hz and under a 100 ms hitch, for each of the three games.
4. **SNAKE-08** hit envelope derived from drawn width; distance-based neck grace.

### Wave 3 — Game rules and scoring (the fun layer)

1. **CURVE-02 + SNAKE-02** scoring rebuild on the Wave 0 round API: placement awards resolved between rounds; sets and points separated and both shown; round banner for CURVE.
2. **BOMB-01 + BOMB-02** carrier speed, late-pass counterplay, and blast radius with a pre-detonation telegraph — decided together, since the radius is what makes the speed change interesting.
3. **BOMB-03** downtime model (lives vs elimination) — needs a design decision from you before implementation.
4. **SNAKE-01** round clock + tie rule + one escalation, **CURVE-04** pickup placement/expiry, **SNAKE-03** corpse-food validation.
5. **CURVE-06** spawn phase gate, **CURVE-11** gap rework, **BOMB-05** body separation.
6. **BOMB-08 / BOMB-10 / SNAKE-04 / SNAKE-05 / CURVE-08 / CURVE-09** — state visibility on phone, AI tiers, perf cleanups.
7. **XX-07** and the per-game P3 lists: icons, i18n, dead code, dead imports.

### Required playtest matrix after implementation

- LOCAL: 2 / 3 / 4 humans, with each tier of bot mixed into a seat; verify CURVE-02's player-count normalisation at 2 and 4.
- TV_CONSOLE: host-only display, host as P1, and a remote player — the seat-type matrix that exposed CURVE-01.
- ONLINE: P2-P4 world views on phones, mid-turn controller drop (CURVE-05), stale-frame recovery.
- Viewports: portrait phone, landscape phone, tablet, 16:9 TV. On a real mid-range Android for CURVE-08/09 numbers.
- Flows: normal win, draw/mutual kill, forfeit, disconnect, lobby return, hitched-frame combat (throttled CPU), boost-with-no-exit, last-second bomb pass.

## Batch 2 implementation status — 2026-09-24

The confirmed Batch 2 issues are now implemented:

- BOMB/CURVE/SNAKE now use real round IDs, bounded match timers, all-survivor draws, and explicit match-draw banners.
- BOMB dash rejects stunned players; resize remaps and clamps entities; world/status packets carry round time and draw state.
- CURVE gates spawn input, preserves gap-only trail immunity, exposes INVERT state, includes a separate gap mask, and gives normal bots dead-end checks.
- SNAKE separates food statistics from match scores, enforces food caps, uses swept movement substeps, clamps resize state, and publishes stricter world status.
- BOMB/SNAKE/CURVE world validators now enforce state, geometry, scores, winners, and player status fields.
- Added `tests/secondBatchGameEngine.test.mjs` and expanded packet regressions. The automated suite now has 60 passing tests.

The remaining Batch 2 work is gameplay balance, gap/corpse-fruit design, deterministic replay support, and the required real-device playtest matrix.

## Batch 3 implementation status — 2026-09-24

The verified HEIST/CROWN/ZONE findings were applied without adding speculative mechanics:

- HEIST now has round IDs, bounded tie resolution, correct 45-second timer progress, resize/loot clamping, and explicit empty-match draws.
- CROWN now has a round timeout, bounded tie resolution, correct hold-time reset after dropping the crown, and resize state preservation/clamping.
- ZONE now has round IDs, exact timeout tie handling, swept trail-cell traversal, corrected bounty BFS traversal, exact RLE coverage validation, and stricter field/player validation.
- HEIST/ZONE world packets expose draw state; controller status exposes draw/time state.
- Added Batch 3 engine regressions to `tests/secondBatchGameEngine.test.mjs`. The full automated suite now has 63 passing tests.

The remaining work is real-device playtesting and balance validation.

## Batch 4/5 implementation status — 2026-09-25

The remaining engine pass was applied without adding new mechanics:

- LASER now has session IDs, explicit timeout draw state, owner-laser scoring protection, resize clamping, and draw-aware world/controller state.
- CLONE now has round IDs, a 60-second terminal clock, bounded draws, swept/wall-aware tackles, resize state preservation, and draw-aware world/controller state.
- COLLAPSE now has a 60-second terminal clock, bounded draws, swept hole traversal, pickup expiry, resize remapping, and draw-aware world/controller state.
- NINJA now has round IDs, bounded draws, swept/wall-aware strikes, lantern lifecycle preservation on resize, and draw-aware world/controller state.
- RACE now exposes round IDs, bounded timeout draws, resize clamping, and EMP pulse scaling.
- Added `tests/fourthBatchGameEngine.test.mjs` and expanded race regressions. The automated suite now has 69 passing tests.

Remaining: real multi-device/browser playtesting and balance tuning.
