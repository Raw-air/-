# Archive shell and glass checks

Run with the project's Playwright dependency installed:

- `npm run test:visual`: closed-edge topology at three sizes; Chromium/WebKit
  isolated side silhouettes; GPU wipe/restoration; camera ray picking; empty
  scene pixels; screenshot comparison with refraction enabled/disabled. The
  centre must remain stable while actual background grid pixels move at edges.
- `npm run test:archive`: synthetic roster, desktop and WebKit portrait/landscape,
  dark/light, editor, search, keyboard, reduced motion and interrupted opening.
- `npm test`, plus `TEST_WEBKIT=1 node tests/ui.cjs`: existing data/edit/import,
  theme, carousel, particle and cancellation regressions. Timing is measured
  inside the page; synchronous particle startup must complete within 250 ms.
  First-frame latency is reported separately: software WebKit rendering can be
  substantially slower and is not an iPhone performance benchmark.
- `TEST_OFFLINE=1 node tests/ui.cjs`: versioned offline shell and dependencies.

The new shell is a closed 0.8 px material ribbon around an open U-shaped cavity,
not a solid side wall. One raw WebGL camera renders every folder. DOM editors,
keyboard controls and a CSS fallback remain available. Drawing is event-driven;
invisible departed folders are not submitted. WebGL context loss reveals the
fallback and restoration recreates the shared renderer.

Chromium uses a signed-distance displacement map directly on the backdrop.
WebKit uses a local directional filter field on an inert, clipped DOM mirror:
no duplicate controls/IDs, no event listeners, no network capture, no exports.
Only the strip intersecting the bar is mirrored; canvas sources are cropped.
Scrolling updates on demand and mutations are throttled. During particle
animation the last glass snapshot is reused to avoid competing GPU readback;
the single-file wipe also reuses the composited model. No idle render loop.
This fallback approximates page painting: complex pseudo-elements and nested
transforms may differ from native backdrop sampling. It is not Apple's native
material implementation. Power-saving disables the expensive glass layers.

Screenshots in `test-results/` use fabricated residents only. Browser emulation
does not establish iPhone hardware performance or pixel identity to a cropped
reference image; check these on a real iPhone before claiming either.
