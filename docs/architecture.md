# Architecture

## 1. Execution model

JVM Research Lab executes **Java class files**, not Java source.

```text
.java ──javac (outside the lab)──▶ .class ──▶ class parser ──▶ interpreter ──▶ result
```

There is no Java compiler in the browser, no source-to-IR lowering, and no bytecode verifier. The runtime assumes the class file is structurally valid enough to parse; malformed input can crash the page.

This distinction matters for every public claim: the runtime is a **class-file interpreter with partial Java 17 semantics**, not a Java SE implementation and not a source playground.

## 2. Runtime pipeline

```text
             ┌────────────────────────────┐
.class bytes │ jvm.js                     │
────────────▶│ constant pool, fields,     │
             │ methods, Code, attributes  │
             └─────────────┬──────────────┘
                           │ class model
                           ▼
             ┌────────────────────────────┐
             │ vm2.js                     │
             │ stack machine interpreter  │
             │ lazy class loading         │
             │ object/array model         │
             │ native bridges             │
             └───────┬─────────┬──────────┘
                     │         │
        JDK classes  │         │  ASM / Mixin / SRG
        (.class)     │         │  (Java code executed by the VM)
                     ▼         ▼
             real java.base    bytecode experiments
```

### Class parser (`jvm.js`)

Reads:

- constant pool
- access flags, this/super, interfaces
- fields and methods
- `Code`, exception table, line numbers, local variables
- `Signature`, annotations, `InnerClasses`, `BootstrapMethods`
- method handles and invoke-dynamic bootstrap data

It produces plain JavaScript objects consumed by the interpreter. It does not verify stack maps.

### Interpreter (`vm2.js`)

A JavaScript stack machine. Each frame has locals, an operand stack, a program counter, and a reference to the class model. Method invocation is synchronous.

Implemented areas include:

- integer/long/float/double arithmetic and comparison
- branches, switches, `goto`, `jsr` not supported
- objects, arrays, `new`, `newarray`, `anewarray`, `multianewarray` (partial)
- `getfield`/`putfield`, `getstatic`/`putstatic`
- `invokevirtual`, `invokespecial`, `invokestatic`, `invokeinterface`
- `invokedynamic` for string concatenation
- `athrow`, exception tables, catch matching
- `monitorenter`/`monitorexit` as single-threaded no-ops
- `checkcast`, `instanceof` via the runtime class hierarchy
- `ldc` of strings, classes, numbers, method handles

### Object and array model

Java objects are `{ __class, fields }`. Arrays are JavaScript arrays with `__array = true` and, for reference arrays, an `__class` such as `[Ljava/lang/String;`.

Field defaults come from the class model, including inherited fields. Class objects are canonicalized per class name so `getClass() == SomeClass.class` works.

### Lazy class loading

The host page supplies a set of parsed classes. When a class is missing, the VM throws a `MissingClassError`; the harness catches it, fetches the `.class` file, parses it, and retries. `ensureInit` runs `<clinit>` once per class.

### Native bridges

Many JDK behaviours are implemented as JavaScript functions rather than executed JDK bytecode. Examples:

- `String` operations, `StringBuilder`
- `ArrayList`/`HashMap`/`ConcurrentHashMap` shims
- `System.out`, `System.arraycopy`
- `Class`, `Method`, `Field`, `Constructor` reflection
- `ClassLoader.defineClass`, `Unsafe`
- resources and byte arrays
- `java.nio` path/file shims
- LWJGL `GL11`/`GL15`/`GL20` → WebGL

This is the main source of semantic drift. A native bridge can make a test pass while differing from HotSpot behaviour.

## 3. ASM and Mixin

ASM 9.8 runs as ordinary Java bytecode inside the runtime. The VM supports `ClassReader`, `ClassWriter`, `ClassNode`, `MethodNode`, `InsnList`, labels, frames (skipped), and annotation nodes sufficiently for the tested transforms.

Mixin 0.8.5 is loaded from its real jar. Because the browser has no `ServiceLoader`/module layer/`LaunchWrapper`, the lab provides a small service adapter:

- `MiniMixinService implements IMixinService`
- `MiniClassProvider`, `MiniBytecodeProvider`, `MiniLogger`, `MiniContainer`
- a synthetic `MixinConfig` path
- `ConfigHolder` for the test harness

The real `MixinTransformer` then performs the transform. The verified result is a cancellable HEAD injection (`42 → 142`) and a non-cancellable HEAD + RETURN injection (original `42`).

### Known hacks

These are deliberate research shortcuts, not architecture claims:

- `cancellable` annotation decoding is currently forced to `true`; the HEAD handler must therefore use `CallbackInfoReturnable`.
- `MixinConfig` is partly populated by a native Gson bypass.
- `ClassInfo.isInterface`, `Annotations.getValue`, and several collection overloads are patched.
- Stack map frames are skipped inside the VM; the real ASM writer recomputes what it needs for the transformed class.

See [`bytecode.md`](bytecode.md) for the exact trace.

## 4. Graphics bridge

Java code calls LWJGL classes such as `GL11.glDrawArrays`. The VM intercepts those calls and forwards them to a WebGL context. Buffers are JavaScript arrays standing in for direct `ByteBuffer`/`FloatBuffer`.

The demo pages cover:

- shader compilation and linking
- VBO upload and draw calls
- PNG bytes → `Blob` → `ImageBitmap` → texture
- matrix math and uniform upload

No GPU memory model or multi-threaded GL is emulated.

## 5. What is intentionally absent

- bytecode verifier
- JIT
- threads, locks, `java.util.concurrent` semantics
- complete module system / `ServiceLoader`
- full `java.io` / `java.nio` filesystem
- complete network stack
- Forge / ModLauncher / Minecraft client
- garbage collection (JavaScript GC only)

The project is a research platform; absence of a subsystem is documented rather than hidden.
