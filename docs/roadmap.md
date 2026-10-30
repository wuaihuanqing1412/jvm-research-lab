# Roadmap

The project is published in stages. Later stages do not change the claim that this is a research runtime, not a Java SE implementation.

## Phase 1 — public baseline (current)

- runtime core: class parser, interpreter, object model
- lazy JDK loading (`java.base`, `java.logging`)
- exceptions, reflection, annotations, generics, inner classes
- native bridges for strings and collections
- setup/build/serve scripts
- compatibility matrix and security model
- Mixin acceptance harness

## Phase 2 — bytecode experiments

- decode annotation booleans correctly (remove the forced `cancellable` workaround)
- `@Inject(at = INVOKE)` and `@Redirect`
- `@ModifyArg` / `@ModifyVariable` fixtures
- SRG mapping generator checked in
- headless ASM tests in CI

## Phase 3 — graphics experiments

- reproducible WebGL pages with fixtures
- PNG decode and texture upload tests
- matrix and uniform tests
- record screenshots/GIFs for the README

## Phase 4 — low-level experiments

- `Unsafe` and `defineClass` marked experimental
- explicit opt-in flags for high-privilege modules
- no default native code execution
- documentation of DOS and escape risks

## Phase 5 — community

- issue templates
- pull request template
- compatibility test contribution guide
- hosted playground with an isolated origin
- optional source-to-class compilation service (not in-browser)

## Non-goals

- claiming full Java SE 17 compatibility
- running Forge/ModLauncher without a separate integration project
- replacing a real JVM for production workloads
- executing untrusted code without a sandbox
