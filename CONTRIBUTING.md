# Contributing to imagepipe

Thanks for helping! imagepipe aims to stay small, zero-dependency, and pleasant to
read — contributions should too.

## Setup

```sh
git clone https://github.com/imagepipe/imagepipe.git
cd imagepipe
npm ci
```

## Development loop

```sh
npm run test:watch   # vitest (unit + type tests)
npm run check        # everything CI runs: typecheck, lint, format, test, build, publint, size
```

## Ground rules

- **Zero runtime dependencies.** Don't add any, even "small" ones.
- **Public API stability.** The API is reviewed before changes land; open an
  issue before proposing surface changes.
- **Correctness over speed.** The CPU path is the reference implementation;
  WebGL2 output must match it within test tolerance.
- **Tree-shaking.** One filter per module; no side effects beyond
  `/* @__PURE__ */`-annotated factory creation. Budgets are enforced by
  `size-limit` in CI.
- **TSDoc everything public.** Types are part of the product.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with small,
focused commits — one coherent change each (a config tweak, one op, one test
group). Example: `feat: add lanczos downscale kernel`.

## Releases

We use [Changesets](https://github.com/changesets/changesets). If your change
affects consumers, run `npx changeset` and commit the generated file.

## Tests

- Every operation needs unit tests.
- Pixel operations use small deterministic fixtures and tolerance-based
  comparisons (CPU and GPU may differ slightly).
- Test serialization round-trips and immutability for anything touching the
  pipeline.
