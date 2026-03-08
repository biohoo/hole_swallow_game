# Hole Swallow Game

3D arrow-key prototype built with Vite, TypeScript, and Three.js.

## Run

```bash
npm install
npm run dev
```

Build and tests:

```bash
npm test
npm run build
```

## Game data

- Global tuning lives in `public/config/game-config.json`.
- Reusable shape definitions live in `public/shapes/shapes.json`.
- The starter level lives in `public/levels/demo-01.json`.

Levels reference shapes by `shapeId`, so most gameplay tuning is data-only.

## Add a new shape

### Data-only shape

Add an entry in `public/shapes/shapes.json` using one of the built-in geometry types:

- `box`
- `sphere`
- `cylinder`
- `capsule`

Each shape defines dimensions, material preset, score value, growth value, and required hole radius.

### New geometry type

Register it in [`src/game/shapeRegistry.ts`](/Users/jonathanrice/Developer/hole_swallow_game/src/game/shapeRegistry.ts):

- add `ShapeRegistry.register(type, builder, footprintRule)`
- make the `builder` return a Three.js object
- make the `footprintRule` return the swallow footprint radius

After that, the new `geometryType` can be used from JSON without changing the game loop.

## Controls

- Arrow keys: move the hole
- `R`: restart the demo level
