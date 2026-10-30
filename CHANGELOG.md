# Changelog

## 0.1.0 — research baseline

Initial public baseline.

### Runtime

- Java class-file parser
- bytecode interpreter with objects, arrays, inheritance, interfaces
- exception handling
- lazy loading of real OpenJDK 17 `java.base` / `java.logging` classes
- reflection, annotations, enums, generic signatures, inner classes
- native bridges for strings, collections, resources, `Unsafe`, `defineClass`

### Bytecode

- ASM 9.8 read/write/tree transforms
- defineClass round-trip
- SRG mapping from `1.20.1.tsrg`
- real SpongePowered Mixin 0.8.5 environment and transformer
- verified `@Inject(HEAD, cancellable)` → `42 → 142`
- verified non-cancellable `HEAD` + `RETURN` → side effects, original `42`

### Graphics

- Java LWJGL calls bridged to WebGL
- shader/program/VBO/EBO/texture/uniform experiments
- PNG bytes → texture
- matrix math

### Known limitations

- no Java source compiler in the browser
- no bytecode verifier
- no threads or real concurrency
- partial JDK 17 compatibility
- experimental Mixin adapter; annotation boolean decoding is a workaround
- no Forge / ModLauncher / Minecraft client
