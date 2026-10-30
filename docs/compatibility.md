# Compatibility matrix

Status legend:

- **PASS** — verified by a reproducible test in this repository
- **PARTIAL** — works for tested cases; known gaps or shims
- **UNSUPPORTED** — not implemented, or deliberately out of scope

Evidence types:

- **JDK** — executes real OpenJDK class files
- **SHIM** — native JavaScript bridge replaces part of the JDK
- **ASM** — real ASM classes executed by the runtime

| Area | Status | Evidence | Notes |
|------|--------|----------|-------|
| Basic arithmetic / control flow | PASS | JDK | int/long/float/double, branches, switches |
| Object construction / inheritance | PASS | JDK | constructors, virtual dispatch |
| Interfaces / default methods | PASS | JDK | runtime hierarchy resolution |
| Arrays | PASS | JDK | primitive/reference arrays, `arraylength` |
| Exceptions | PASS | JDK | `athrow`, tables, catch/finally |
| `String` | PARTIAL | SHIM/JDK | compact strings partially bridged |
| `StringBuilder` | PARTIAL | SHIM | native bridge |
| `ArrayList` | PASS | SHIM | index/iterator/two-arg add |
| `HashMap` | PARTIAL | JDK/SHIM | relies on native hash/equals |
| `ConcurrentHashMap` | PARTIAL | SHIM | single-threaded `Map` |
| Iterators | PASS | SHIM | `hasNext`/`next` |
| Reflection `Class` | PASS | SHIM | canonical Class objects |
| `Method` / `Field` / `Constructor` | PASS | SHIM | invoke/newInstance/get/set |
| Annotations | PASS | ASM | `@Mixin`/`@Inject` read |
| Generic signatures | PASS | JDK | `getGenericSuperclass` |
| Inner classes | PASS | SHIM | `getDeclaredClasses` |
| `Unsafe` | PARTIAL | SHIM | allocateInstance/field offsets, no memory model |
| `defineClass` | PASS | SHIM | tested with ASM output |
| ASM `ClassReader` | PASS | ASM | constant pool, methods, annotations |
| ASM `ClassWriter` | PASS | ASM | visitor + tree output |
| ASM `MethodNode` | PASS | ASM | HEAD/RETURN injection |
| Mixin 0.8.5 environment | PASS | ASM | custom service adapter |
| Mixin `@Inject(HEAD, cancellable)` | PASS | ASM | `42 → 142` |
| Mixin `@Inject(HEAD)` non-cancellable | PASS | ASM | side effect, original `42` |
| Mixin `@Inject(RETURN)` | PASS | ASM | handler invoked |
| Mixin `@Redirect` / `@ModifyArg` | UNSUPPORTED | — | not tested |
| SRG mapping | PASS | DATA | 7436 classes / 48575 methods / 32126 fields |
| Java source compilation | UNSUPPORTED | — | must use external `javac` |
| Bytecode verifier | UNSUPPORTED | — | not implemented |
| Threads | UNSUPPORTED | — | single JS thread |
| `java.util.concurrent` | PARTIAL | SHIM | atomics/CHM shims only |
| `java.io` / `java.nio` | PARTIAL | SHIM | path/file string shims |
| Network | UNSUPPORTED | — | no sockets |
| Module system / `ServiceLoader` | PARTIAL | SHIM | minimal, not module-aware |
| PNG decode | PASS | JDK/SHIM | bytes → Blob → ImageBitmap |
| Matrix math | PASS | JDK | `mat4` calculations |
| WebGL bridge | PASS | SHIM | shader/VBO/EBO/texture/draw |
| Forge / ModLauncher | UNSUPPORTED | — | research target |
| Minecraft client | UNSUPPORTED | — | out of scope for this phase |
| Full Java SE 17 | UNSUPPORTED | — | not a compatibility claim |

## Reproduce the key results

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
node lab/run-realmixin.mjs
```

The Mixin harness currently prints:

```text
real mixin HEAD
real mixin RETURN
42
```

The cancellable variant is kept in the repository history and documented in [`bytecode.md`](bytecode.md).

## What "PASS" does not mean

A PASS means the included test passes on this runtime. It does **not** mean:

- HotSpot equivalence
- full JDK behaviour
- thread safety
- performance parity
- security isolation

Where a native bridge replaces JDK code, the status is marked **SHIM** to keep the distinction visible.
