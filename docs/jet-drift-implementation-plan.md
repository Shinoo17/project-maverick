# Jet Drift / Implicit PSM — Implementation Amendment (Rev. 4)

> **Implementation update:** Preparation and Phase 4.5A/B/C code + automated validation are delivered; see [implementation report](phase45-implementation-report.md) for before/after measurements, intentional assertion migrations and remaining human playtest limits. Phase 5–9 remain pending. The original planning status below is historical.

> 21 September 2026 — Owner-approved implementation direction; implementation pending.
> Target branch: feat/psm-rework. Planning baseline: 33fa51010d03b34d21a8da9ce6f1588a408f95ee (Phase 4 complete).
> Companion to [psm-implementation-plan.md](psm-implementation-plan.md). This document governs the explicitly amended post-Phase-4 work; completed Phase 0–4 reports remain historical evidence.
> Scope of this commit: documentation only. Numerical targets below are provisional playtest targets, not measured results or hard CI thresholds.

## 1. เป้าหมายและขอบเขตที่อนุมัติ

ทำให้ผู้เล่นเข้า high-AoA / PSM ได้ง่ายในช่วง **350–700 arcade km/h บน HUD**, ประคอง drift ด้วย partial stick, ต่อ pitch/yaw/roll ได้ และใช้ Afterburner ดึงออกตามทิศหัว โดยไม่เพิ่มปุ่ม PSM หรือเล่น animation ของท่า

Keep the Phase 1–4 airflow, natural aerodynamics, actual-thrust engine, signed authority budgets, reachable nozzle allocation and fixed-step foundations. Extend the implementation with Phase 4.5A/B/C rather than replacing the flight solver wholesale.

Required behavior:

- Airbrake + pitch/yaw can initiate nose/path separation from attached flight, without C or mandatory Afterburner.
- S + pitch supports a gentler entry than Airbrake + pitch.
- Partial stick and axis changes can sustain a maneuver; roll-only activity during existing drift must not be mistaken for release.
- Airbrake preferentially bleeds body-forward motion while crossflow momentum still decays; lateral momentum is not permanent.
- Actual engine thrust changes the trajectory and supplies TVC. Afterburner release/reapplication remains player-controlled.
- Neutral means neutral command, including recentering the positional mouse. Merely stopping mouse movement is not neutral.
- Maneuver names describe observed motion. No combo lookup, target pose, timed rotation, prerecorded trajectory, free speed refill or automatic maneuver completion.

These goals describe possible outcomes given attitude, speed, available authority and pilot timing. They do not guarantee a named trick from a key combination.

## 2. Authority and precedence

This amendment supersedes only the items identified below. All unamended baseline contracts and later Phase 3/4 resolutions remain in force. Historical sections of the baseline are not instructions to undo completed work.

| Baseline / review item | Rev. 4 decision | Implementation owner |
|---|---|---|
| Phase 4 path/gravity port uses separation | Preserve the completed port as baseline. Separate physical flow response from arcade path assistance; entry can reduce the latter before stall memory rises. Gravity support remains a separate responsibility. | 4.5A |
| Section 2 energy window and strong brake + burner weighting | Author entry for HUD 350–700; Airbrake + directional demand must not require burner. Keep S feedback for automatic G, not as a prerequisite for breakout. | 4.5A |
| D/H latch based only on pitch/yaw entry demand | Separate entry demand from continuation activity. Roll helps maintain an existing drift but does not initiate breakout in attached flight. | 4.5B |
| P4-2 contribution-aware incidence restriction deferred to Phase 8 | Move it to 4.5B. Retain a combined nose-to-velocity envelope, but replace the axis-angle proxy with the effect of the requested rotation on incidence. | 4.5B |
| AD9 / D7 / I17 base-drag-only governor | Preserve base-drag-only cruise trim. Add an explicit, bounded control-power request for deliberate maneuvering, with actual spool/thrust and separate telemetry. This is the approved exception to the old blanket brake/input interpretation; no alpha/beta-drag cancellation or speed-error hold. | 4.5C |
| Scalar airbrake | Evaluate and implement dissipative body-axis braking with a consistent vector-force work ledger. Keep total drag accounting explicit. | 4.5C |
| Review suggestion to gate thrust path rotation | Do not attenuate engine force merely to prolong drift. Tune arcade path assist, braking and the explicit power request first; keep actual vectored thrust and low-speed path-rate protection. | 4.5A/C |
| Review assertion that F-22 side drift requires yaw TVC | Retain F-22 commanded yaw TVC = 0 and coupled physical torque bookkeeping. Evaluate aero yaw and roll + pitch trajectory changes separately. | 4.5 / 8 |
| Review invariant: neutral always decreases absolute rates | Reject as a final-state invariant: restoring moments may initiate rotation from rest. Test damping work/sign locally and recovery convergence over a declared benchmark window. | 4.5 / 5 |
| Full camera polish before physics | Add diagnostic framing first; finalize cinematic camera after aircraft tuning. No claim of off-screen failure from blend weight alone. | 4.5 preparation / 7 |
| Review: regenerate every golden after physics changes | Follow the existing golden policy. I4 against archived Phase 0 remains retired; preserve historical archives. Update active references only deliberately, with behavioral deltas and correct replay/profile versioning. | All |

The original [jet-drift-architecture-review.md](jet-drift-architecture-review.md) remains an analysis record, not the implementation authority where this table disagrees.

## 3. Evidence and limitations

Confirmed from the planning baseline:

- [stepFlight.ts](../src/game/flight/stepFlight.ts) blends normal and loose path response using separation. Shared pathResponse = 4 and turnAnticipation = 0.65 tightly couple velocity to nose rotation.
- [intent.ts](../src/game/flight/intent.ts) uses smoothstep of hypot(pitch, yaw) over 0.6–1.0, excludes roll, and treats only airbrake as brakeIntent.
- [mouseStick.ts](../src/game/input/mouseStick.ts) applies a squared radial response before intent sees the command. At full diagonal travel in body-frame reading, pitch and roll are about 0.707 each; the pitch/yaw demand gate receives only pitch and yields about 0.177.
- [envelope.ts](../src/game/flight/envelope.ts) uses qLow = 0.5 and qHigh = 1.8. Its high-incidence latch can stay open even when energyPermission = 0; high speed alone does not prove limiter closure.
- [speed.ts](../src/game/flight/speed.ts) supplies trim from base drag. Airbrake is returned as a scalar braking acceleration and competes with S/overspeed braking through max().
- [engineForces.ts](../src/game/flight/engineForces.ts) separates longitudinal work and bounded transverse rotation. Adding an arbitrary force vector is not automatically compatible with that ledger.
- [FlightInput.ts](../src/game/input/FlightInput.ts) currently maps X to Airbrake, Space to High-G and C to comparison/debug. Keep those bindings until Phase 6.

Analytical entry-intent values below assume full pitch, smoothed brake and sustained demand at 1, and low incidence (H = 0). They are formula evaluations, not flight-harness measurements. Actual limiter opening takes time; changing speed/incidence changes its target.

| HUD km/h | Pitch + Airbrake | Pitch + Airbrake + Afterburner |
|---|---:|---:|
| 350 | 0.550 | 1.000 |
| 450 | 0.448 | 1.000 |
| 500 | 0.333 | 0.968 |
| 600 | 0.064 | 0.186 |
| 650 | < 0.001 | < 0.001 |
| 700 | 0.000 | 0.000 |

A flow-coupling curve flat until 15 degrees cannot, by itself, guarantee escape from an attached equilibrium below that angle. The implementation must demonstrate entry starting near zero incidence, not only recovery from a pre-seeded stall.

The Opus review reports harness measurements, but its temporary measurement script was not committed. Reproduce useful tracks permanently before treating those numbers as the new baseline. The linked YouTube videos could not be inspected; no timing, control mapping or physics claim in this plan is asserted as verified from those clips.

## 4. Speed and input behavior

Use simulationSpeed() / arcadeSpeed() from [speedLimits.ts](../src/game/flight/speedLimits.ts). Current conversion is HUD km/h = simulation m/s × 5.4, so 350–700 HUD km/h is approximately 64.8–129.6 simulation m/s. Never divide these authored HUD values by 3.6.

| HUD band | Intended feel |
|---|---|
| 350–450 | Easy deep high-AoA entry; limited remaining energy makes timing and recovery matter |
| 450–600 | Primary drift/combination band with useful momentum |
| 600–700 | Accessible high-AoA entry; deep reversals cost more energy, without first falling below 350 |
| Above 700 | Smoothly reduce deep-entry permission toward high-speed hard turns; no abrupt cutoff at 700 |
| Below 350 | Continuation/recovery according to real capability; not a prerequisite for entry |

Initial upper fade candidate: begin around 650–700 and end around 800–850 HUD km/h, then tune from traces. These are experimental ranges, not a second hard speed gate. If retaining q-based profiles, derive q knots from the same speed conversion/referenceSpeedMps and validate ordering; do not author contradictory speed and q windows.

| Input | System response | Possible observed motion |
|---|---|---|
| Pitch + Airbrake | Open entry permission; reduce arcade path assist; allocate pitch demand | High-AoA / Cobra-like drift |
| Yaw + Airbrake | Permit sideslip; reduce assist that erases it; allocate available yaw | Side drift |
| Pitch + Yaw + Airbrake | Concurrent body-axis demand while momentum lags attitude | Nose swing / J-turn-like path |
| Roll during drift | Rotate body frame without rotating world momentum for free | Drift-plane change / freestyle |
| S + Pitch | Mild deceleration intent and entry support | Gentler high-alpha entry |
| Hold Airbrake | Dissipate forward motion preferentially; crossflow still decays | Longer visible slide |
| Afterburner | Increase actual thrust and available TVC through spool | Nose-directed trajectory change |
| Release Airbrake + Afterburner | Remove braking while real thrust acts | Recovery / slingshot |
| Neutral command | Natural response immediately; assistance after release delay | Gradual airflow alignment |

Do not change Mouse X from roll to yaw automatically with AoA. Keep positional mouse behavior and body-axis physics. Tune input sensitivity without making the render camera an input to simulation. Q/E ramping must advance on the deterministic command/simulation timeline and replay the resulting commands.

## 5. Architecture boundaries

### 5.1 Keep separate signals

Proposed names describe responsibilities; final type names may follow repository conventions.

| Signal / layer | Reads | May change | Must not do |
|---|---|---|---|
| Pilot input features | PilotCommand, input history; existing saturation feedback only for G | Entry demand, deceleration intent, continuation activity | Read aircraft capability, governor trim or render camera |
| Airflow and natural aero | State, flow, authored physical curves | Measured flow; physical forces/moments | Read intent, maneuver label or combo |
| Envelope | Input features, flow, authored permission tuning, deterministic memory | Entry/continuation permission and assistance weights | Add angular authority or directly write velocity |
| Physical path response | Flow, q/lift, separation where justified, physical tuning | Bounded translational flow response | Become weaker merely because the player presses a key |
| Arcade path assist | Explicit assistance permission, flow and profile | Existing path-follow/anticipation assistance within a declared translational acceleration limit | Be reported as physical aero; rotate velocity without accounting |
| Controller + allocation | Demand, permission, actual budgets | Feasible requested/delivered angular acceleration | Bypass aero/TVC/floor budgets |
| Control-power request | Explicit maneuver input features, bounded envelope context, engine configuration | A bounded requested-power contribution | Infer power from missing alpha/beta drag, desired speed restoration, or a target TVC capacity |
| Engine | Requested power and spool state | Actual thrust, shared by all consumers | Supply unreported TVC-only thrust |
| Recovery | Activity, delay, flow and remaining capability | Damping / feasible allocated correction / bounded path support | Cancel ongoing pilot input or snap to a target pose |

Angular I15 allocation bounds and translational path limits are separate: reducing an existing translational assist is allowed, but adding recovery rotation still requires the correct budget. Do not hide a new pitch/yaw torque in a path-assist multiplier.

### 5.2 Entry and continuation

Entry uses pitch/yaw demand and deliberate Airbrake or S intent within the speed envelope. Strong unbraked input may retain limited high-AoA behavior, but ordinary attached-flight roll must not trigger deep breakout.

Continuation uses all three angular inputs once reliable measured incidence indicates existing drift. Gate its effect in the envelope using flow/confidence, not inside the capability layer. The continuation path must:

- Accept partial stick without demanding repeated full-deflection entry.
- Bridge brief axis handoffs using bounded, deterministic release smoothing.
- Keep roll-only activity during existing drift from closing the limiter.
- Not latch forever from airbrake alone or from unreliable near-zero-speed angles.
- Allow neutral recovery and counter-steer immediately; no minimum maneuver duration.
- Use one shared activity/release interpretation for Phase 5, avoiding competing timers.

Initial handoff-release tuning candidate: 0.15–0.30 seconds. Report response over the range; do not bake that number into a hard invariant. Holding energy or angular speed constant for that duration is forbidden.

### 5.3 Path response and the entry deadlock

Extract and instrument the current attached response, feed-forward anticipation and loose response before changing their weights. Introduce separately tunable physical flow response and arcade path assist; do not claim that the old geometric servo is a measured aerodynamic law.

During deliberate entry, reduce the arcade anticipation/alignment contribution smoothly even at low incidence. Then measured flow/coupling curves govern how the physical response changes as incidence grows. Separation remains valid memory for appropriate lift/drag response, but is not the sole prerequisite for loosening assistance.

Use smooth weights, confidence at low speed, bounded accelerations and finite behavior at 90/180-degree incidence. Do not multiply all lift/gravity support by the drift-intent weight: retain the existing gravity model until a measured need for a separate change is documented. Preserve ordinary flight through conditional assist tuning rather than globally reducing pathResponse.

A flow-only coupling variant is a useful ablation, not the full implementation gate. Compare it against the explicit-assist separation to identify which contribution prevents entry.

### 5.4 Contribution-aware combined-incidence limiter

Keep the combined nose-to-velocity envelope. Replace the current five-degree per-axis sign proxy where it suppresses useful cross-axis motion.

Evaluate whether the requested body rotation increases or decreases nose/velocity misalignment. A dot-product derivative or equivalent stable formulation is preferable to division by sin(incidence) near 0/180 degrees. Handle second-order/tangent behavior and degenerate flow explicitly; do not assume a zero first derivative at the antipode means unrestricted safe rotation.

Restrict outward contribution, preserve inward correction, and leave angular allocation as the final capability clamp. Test simultaneous inputs, mirrored alpha/beta signs, near-pure sideslip, and 0/90/180-degree cases.

The old P4-2 assertion requiring an initially zero pitch request at alpha +10 / beta -60 is historical behavior. Replace the behavior-specific expectation only with documented before/after traces; retain numerical safety, combined-envelope and capability tests.

### 5.5 Braking, thrust and work

Implement body-axis braking with nonnegative coefficients and force opposing each corresponding air-relative velocity component. Author forward braking stronger than crossflow braking for the desired arcade feel. Retain natural alpha/beta/reverse drag, inspect double counting, and define how S/Airbrake/overspeed braking combine rather than accidentally stacking all three.

Required local property: F_brake · v_air <= numerical tolerance. At reverse/zero flow, braking must not reverse velocity or create kinetic energy by numerical overshoot. Include actuator/brake smoothing.

The translation integrator currently accepts scalar dragAndBrake. A vector-brake implementation must coherently account for longitudinal work AND transverse direction change, using consistent midpoint/impulse treatment or equivalent dissipative integration. Preserve low-speed transverse path-rate protection, intentional thrust-driven longitudinal zero crossings, and the existing gravity conventions.

Energy is specific energy (per unit mass). In the current still-air simulation, use:

~~~text
delta(0.5 * |v|^2 + g * h) <= integral(a_thrust dot v) dt - dissipated_drag_brake_work + epsilon
~~~

The old I18 printed thrust dot unit-velocity without the speed factor; it is dimensionally incomplete. Validate against delivered acceleration and the actual displacement/integration convention. A wind-relative extension would require explicit air/ground work accounting and is outside this change.

Base cruise trim remains baseDrag * speed^2. The new bounded dry control-power request is driven by explicit pilot maneuver intent and blended out on genuine release; it is not a target-speed governor or a requested-TVC-authority feedback loop. Cap it at configured dry power, spool through the existing engine, and report base trim / drive / control power / burner / actual thrust separately.

Changing drag coefficients at the same state and input must not increase this requested-power contribution. Changing explicit entry/continuation input may do so. Replace I17's blanket interpretation with that distinction in the same implementation commit.

With burner off, the goal is a useful high-AoA interval on F-22/Su-57, not unlimited deep post-stall control at zero airspeed. Test full/empty burner reserve, spool lag, low dry power and non-TVC variants. Do not gate real thrust to hold drift, guarantee speed recovery at every attitude, or create thrust that only the nozzle budget sees.

## 6. Implementation sequence and completion gates

All new implementation work is pending. Complete and review one bounded step at a time. The three 4.5 subphases jointly deliver the experience; success in 4.5A alone is not completion of Jet Drift.

### Preparation — Baseline and diagnostic presentation

Files: [harness.ts](../benchmarks/flight/harness.ts), [metrics.ts](../benchmarks/flight/metrics.ts), [targets.ts](../benchmarks/flight/targets.ts), [FlightCamera.ts](../src/render/FlightCamera.ts), existing instrumentation/HUD.

- Add permanent no-C entry, handoff, hold, release and burner-exit tracks described in section 7.
- Record baseline commit/profile version, exact initial state, command sequence and engine trim. Archive metrics before modifying flight behavior.
- Expose current path terms and limitation reasons. Keep diagnostic camera/overlay observational; no solver changes in the baseline capture commit.
- Use nose pipper + FPM and a stable framing option to see attitude/path separation. Verify framing from projected aircraft bounds rather than assuming velocity-look share alone causes clipping.
- Report limitations of automated camera checks; human playtest remains required.

Done: reproducible baseline exists for both airframes and non-TVC validation, and failure reasons can be distinguished from presentation issues.

### Phase 4.5A — Accessible entry and path-assist separation

Files: intent.ts, envelope.ts, controller.ts, stepFlight.ts, profileTypes.ts, validateProfile.ts, content/flight-profiles/*, relevant input tests.

- Author the HUD speed envelope through the canonical conversion.
- Add explicit S/deceleration intent; keep Airbrake entry stronger and remove mandatory burner dependence.
- Fix the effective mouse/entry-demand threshold enough to make the entry goal reachable while preserving fine aiming.
- Separate physical path response from arcade path-follow/anticipation assistance as in section 5.3.
- Add telemetry for each contribution and ablation comparisons.
- Keep actual-thrust, angular budget/floor and natural restoring contracts intact.

Done: attached-flight entry improves across 350/450/500/600/650/700; no-C, no-burner entry has a usable window; normal 900-km/h turns and ordinary unbraked aiming are compared to baseline. Residual authority/power limits are recorded for 4.5C, not hidden by floor inflation.

### Phase 4.5B — Continuation and cross-axis control

Files: intent.ts, envelope.ts, controller.ts, FlightInput.ts/mouseStick.ts where needed, state/replay serialization if fields are added.

- Implement separate continuation activity with roll and partial-stick support.
- Add deterministic handoff smoothing and shared release semantics for Phase 5.
- Implement contribution-aware combined-incidence restriction.
- Verify keyboard and real positional-mouse paths; synthetic PilotCommand-only tracks are insufficient.
- Keep body-axis physics and stable mouse-axis meaning. Do not introduce velocity-axis roll assist in this phase.

Done: pitch → yaw → roll → pitch and mirrored sequences remain controllable, partial hold is feasible, and a true neutral release remains available without special keys.

### Phase 4.5C — Drift energy and thrust recovery

Files: speed.ts, engine.ts only where request/spool plumbing requires it, engineForces.ts, stepFlight.ts, profileTypes.ts, profiles, work/budget telemetry and tests.

- Add the explicit bounded dry control-power request and revised I17 tests.
- Implement directional braking with coherent force/work accounting and revised I18 coverage.
- Tune braking/drag and burner acceleration from measured entry/hold/exit traces.
- Preserve real vectored thrust, low-speed path protection, actual nozzle travel and all signed allocation accounting.
- Compare brake held vs released, burner held vs pulsed, exhausted reserve and non-TVC behavior.

Done: useful drift/axis changes do not require continuous burner; Afterburner produces a measured trajectory response after brake release; no dissipation, authority, near-zero or replay invariant is weakened to meet feel targets.

### Phase 5 — Recovery assist

Use the baseline Phase 5 scope with the shared continuation/release signal from 4.5B.

- Natural restoring begins immediately; assistance follows the authored release delay.
- Active input suppresses recovery assistance on the same simulation step; renewed input cancels pending recovery.
- Allocate corrective angular demand within remaining aero/TVC capacity without double spending pilot allocation.
- Treat translational support separately with its force cap and work/drag model.
- Measure convergence over a window; do not require final absolute rates or incidence to decrease at every tick.
- At insufficient q/thrust, report limited recovery rather than inventing authority or enforcing a fixed return time.

### Phase 6 — Remove legacy controls and gates

Retain the baseline cleanup scope. Until this phase X is Airbrake, Space is High-G and C is debug comparison. Here move Space to Airbrake, retire C/highG command fields and legacy phase consumers, complete deterministic Q/E ramping, update input help/locales and bump command schema as required.

Additive state/profile changes in earlier phases still require their own replay/profile compatibility handling; do not postpone all version changes until this phase.

### Phase 8 — Aircraft validation, then Phase 7 — Camera/HUD polish

Retain original phase IDs for traceability; execute aircraft validation before final presentation polish. Basic F-22/Su-57 tuning is required within each 4.5 step; Phase 8 is final personality/regression validation, not a reason to leave 4.5 unplayable.

- F-22: pitch-oriented high-AoA and roll + pitch changes; commanded yaw TVC remains zero. Preserve small coupled physical yaw and actual-moment bounds from the Phase 3 resolution.
- Su-57: stronger sustained yaw/combined-axis opportunities within reachable shared nozzle travel.
- Keep non-TVC validation throughout; do not add hidden powered authority. New playable non-TVC aircraft/rigs remain the original Phase 8 scope.
- Camera: prototype velocity-look share around 0.35–0.5, attitude/path offset and FOV response; choose final values from framing, target visibility and motion comfort, not a numeric cap alone.
- Preserve horizon/reduced-motion behavior, continuity through vertical/reverse cases and stable control mapping. Validate projected aircraft bounds and nose/FPM visibility at 30/60/90/120/180-degree incidence.
- Camera/HUD must not influence commands or physics. No legacy phase fallback remains.

### Phase 9 — FX, audio and maneuver observer

Keep observer-only detection and no effect on flight state. Tune vapor for high-AoA and sideslip while respecting speed/flow and environmental inputs; do not simply force full vapor whenever drift permission is open. No named-maneuver animation controls the aircraft.

Additional crossflow normal-force modeling is optional after 4.5/8 evidence shows a specific missing behavior. Existing lateral response and real thrust already curve paths; do not infer that every drift is straight merely because alpha/beta drag is scalar.

## 7. Validation matrix and provisional feel targets

Extend the existing harness rather than adding a competing simulator. Test F-22, Su-57 and the established non-TVC validation variant. Capability-specific feel targets apply to the two playable TVC airframes; non-TVC runs protect boundaries rather than requiring the same deep maneuvers.

| Track family | Setup / commands | Required observations |
|---|---|---|
| Entry grid | Attached level flight at 350/450/500/600/650/700, same trim convention; pitch or yaw + Airbrake, burner off | Time to 20/30/60-degree incidence, signed alpha/beta, speed at entry, altitude loss, permission/authority bottleneck |
| Control comparison | Pitch alone, S + pitch, Airbrake + pitch, Airbrake + pitch + burner | Entry accessibility and energy cost by input |
| Hold | Reproducible entry then partial pitch/yaw values (e.g. 0.35/0.5/0.7), burner off | Time above 30-degree incidence, decay, unmet demand and power |
| Axis handoff | Pitch → yaw → roll-only → pitch; include brief neutral gaps and mirrored signs | Limiter continuity, no false release, authority allocation and controllability |
| Cross-axis limiter | Existing alpha +10 / beta -60 seed plus mirrored and near-90/180 cases | Inward vs outward restriction, finite behavior, no forbidden budget changes |
| Exit | Same saved drift state, brake held/released × burner off/pulsed/held | Nose motion vs velocity heading, speed/altitude/work, capture and overshoot |
| Release | Neutral from several incidence/rate states; reapply input during delay | Recovery convergence and immediate pilot priority |
| Edge cases | Zero/reverse velocity, exhausted burner, spool transitions, low q, alternating brake inputs | No NaN, no braking reversal/energy injection, bounded actuator/path response |
| Normal flight | Existing hardTurn900 / fullStick500, small-stick aiming, unbraked roll and cruise | Ordinary handling preserved or intentional differences explained |
| Input path | Actual positional mouse at cardinal/diagonal travel, Q/E ramp, mixed keyboard overrides | Effective demand, axis consistency and deterministic replay |
| Camera | Common saved states, horizon/aircraft mode, reduced motion, several aspect ratios | Projected subject bounds, FPM/nose visibility and no physics change |

Every trace records at least: time, HUD/simulation speed, alpha/beta/incidence/confidence, orientation/rates, entry demand, continuation activity, limiter target/open, physical vs arcade path contributions, actual thrust and its request sources, aero/TVC/floor allocation, coupled torque/actuator lag, braking decomposition, thrust/drag work and height.

Report cumulative nose rotation separately from net nose heading and velocity heading. Cumulative orientation motion is not proof of a J-turn or trajectory reversal. Define a heading plane/reference and return unavailable near degenerate horizontal projection; also report 3D direction change where appropriate.

Initial targets for human playtest:

- At 450–600 HUD km/h, pitch + Airbrake reaches 30-degree incidence in about 0.4–0.8 seconds without C or Afterburner.
- At 650–700, high-AoA entry occurs before speed falls below 350; record actual time and entry speed.
- A representative entry/partial-hold sequence allows about 1.5–3 seconds of useful adjustment/combination without continuous burner; report speed and height cost.
- A no-C axis-handoff sequence remains controllable and recoverable; identical success on every axis/airframe is not required.
- Neutral and burner-assisted exit benchmarks report recovery times and overshoot separately; no unconditional fixed-time recovery at zero capability.

These targets are report-only until measured and approved through playtest. Establish per-aircraft speed/height-loss and normal-flight regression ranges from the captured baseline; do not invent historical measurements. Publish unresolved target misses rather than silently weakening capability rules.

## 8. Hard contracts and migration

Preserve the baseline I1–I22 as resolved by later implementation amendments; do not resurrect superseded historical I4/I9 interpretations.

Add or extend coverage for:

- Physical aero and physical path response independent of PilotCommand at identical state.
- Arcade assistance explicitly identified, bounded and distinct from natural forces.
- Entry vs continuation: attached roll-only does not open breakout; valid existing drift can accept roll-only continuation.
- Input/assistance transitions bounded by their authored smoothing, with immediate suppression of recovery when pilot activity requires it.
- F_brake dot v_air <= epsilon and no numerical overshoot energy injection; vector-force work matches the integrator.
- Revised I17: explicit control-power intent may increase requested power; non-base drag coefficients or a hidden speed-hold error may not.
- Revised I18: dimensionally consistent specific-work bound, with gravity and transverse path limits checked independently.
- F-22 zero commanded yaw TVC, retained coupled physical yaw bounds, Su-57 reachable multi-axis allocation and non-TVC zero powered control.
- All new simulation memory initialized, cloned/serialized and replayed on deterministic ticks; no wall-clock timers.

For each physics/command-affecting implementation commit, bump the appropriate flightProfileVersion / schema version and use the existing replay rejection and goldenPolicy mechanisms. Keep archived Phase 0 data intact. Document any intentionally changed behavioral assertion before replacing it, particularly P4-2 and governor expectations.

Run applicable focused tests, the required full test/typecheck gates and flight benchmarks using repository scripts. For this documentation-only planning commit, verify links, phase/contract consistency and the diff; no claim that runtime tests or playtests were run.

## 9. Delivery checklist for each implementation step

- State the concrete behavior changed and why.
- Include modified files, profile/schema changes and source commit.
- Record before/after traces with commands, initial-state setup and analytical vs measured values clearly separated.
- Explain normal-flight and energy differences, failed feel targets and known limitations.
- Name any intentionally changed historical assertions; preserve unrelated safety/capability checks.
- Keep code, tests, profile changes and that step's implementation report together in a reviewable commit.
- Mark a phase complete only after its code and validation exist. This plan alone completes none of Phase 4.5–9.

Recommended next task: Preparation baseline capture, followed by Phase 4.5A. The Phase 4.5A/B/C order is deliberate: identify entry/path limits, make continuation controllable, then tune the resulting force and energy behavior.
