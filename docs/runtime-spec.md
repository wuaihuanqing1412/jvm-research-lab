# Runtime specification (current)

This document describes what the runtime currently accepts. It is not a Java SE specification.

## Input

- Java class files, major version 52–61 in practice (Java 8–17 bytecode)
- Valid constant pool and `Code` attributes
- No verifier: malformed stack maps or descriptors are not rejected up front

## Class loading

- Classes may be supplied up front or fetched on demand by the host harness.
- A missing class raises `MissingClassError`; the harness loads it and retries.
- `<clinit>` runs once per class; failures are surfaced or logged depending on the harness.
- Arrays are represented as JavaScript arrays; reference arrays carry `__class`.

## Execution

Supported:

- `nop`, constants, `ldc` (string/class/number), `ldc_w`, `ldc2_w`
- loads/stores of all primitive widths and references
- stack manipulation: `pop`, `dup`, `dup_x1`, `dup_x2`, `dup2`, `dup2_x1`, `dup2_x2`, `swap`
- arithmetic: int/long/float/double add, sub, mul, div, rem, neg
- bitwise: int/long and/or/xor, shifts
- conversions: i2l/i2f/i2d, l2i/l2f/l2d, f2i/f2l/f2d, d2i/d2l/d2f, i2b/i2c/i2s
- comparisons: `lcmp`, `fcmpl/g`, `dcmpl/g`
- branches: `ifeq/ne/lt/ge/gt/le`, `if_icmp*`, `if_acmp*`, `ifnull/nonnull`, `goto`, `tableswitch`, `lookupswitch`
- fields, arrays, `arraylength`
- `new`, `newarray`, `anewarray`, `multianewarray` (partial)
- invocation: virtual, special, static, interface, invokedynamic (string concat)
- returns
- `athrow`, exception table dispatch
- `monitorenter`/`monitorexit` as no-ops in the single-threaded runtime
- `checkcast`/`instanceof` against the runtime hierarchy
- `wide` (partial)

Not supported / partial:

- `jsr`/`ret`
- full `invokedynamic` beyond `StringConcatFactory`
- `MethodHandle` invocation semantics
- stack map verification
- precise `long` bit patterns beyond 53-bit JavaScript integers
- floating-point edge cases (NaN payloads, signed zero)
- class file versions beyond the tested range

## Object model

- Fields are stored by name, including inherited fields.
- Constructors run in order through `invokespecial`.
- Interface default methods are resolved through the runtime hierarchy.
- Enums are objects with name/ordinal handling in the bridge.
- `Class` objects are canonicalized.

## Reflection

- `Class.forName`, `getDeclaredMethod`, `getMethod`, `getDeclaredField`, `getDeclaredConstructor`
- `Method.invoke`, `Constructor.newInstance`, `Field.get/set`
- annotations, generic signatures, inner classes
- `Class.getModule`/`getPackage` returns minimal shims
- `ServiceLoader` is a shim, not a module-aware implementation

## JDK libraries

Real OpenJDK class files are loaded for:

- `java.base`
- `java.logging`

Some methods are intercepted by native bridges; when a bridge exists, the JDK bytecode for that method is bypassed. This is why compatibility status distinguishes "real JDK class execution" from "native shim".

## Threads and concurrency

There is a single JavaScript thread. `Thread.currentThread()` returns a pseudo thread. `ConcurrentHashMap` is a `Map` shim. `synchronized` is a no-op. `java.util.concurrent` atomic classes are partially shimmed.

## I/O

- resources are an in-memory map
- `File`/`Path`/`Files` are string shims
- no real filesystem, sockets, or native libraries
- `System.out` is a bridge to the browser console/DOM output

## Graphics

- LWJGL `GL11`, `GL15`, `GL20` subset
- shaders, programs, VBO/EBO, textures, uniforms, draw calls
- no framebuffer objects, compute, or multi-context support
