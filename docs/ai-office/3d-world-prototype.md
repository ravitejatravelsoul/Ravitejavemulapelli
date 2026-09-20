# The Nexus — 3D Office visual prototype

Branch: `feature/ai-office-3d-world-prototype`.
Base: `c70a104f2d17a90abf685d238a639dc9400fb864` (latest Living Office Level 2/3 feature code). Master and the existing Living Office branches are not changed.

## Scope and architecture

`/office/world-prototype` lives under the existing authenticated Office layout. A small private sidebar entry opens it; `/office` remains the default. The client-only world is dynamically imported, so Three.js is not imported by the existing Office scene. The world components import no Office domain state, actions, providers, runner, budget, approval or remote-execution code. Existing shell authentication remains the boundary.

Engine: Three.js 0.186.0, React Three Fiber 9.7.0 and Drei 10.7.8. R3F manages renderer/resource lifetime; Drei supplies rounded character geometry. Native pointer lock and a compact collision controller avoid a physics engine. The standard Next client-side dynamic-import pattern keeps WebGL out of server rendering. Reference: [R3F documentation](https://r3f.docs.pmnd.rs/getting-started/introduction), [Three.js documentation](https://threejs.org/docs/).

R3F extends React's JSX intrinsic elements. Four existing broad polymorphic/icon type annotations were narrowed to HTML-compatible tags or icon components to preserve typechecking. These are type-only changes, with no rendered behavior changes.

## Visual design

An original compact headquarters organized around a circular command atrium and skylight. Ivory structural frames, graphite floors, warm metal and restrained cyan technology give the space a coherent material language. Reception, Product, Architecture, Engineering, Owner, Infrastructure and Delivery areas connect through walkable openings. A future-department room reserves Design, QA, Security, Review and Launch space.

All meshes and canvas display textures are generated in this project. No downloaded models, copyrighted game assets, external fonts, HDR environments, existing office WebP or image-generation assets are used. Architectural text is a mesh texture; the HTML layer is limited to game controls, accessibility, menus and interaction information.

Three original independent characters: PIP (planning panels and antenna), ARC (analytical visor and orbital structural ring), DEX (tool arms and auxiliary modules). Idle bots acknowledge a nearby visitor. The iconic Task Core is an illuminated nested cube/octahedron assembly. Displays, cores and activity explicitly identify themselves as prototype/demo content.

## Exploration and demo

WASD moves, Shift accelerates, mouse/arrow keys look, E opens nearby agent information, Escape releases the mouse. Menu controls resume, reset to reception, replay/pause the demo, adjust sensitivity and resolution, show a floor directory or exit to `/office`.

Player motion uses damped acceleration, a 1.7 m eye height, fixed flat-floor constraint, axis-separated/substepped wall and furniture collision, and proximity collision with bots. There is no flight, jumping, multiplayer or inventory. No camera bob. Keyboard focus is kept within the prototype overlay. Reduced motion suppresses nonessential ambient animation; the explicitly requested demo remains available. Hidden tabs stop rendering and do not accumulate demo time.

The 60-second local timeline shows PIP working, undocking, carrying a Task Core through actual doorways, transferring it to ARC, returning, ARC working and carrying the next core to DEX, and DEX returning to code. Waypoint paths, arrival easing, turning and distinct work/interaction poses are controlled entirely by the local visual timeline. The user can explore throughout. Pausing, reloading or leaving changes no real Office state.

## Rendering and cleanup

Modest geometry, a single static shadow map, limited lights, memoized environment and capped device pixel ratio. No post-processing stack or expensive screen-space reflections. Static architecture shadows are calculated once; moving characters do not leave baked character shadows. R3F disposes scene resources on unmount; generated canvas textures have explicit disposal. Keyboard, pointer, visibility and media-query listeners are removed on unmount, and exiting releases pointer lock.

## Limitations for owner review

This is an original procedural visual prototype, not a finished game art production. Glass uses approximate transparency rather than ray-traced reflections; skyline and future department areas are intentionally simplified. Navigation uses flat-floor collision and explicit bot waypoints, not a navigation mesh or rigid-body physics. No audio or touch/gamepad movement is included. Desktop keyboard/mouse and WebGL 2 are required; pointer-lock restrictions in embedded browsers may require opening localhost in Chrome or Edge. Software WebGL is substantially slower than hardware acceleration. Only the owner can approve the visual direction.

Local screenshots and measurements are kept under ignored `.data/world-evidence/`; no evidence images, databases, credentials or logs are committed.

## Validation evidence

- Full existing unit suite plus three targeted world tests: **942 passed**. The new tests check wall/desk tunnelling, every bot waypoint sample against furniture/walls, path continuity and handoff phases.
- Existing Office browser regression: **12 passed** (Living Office, task/workspace interactions, authentication/navigation, mobile project tabs and the production-disabled shell).
- New 3D browser test: **passed**, approximately 210 seconds. It uses a local production build, an isolated temporary database, random test credentials, blank provider keys, no runner and browser keyboard/mouse input. It checks route protection, real WebGL startup, mouse look, walking, collisions, agent interaction, all eight areas, full 60-second demo, Escape/re-entry, reset, resize, exit and clean remount. Browser exceptions: **0**. External requests: **0**.
- Hardware-rendered demo measurement at 1440×900: **60 FPS median**, **60 FPS 10th percentile**, 226 samples, Intel Arc 140T through ANGLE / Direct3D11. This is a measurement on this machine, not a guarantee on every GPU. A separate software-rendered diagnostic ran around 9–11 FPS; hardware acceleration matters.
- TypeScript and build passed. ESLint: zero errors, one pre-existing warning in ignored generated workspace `storage.js`.
- Source/client-bundle scan found no configured secret values. No model calls, paid usage, deployment or production configuration changes.

Screenshots in `.data/world-evidence/`: reception, central atrium, Product Owner, Architecture, Engineering, Owner room, infrastructure/server area, Delivery Vault, both Task Core handoffs, wide headquarters overview, agent interaction and resized viewport. Additional sequential transfer frames record rendered motion. Test diagnostics found and fixed explicit Escape release and obscured Owner signage; browser navigation paths were aligned with real doorways rather than bypassing collisions.

**Delivery status: visual prototype ready for owner review. Visual approval belongs to the owner.**
