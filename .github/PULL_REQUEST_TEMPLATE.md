# Pull request

## What

<!-- One or two sentences describing what this PR changes. -->

## Why

<!-- The motivation. Link to any related issue. -->

Closes #

## How

<!-- Brief overview of the approach, especially anything non-obvious. -->

## Checklist

- [ ] Title follows [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(inspector): ...`)
- [ ] `pnpm typecheck && pnpm lint` passes
- [ ] `cargo fmt --check && cargo clippy -- -D warnings` passes
- [ ] `cargo test --lib` passes
- [ ] New behavior is covered by a test (or a clear note why not)
- [ ] Docs / comments updated where the change is non-obvious
- [ ] No new `unwrap()` / `expect()` in production code paths
