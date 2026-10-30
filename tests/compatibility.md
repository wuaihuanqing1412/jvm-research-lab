# Compatibility tests

These are the checks that back the public status table. Each item should record how it was executed.

## Legend

- PASS — verified in this repository
- PARTIAL — works for the listed case, with known gaps
- UNSUPPORTED — not implemented

## Runtime

| Check | Input | Status | Evidence |
|-------|-------|--------|----------|
| integer/float arithmetic | `JdkTest` | PASS | real JDK `Math` |
| objects/constructors | `objects.html` | PASS | class fixture |
| inheritance/dispatch | `child` fixture | PASS | class fixture |
| arrays | `arr.html` | PASS | class fixture |
| exceptions | `exception.html` | PASS | class fixture |
| strings | `str.html` | PARTIAL | native bridge |
| ArrayList | `list.html` | PASS | native shim |
| HashMap | `map` fixture | PARTIAL | native hash/equals |
| reflection | `reflect.html` | PASS | native bridge |
| annotations | `anno.html` | PASS | ASM annotation nodes |
| generics | `generic.html` | PASS | signature attribute |
| inner classes | `inner.html` | PASS | InnerClasses |
| Unsafe | `unsafe.html` | PARTIAL | allocateInstance/field offsets |
| defineClass | `define.html` | PASS | ASM output |

## Bytecode

| Check | Command | Status | Expected |
|-------|---------|--------|----------|
| ASM body rewrite | `lab/transform.html` | PASS | `42 → 123` |
| MethodNode HEAD/RETURN | `lab/node.html` | PASS | callbacks + `42` |
| SRG fallback | `lab/srgtest.html` | PASS | `hello → m_999_` |
| real Mixin cancellable HEAD | `node lab/run-realmixin.mjs` (case A) | PASS | `real mixin HEAD`, `142` |
| real Mixin HEAD + RETURN | `node lab/run-realmixin.mjs` (case B) | PASS | `real mixin HEAD`, `real mixin RETURN`, `42` |

### Current harness (case B)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
node lab/run-realmixin.mjs
```

Expected:

```text
real mixin HEAD
real mixin RETURN
42
```

## Graphics

| Check | Page | Status |
|-------|------|--------|
| shader + VBO | `lab/modern.html` | PASS |
| PNG + index buffer | `lab/pngindex.html` | PASS |
| matrix uniform | `lab/rotate.html` | PASS |

## Adding a test

1. Add the fixture or page.
2. Record whether it uses real JDK classes, a shim, or ASM.
3. Add the row to `docs/compatibility.md` and this file.
4. Include the exact command and expected output.
