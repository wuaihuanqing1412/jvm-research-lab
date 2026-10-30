# Contributing

Thanks for taking a look. This is a research project; small, reproducible changes are more useful than large refactors.

## Before you start

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
node lab/run-realmixin.mjs
```

The Mixin harness should print:

```text
real mixin HEAD
real mixin RETURN
42
```

## What to contribute

Good first contributions:

- a minimal compatibility fixture with a PASS/PARTIAL/UNSUPPORTED result
- a bug fix for a specific failing opcode or JDK class
- documentation of a known limitation
- an ASM/Mixin example that runs headlessly

Please avoid:

- large directory reshuffles without a migration plan
- claims of "full Java 17" or "browser JVM"
- hiding failures behind broad catch blocks
- adding native bridges that accept arbitrary paths or code strings

## Compatibility tests

Every behaviour change should state:

1. the class file or minimal source used
2. whether it executes real JDK classes, a native shim, or ASM
3. the observed result
4. the status: PASS / PARTIAL / UNSUPPORTED

Add the row to [`docs/compatibility.md`](docs/compatibility.md) and, when it is a runnable check, to [`tests/compatibility.md`](tests/compatibility.md).

## Code style

- Plain JavaScript, no build step for the runtime.
- Keep native shims small and documented.
- Prefer explicit errors over silent fallbacks.
- Do not commit `vendor/`, extracted JDK classes, or compiled `.class` files.

## Pull requests

Include:

- what changed
- how it was tested
- the current compatibility status
- any new limitation

## License

By contributing you agree that your contribution is licensed under Apache-2.0.
