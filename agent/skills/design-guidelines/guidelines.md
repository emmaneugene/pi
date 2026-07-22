# Design guidelines

Combines Emil Kowalski's design engineering principles with Apple's interface and fluid-motion guidance (WWDC's _Designing Fluid Interfaces_ and related talks), translated to the web platform. Apply them using the conventions and constraints of the product you are changing.

The through-line: an interface feels alive when it responds instantly, moves continuously, carries the user's momentum, resists at boundaries, and can be grabbed and reversed at any instant. Most of the details below are individually unnoticeable; in aggregate they are what makes an interface feel right.

## Decide whether and how to animate

**Frequency decides first:**

| Frequency                                                   | Decision                     |
| ----------------------------------------------------------- | ---------------------------- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever.          |
| Tens of times/day (hover effects, list navigation)          | Remove or drastically reduce |
| Occasional (modals, drawers, toasts)                        | Standard animation           |
| Rare/first-time (onboarding, feedback forms, celebrations)  | Can add delight              |

Never animate keyboard-initiated actions; they repeat hundreds of times daily and animation makes them feel slow. Raycast has no open/close animation, and that is optimal.

**Every animation needs a purpose:** feedback (button confirms the press), spatial consistency (toast exits the way it entered), state indication, explanation, or preventing a jarring appearance. If the purpose is "it looks cool" and the user sees it often, don't animate.

**Pick the technique by interaction model:**

- CSS transitions for predetermined state changes that may retarget rapidly (toasts, popovers, button states). Transitions can be interrupted and retargeted; keyframes restart from zero.
- Velocity-aware springs for gesture-driven motion that must preserve position and momentum when interrupted.
- CSS keyframes for autonomous or decorative sequences that never need interactive reversal.
- Prefer CSS over JavaScript when motion is predetermined and compositor performance matters.

## Easing and duration

- Entering or exiting → `ease-out`. Moving/morphing on screen → `ease-in-out`. Hover/color → `ease`. Constant motion (marquee, progress) → `linear`. Default → `ease-out`.
- **Never `ease-in` for UI.** It delays the initial movement, the exact moment the user is watching, so it feels sluggish at any duration.
- Built-in CSS easings are too weak; use custom curves (see [easing.dev](https://easing.dev/)):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* iOS-like, from Ionic */
```

**Durations:** button press 100–160ms; tooltips 125–200ms; dropdowns 150–250ms; modals/drawers 200–500ms; UI animations stay under 300ms overall. Perceived speed matters as much as actual speed: a 180ms select feels more responsive than 400ms, a fast-spinning spinner makes the same load feel shorter, and `ease-out` feels faster than `ease-in` at identical duration.

**Asymmetric timing:** slow where the user is deciding (hold-to-delete: 2s linear press), fast where the system is responding (200ms ease-out release). Exit generally faster than enter.

## Springs

Springs simulate physics: no fixed duration, they settle from parameters, and they animate from the current value with current velocity, which makes them inherently interruptible. Use them for drag interactions, flicks, anything the user can grab mid-motion, and decorative mouse-tracking.

Think in Apple's two designer-friendly parameters:

- **Damping ratio**: `1.0` = critically damped, no bounce; `< 1.0` = overshoot. Lower = bouncier.
- **Response**: how quickly the value approaches the target, in seconds. Lower = snappier. Not a duration; settle time emerges.

Defaults: **damping `1.0` everywhere**; add bounce (damping ~`0.8`, bounce 0.1–0.3) **only when the gesture itself carried momentum** (a flick, a throw, a drag release). Overshoot on a menu that just faded in feels wrong; on a card you flicked it feels right.

Apple's shipped values:

| Interaction                  | Damping | Response |
| ---------------------------- | ------- | -------- |
| Move / reposition (e.g. PiP) | `1.0`   | `0.4`    |
| Rotation                     | `0.8`   | `0.4`    |
| Drawer / sheet               | `0.8`   | `0.3`    |

Web mapping (Motion / Framer Motion):

```js
import { animate } from "motion";

// Critically damped default
animate(el, { y: 0 }, { type: "spring", bounce: 0, duration: 0.4 });

// Momentum interaction — bounce only because a flick preceded it
animate(el, { y: target }, { type: "spring", bounce: 0.2, duration: 0.4 });
```

### Interruptibility

The single most important principle. Every animation must be interruptible and redirectable at any moment; a closing modal the user grabs should follow the finger, not finish closing first.

- Never lock out input during a transition.
- Always animate from the **presentation** (live on-screen) value, never the logical target; starting from the target causes a visible jump.
- When a gesture reverses, blend velocity through the retarget; a hard velocity cut reads as a "brick wall". Use a spring library that carries velocity.
- Decompose 2D motion into independent X and Y springs; a single spring on 2D distance desyncs when the axes have different velocities.
- Decide reverse-vs-commit at release by velocity **sign**, not position.

### Velocity handoff and momentum projection

When a gesture ends, the animation must continue at the finger's exact velocity so there is no seam between dragging and animating. Pass release velocity as the spring's initial velocity (normalize by remaining distance if the API takes relative velocity: `gestureVelocity / (target − current)`).

Don't snap to the boundary nearest the release point; project where the momentum is going, then pick the snap point nearest the projection (Apple's exact function, also the standard behavior in Vaul and Embla):

```js
// decelerationRate ≈ 0.998 for normal scroll feel; 0.99 for snappier
function project(initialVelocity /* px/s */, decelerationRate = 0.998) {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

const target = nearestSnapPoint(currentPosition + project(releaseVelocity));
animateSpringTo(target, { velocity: releaseVelocity });
```

## Response and direct manipulation

Lag kills the feeling of directness. Response is the foundation everything else is built on.

- Respond on pointer-**down**, not release: highlight/scale the instant of the press. Commit on pointer-up, allow cancel-by-dragging-away.
- Feedback must be continuous **during** the interaction: a drag, slider, or drawer updates 1:1 with the pointer the whole way, never only at gesture end.
- Audit every latency on the input path: debounces, artificial timers, transition waits.

**Drag mechanics:**

- Use Pointer Events with `setPointerCapture` so tracking continues outside the element's bounds.
- Respect the grab offset; snapping the element's center to the finger breaks the illusion.
- Track a short position+timestamp history (last few `pointermove`s) so you have release velocity.
- Require ~10px of movement (hysteresis) before committing to a direction, then track 1:1. Detect plausible gestures in parallel from the first move and cancel the losers once intent is clear; avoid recognizers that only report a final state.
- Ignore additional touch points after a drag begins; a second finger must not teleport the element.
- **Momentum dismissal:** don't require dragging past a threshold; if `|distance| / elapsedMs` exceeds ~0.11, dismiss regardless of distance. A quick flick should be enough.
- **Rubber-band at boundaries** instead of hard-stopping; resistance grows the further past the edge:

```js
function rubberband(overshoot, dimension, constant = 0.55) {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}
```

## Spatial consistency

- Enter and exit along the same path. A panel that slides in from the right dismisses to the right.
- Anchor interactions to their source: menus and popovers scale from their trigger, not center — set `transform-origin` to the trigger (Radix: `var(--radix-popover-content-transform-origin)`; Base UI: `var(--transform-origin)`). **Exception: modals stay centered**; they aren't anchored to a trigger.
- Mirror the easing on reversible transitions (inverse cubic-bézier control points for the two directions).
- Hint in the direction of the gesture: intermediate frames should telegraph the outcome, not interpolate blindly.

## Component patterns

- **Pressables scale on press**: `transform: scale(0.97)` on `:active`, 100–160ms ease-out. Subtle range 0.95–0.98.
- **Never animate from `scale(0)`**; nothing real appears from nothing. Start from `scale(0.95)` + `opacity: 0`.
- **Tooltips**: delay the first one; once any tooltip is open, adjacent ones open instantly with no animation (`transition-duration: 0ms` on the instant state).
- **Blur masks imperfect crossfades**: when two overlapping states read as two objects, `filter: blur(2px)` during the transition blends them into one transformation. Keep blur under 20px; heavy blur is expensive, especially in Safari.
- **`@starting-style`** animates entry without the `useEffect`-sets-`mounted` pattern; fall back to a `data-mounted` attribute where support is missing:

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 400ms ease,
    transform 400ms ease;

  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

- **Stagger** list entrances 30–80ms apart; longer feels slow. Stagger is decorative; never block interaction while it plays.
- **Cohesion**: match motion to the component's personality — playful can bounce, a dashboard should be crisp and fast. Easing, duration, visual design, and copy should feel like one decision.
- **Handle edge cases invisibly**: pause timers when the tab is hidden, fill gaps between stacked items to preserve hover, capture pointers during drag. Users never notice, which is the point.

## CSS techniques

- Percentage translates are relative to the element's own size: `translateY(100%)` hides a drawer regardless of its height. Prefer percentages over hardcoded pixels.
- `scale()` scales children too (text, icons); unlike `width`/`height`, that's usually what you want on press.
- `clip-path: inset(top right bottom left)` animates rectangular reveals with GPU acceleration and no extra DOM: hold-to-delete overlays (`inset(0 100% 0 0)` → `inset(0 0 0 0)`), scroll-triggered image reveals, comparison sliders, and seamless tab-color transitions (duplicate the tab list, style the copy active, clip it to the active tab, animate the clip).

## Performance

- Animate only `transform` and `opacity`; they skip layout and paint. Hint with `will-change` where motion is imminent.
- Updating a CSS variable on a parent recalculates styles for all children; during drag, set `transform` directly on the element instead.
- Framer Motion shorthand props (`x`, `y`, `scale`) run on the main thread via `requestAnimationFrame` and drop frames under load; pass the full `transform` string for hardware acceleration.
- CSS animations run off the main thread and stay smooth while the browser is busy; use CSS for predetermined motion, JS springs for dynamic/interruptible motion.
- WAAPI (`element.animate(...)`) gives JavaScript control with CSS performance: hardware-accelerated, interruptible, no library.
- Keep per-frame positional change below the perception threshold to avoid strobing; for very fast motion, subtle blur/stretch reads better than a sharp streak.

## Materials and depth

- Build nav/toolbars/sheets as translucent layers (`backdrop-filter: blur() saturate()` + semi-transparent background) with content scrolling underneath.
- Material weight encodes hierarchy: heavier materials for structural regions, lighter for interactive elements. Never stack a light translucent surface on another; legibility collapses.
- Bigger surfaces read as thicker: stronger blur, deeper shadow than small chips.
- Dim to focus, separate to keep flow: modal tasks get a scrim and push the background back; parallel non-blocking panels use translucency without a scrim.
- Over translucent surfaces, keep text legible with higher contrast and slightly heavier weight; put color on a solid layer, not the translucent foreground.
- Prefer a faded blur/gradient scroll-edge effect over a 1px divider under sticky chrome, only where floating UI overlaps content.
- Materialize, don't just fade: animate blur radius and scale together so a glass surface arrives as a material, not an opacity change.

## Typography

- Tracking is size-specific: negative on large display text, near-zero to slightly positive on small text. A single fixed `letter-spacing` is wrong somewhere.
- Leading tracks size inversely: tight on large headings (`line-height: 1.05`), looser on body (`1.5`).
- Build hierarchy from weight + size + leading as a set; emphasize with weight, which adds presence without space.
- Respect user text-size settings: spacing in `rem`/`em` so larger fonts don't break layout.
- Default to `system-ui` before a custom face; it ships optical sizing and legibility tuning. Set `font-optical-sizing: auto` on display text.

## Accessibility

- **`prefers-reduced-motion: reduce`**: fewer and gentler, not zero. Replace slides/springs/parallax with short opacity crossfades; drop overshoot and transform-based motion; keep opacity/color changes that aid comprehension.
- **`prefers-reduced-transparency: reduce`**: raise background opacity, drop the blur.
- **`prefers-contrast: more`**: near-solid backgrounds with a defined contrasting border.
- Gate hover animations behind `@media (hover: hover) and (pointer: fine)`; touch devices trigger hover on tap.
- Avoid full-viewport moving backgrounds, slow loops near one cycle per 5s, and abrupt brightness jumps (ease theme changes). Make large moving surfaces semi-transparent while they travel.

## Multimodal feedback

Combining motion, sound, and haptics: the cause must be obvious (trigger on the actual causal event), the three must fire on the same frame (latency between them destroys the illusion), and feedback must earn its place — reserve haptics/sound for meaningful moments or users learn to ignore all of it.

## Design foundations

Apple's eight principles, as vocabulary for design reasoning: **purpose** (decide what not to build), **agency** (choices plus easy undo; confirmation dialogs only for genuinely destructive actions), **responsibility** (privacy, safety, anticipate misuse — especially with AI), **familiarity** (consistent metaphors; things that look the same behave the same; break a familiar pattern only with proof it's better), **flexibility** (contexts, devices, abilities; let people personalize when no single layout fits), **simplicity** (hierarchy makes the important thing the most obvious; common path first, advanced options one level deeper — not minimalism), **craft** (every spacing and timing value is a deliberate choice you can defend), **delight** (the result of the other seven, not confetti on top).

Tactical rules that serve them:

- Feedback comes in four kinds: status, completion, warning, error. Validate inline, not on submit.
- Wayfinding: every screen answers "Where am I? Where can I go? What's there? How do I get out?" Never trap the user.
- Proximity implies relationship: place a control near what it affects, arranged to mirror what it changes. If a control needs a label to explain it, the mapping is weak.
- Direct, specific labels beat safe generic ones: "Progress", "Library" — not "Home".

## Process and debugging

- Prototype interactively; a working demo is worth a million static designs and sets the bar for the final implementation.
- Design interaction and visuals together; motion is not a layer added after the pixels.
- Review animations with fresh eyes the next day; play them in slow motion and frame-by-frame (Chrome DevTools Animations panel) to catch desynced properties, wrong transform-origins, and abrupt easing invisible at full speed.
- Test touch gestures on real hardware via remote devtools, not just the simulator.

## Review format (required)

When reviewing UI code, output findings as a single markdown table with `Before`, `After`, and `Why` columns, one row per issue. Never use a list with "Before:"/"After:" on separate lines.

| Before                                | After                                                             | Why                                                      |
| ------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `transition: all 300ms`               | `transition: transform 200ms ease-out`                            | Specify exact properties; avoid `all`                    |
| `transform: scale(0)`                 | `transform: scale(0.95); opacity: 0`                              | Nothing real appears from nothing                        |
| `ease-in` on dropdown                 | `ease-out` with custom curve                                      | `ease-in` delays initial movement; feels sluggish        |
| No `:active` state on button          | `transform: scale(0.97)` on `:active`                             | Buttons must feel responsive to press                    |
| `transform-origin: center` on popover | `transform-origin: var(--radix-popover-content-transform-origin)` | Popovers scale from their trigger (modals stay centered) |

Also check: animation on keyboard actions (remove), duration > 300ms (reduce to 150–250ms), hover without the `(hover: hover)` media query, keyframes on rapidly-triggered elements (use transitions), Framer Motion `x`/`y` under load (use `transform` string), same enter/exit speed (exit faster), simultaneous list entrances (stagger 30–80ms), missing reduced-motion handling.

Distinguish defects from subjective alternatives; preserve deliberate choices that fit the product's character.

## Quick reference

| Need                        | Technique                            | Concrete value                                       |
| --------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Default UI spring           | Critically damped, no overshoot      | `damping 1.0`, `response 0.3–0.4`                    |
| Momentum / flick spring     | Under-damped, slight bounce          | `damping ~0.8`, `response 0.3–0.4`                   |
| Gesture → spring velocity   | Hand off release velocity            | `gestureVelocity / (target − current)` if normalized |
| Flick landing point         | Project momentum                     | `current + (v/1000)·d/(1−d)`, `d ≈ 0.998`            |
| Interrupt cleanly           | Start from presentation (live) value | read the on-screen transform                         |
| Avoid reversal "brick wall" | Carry velocity through re-target     | spring that blends velocity                          |
| Reversible transition       | Mirror the easing curve              | inverse cubic-bézier                                 |
| Decide reverse vs. commit   | Use velocity **sign**, not position  | at release                                           |
| 1:1 drag                    | Pointer Events + capture             | respect the grab offset                              |
| Feedback                    | On pointer-down, continuous          | never only at the end                                |
