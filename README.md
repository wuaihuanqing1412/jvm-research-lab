# JVM Research Lab

**A custom Java class-file runtime and bytecode experimentation environment for the browser.**

JVM Research Lab is a browser-based research project. It parses and executes real Java class files, loads real OpenJDK classes on demand, runs ASM transformations, and experiments with the real SpongePowered Mixin pipeline. It also bridges Java-side OpenGL calls to WebGL.

> [!IMPORTANT]
> This is **not** a browser port of Java SE 17, and it does **not** compile Java source code.
> It is a class-file runtime with partial Java 17 semantics. The current pipeline starts at `.class` bytes.

![Real Mixin injection](docs/assets/jvm-inject-final.png)

## What it actually does

```text
Java source (.java)
        │  javac (outside the runtime, offline)
        ▼
Java class file (.class)
        │
        ▼
JVM Research Lab
  ├─ class parser            constant pool, fields, methods, Code, attributes
  ├─ bytecode interpreter    stack machine, control flow, exceptions
  ├─ lazy JDK loader         real java.base / java.logging classes
  ├─ object & array model    constructors, inheritance, interfaces, enums
  ├─ reflection              Class / Method / Field / Constructor / annotations
  ├─ native bridges          String, collections, math, streams, resources
  ├─ ASM                     ClassReader / ClassWriter / tree API
  ├─ real Mixin 0.8.5        MixinEnvironment / MixinTransformer / MixinInfo
  ├─ SRG mapping             1.20.1.tsrg → runtime name resolution
  └─ WebGL bridge            Java GL calls → WebGL
```

There is **no in-browser Java compiler** and no source-to-IR stage. To run code, compile it with `javac` first, then hand the `.class` bytes to the runtime.

## Current milestone

Real SpongePowered Mixin 0.8.5 runs on the custom runtime:

```text
@Mixin(targets = "Dynamic")
public class RealMixin {
  @Inject(method = "answer", at = @At("HEAD"), cancellable = true)
  private void onAnswer(CallbackInfoReturnable<Integer> cir) {
    cir.setReturnValue(142);
  }
}
```

Result:

```text
in 343 out 1569
real mixin HEAD
142
```

- `Dynamic.answer()` originally returns `42`
- Mixin generates `handler$zzaNaN$onAnswer(CallbackInfoReturnable)V`
- the injected cancellation branch returns `142`

A second verified case adds non-cancellable `HEAD` and `RETURN` injection while the original method still returns `42`.

See [`docs/bytecode.md`](docs/bytecode.md) for the full trace and caveats.

## What is verified

| Area | Status | Notes |
|------|--------|-------|
| Class parsing | PASS | constant pool, fields, methods, Code, attributes |
| Interpreter | PASS | integers, longs, floats, doubles, branches, switches |
| Objects / arrays | PASS | constructors, inheritance, interfaces, enums |
| Exceptions | PASS | `athrow`, exception table, catch/finally |
| Strings | PARTIAL | JDK compact strings partially bridged |
| Collections | PARTIAL | `ArrayList`, `HashMap`, `ConcurrentHashMap` shims |
| Reflection | PASS | Class / Method / Field / Constructor / annotations |
| ASM transform | PASS | read, rewrite, `defineClass`, invoke |
| Mixin 0.8.5 | PASS (experimental) | HEAD / RETURN / cancellable verified |
| SRG mapping | PASS | 7436 classes / 48575 methods / 32126 fields |
| WebGL bridge | PASS (experimental) | shader, VBO, EBO, texture, matrix |
| Java source execution | UNSUPPORTED | no in-browser compiler |
| Full Java SE 17 | UNSUPPORTED | not a compatibility claim |
| Forge / ModLauncher | UNSUPPORTED | research target, not done |
| Minecraft client | UNSUPPORTED | not done |

The detailed matrix lives in [`docs/compatibility.md`](docs/compatibility.md) and [`tests/compatibility.md`](tests/compatibility.md).

## Quick start

Requirements:

- Windows PowerShell 5.1+ (scripts are PowerShell; Linux/macOS users can run the equivalent commands manually)
- JDK 17 (for `javac` and for extracting `java.base` / `java.logging`)
- Node.js 18+ (for the static server and the test harness)

```powershell
# 1. Download ASM / Mixin / Guava / Gson and extract JDK classes
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

# 2. Compile the Java test harness
powershell -ExecutionPolicy Bypass -File scripts/build.ps1

# 3. Run the Mixin acceptance test
node lab/run-realmixin.mjs

# 4. Serve the playground
node scripts/serve.mjs
# open http://127.0.0.1:5193/
```

Expected Mixin output:

```text
real mixin HEAD
real mixin RETURN
42
```

## Demo (local, class-file based)

There is **no hosted source editor yet**. The current playground runs precompiled class files.

```powershell
node scripts/serve.mjs
# http://127.0.0.1:5193/
```

Selected pages: `real.html`, `list.html`, `str.html`, `exception.html`, `generic.html`, `anno.html`, `transform.html`, `node.html`, `srg.html`, `modern.html`, `pngindex.html`.

See [`docs/demo.md`](docs/demo.md) for the full list and current limitations. A future source playground requires either server-side compilation or an in-browser Java compiler; neither is implemented.

> The `lab/` directory was originally an internal playground. Some legacy pages are still useful, but only the Mixin harness is treated as a stable test in this phase.

## Repository layout

The target long-term layout is modular; the current repository keeps the original lab files together so the working code is not broken by a risky refactor.

```text
jvm-research-lab/
├─ README.md
├─ LICENSE                  Apache-2.0
├─ NOTICE
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ CHANGELOG.md
├─ docs/
│  ├─ architecture.md
│  ├─ runtime-spec.md
│  ├─ compatibility.md
│  ├─ bytecode.md
│  └─ security-model.md
├─ lab/                     working playground + runtime
│  ├─ jvm.js                class-file parser
│  ├─ vm2.js                interpreter + native bridges
│  ├─ *.html                experiment pages
│  ├─ *.java                Mixin / service test harness
│  ├─ resources/            class bytes and fixtures
│  └─ srg-map.json          SRG mapping generated from 1.20.1.tsrg
├─ scripts/
│  ├─ setup.ps1
│  ├─ build.ps1
│  ├─ test-mixin.ps1
│  └─ serve.mjs
├─ tests/
│  └─ compatibility.md
├─ vendor/                  downloaded jars (git-ignored)
└─ .gitignore
```

Planned mapping to the modular layout:

| Current | Target |
|---------|--------|
| `lab/jvm.js` | `runtime/interpreter/` |
| `lab/vm2.js` | `runtime/interpreter/` + `libraries/` |
| `lab/Mini*.java` | `runtime/classloader/`, `bytecode/mixin/` |
| `lab/srg-map.json` | `bytecode/mappings/` |
| `lab/*.html` | `frontend/` / `graphics/` |
| `run-realmixin.mjs` | `tests/bytecode/` |

## Design boundaries

- **No default native code execution.** Native bridges are explicit JS functions; there is no generic `dlopen`/`eval` bridge.
- **No default filesystem access.** File APIs are shims; the browser build does not read local files.
- **Experimental modules are opt-in.** `Unsafe`, `defineClass`, and native bridges are documented as experimental and are not a security sandbox.
- **Untrusted class files must not be treated as safe.** This is a research runtime, not a hardened sandbox.

Read [`SECURITY.md`](SECURITY.md) and [`docs/security-model.md`](docs/security-model.md) before running untrusted bytecode.

## Third-party components

The repository does **not** commit third-party binaries. `scripts/setup.ps1` downloads:

- ASM 9.8 (BSD-3-Clause)
- SpongePowered Mixin 0.8.5 (MIT)
- Guava 31.1-jre (Apache-2.0)
- Gson 2.10 (Apache-2.0)
- OpenJDK 17 `java.base` / `java.logging` classes (GPLv2 + Classpath Exception)

See [`NOTICE`](NOTICE) for details. Do not redistribute extracted JDK classes without complying with the OpenJDK license.

## License

The original source in this repository is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).

## Status

Research prototype. Interfaces and internal shims change frequently. Not production software, not a Java SE compatibility statement, and not affiliated with Mojang, Microsoft, or SpongePowered.
