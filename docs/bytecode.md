# Bytecode, ASM, Mixin and SRG

## ASM transform

A minimal transform reads a class, visits `answer()`, replaces the body, and defines the result:

```java
ClassReader cr = new ClassReader(original);
ClassNode cn = new ClassNode();
cr.accept(cn, ClassReader.SKIP_FRAMES);

for (MethodNode mn : cn.methods) {
  if (!mn.name.equals("answer")) continue;
  mn.instructions.clear();
  mn.instructions.add(new IntInsnNode(Opcodes.BIPUSH, 123));
  mn.instructions.add(new InsnNode(Opcodes.IRETURN));
}

ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
cn.accept(cw);
byte[] transformed = cw.toByteArray();
```

Verified result: `42 → 123`.

Notes:

- `SKIP_FRAMES` is used because the runtime ignores stack-map frames.
- `ClassWriter.COMPUTE_FRAMES` is avoided; `COMPUTE_FRAMES` triggered an `IllegalStateException` in this VM.
- Class identity must be canonical (`getClass() == ClassNode.class`), otherwise ASM's `ClassNode` guard fails.

## Real Mixin 0.8.5

Mixin normally expects a launch environment with `ServiceLoader`, a module layer, and LaunchWrapper/ModLauncher. The lab supplies a minimal adapter:

```text
MixinBootstrap.init()
  → MiniMixinService
  → MixinEnvironment
  → MixinTransformer
  → MixinConfig.prepareMixins
  → MiniBytecodeProvider
  → MixinInfo
  → ClassReader(RealMixin)
```

### Verified case A — cancellable HEAD

```java
@Mixin(targets = "Dynamic")
public class RealMixin {
  @Inject(method = "answer", at = @At("HEAD"), cancellable = true)
  private void onAnswer(CallbackInfoReturnable<Integer> cir) {
    System.out.println("real mixin HEAD");
    cir.setReturnValue(142);
  }
}
```

Output:

```text
in 343 out 1569
real mixin HEAD
142
```

Generated handler:

```text
handler$zzaNaN$onAnswer(CallbackInfoReturnable)V
```

### Verified case B — non-cancellable HEAD + RETURN

```java
@Inject(method = "answer", at = @At("HEAD"))
private void onHead(CallbackInfoReturnable<Integer> cir) { ... }

@Inject(method = "answer", at = @At("RETURN"))
private void onReturn(CallbackInfoReturnable<Integer> cir) { ... }
```

Output:

```text
real mixin HEAD
real mixin RETURN
42
```

### Problems that had to be fixed

1. **`ArrayList.get` overload**
   `get(int)` and `InjectionNodes.get(AbstractInsnNode)` were both intercepted as index lookups. This turned an injection node into the integer `1`.

2. **`ArrayList.add` overload**
   `InjectionNodes.add(AbstractInsnNode)` must wrap the instruction into an `InjectionNode`; a name-only native intercept pushed the raw `InsnNode`.

3. **`cancellable` annotation value**
   The real annotation value decoded as `undefined`. The current workaround forces `cancellable=true`, so HEAD handlers must use `CallbackInfoReturnable`.

4. **Callback bridge**
   `CallbackInfo.cancel/isCancelled` and `CallbackInfoReturnable.setReturnValue/getReturnValue` are native shims.

These are research hacks and are documented so the passing result is not mistaken for full Mixin compatibility.

## SRG mapping

`1.20.1.tsrg` is converted to `lab/srg-map.json`:

- 7436 classes
- 48575 methods
- 32126 fields

The VM resolves a method/field by trying the call-site name, then the mapped SRG/official alternative. The parser and mapping generator are part of the lab history; the generated table is committed for reproducibility.

## Limits

- No `@Redirect`, `@ModifyArg`, `@ModifyVariable`, `@Accessor`, or `@Invoker` tests yet.
- The Mixin service adapter is not a general-purpose launcher.
- Forge/ModLauncher integration is not implemented.

## Next bytecode milestones

1. Decode annotation booleans without forcing `cancellable`.
2. Target a real mod class instead of `Dynamic`.
3. Test `@Inject(at = INVOKE)` and `@Redirect`.
4. Add a compatibility fixture per injection type.
