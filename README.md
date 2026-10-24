# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Home glyph background

The Home page has seeded stars with brightness-driven local density and total
active count, rare larger dots in dense gradient regions, continuous slow diagonal
movement and modest per-point speed variation. A pointer-free mean of the grayscale field smoothly adds/removes stable
point IDs within the 2600-point budget. The field translates/evolves separately. All rendered Home text supplies glyphs through explicit `data-glyph-source`
markers and receives the Home-only background-aware palette. Other routes retain
their existing appearance.
Run `npm test` for field, renderer, Home text coverage and existing visualizer regressions.
Home combines its pointer halo with the animated field and a restrained near-black
wash; other routes keep their existing cursor glow. Large particles retain their
linear size multiplier when they become canvas glyphs, with a soft cached halo
on enlarged particles only. See [large particle rendering](docs/large-particle-glyph-glow.md), the
[shared-light design](docs/shared-home-light-field.md) and
[implementation and acceptance checks](docs/luminance-glyph-background.md)
for rendering details, accessibility behavior and verification limitations.
