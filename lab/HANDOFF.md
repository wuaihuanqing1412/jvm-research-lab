# HANDOFF：自研 JVM 跑真实 Mixin

## 状态：inject/2 + HEAD/RETURN 均通过 ✅

真实 sponge-mixin 0.8.5 在自研 JVM 上完成了：

1. cancellable HEAD 注入（42 → 142）
2. 非 cancellable HEAD + RETURN 注入（副作用 + 原方法 42）

### 用例 A：cancellable HEAD

```
in 343 out 1569
real mixin HEAD
142
```

- `Dynamic.answer()` 原本返回 42
- `RealMixin` 在 HEAD 注入并 `cir.setReturnValue(142)`
- 生成的 handler：`handler$zzaNaN$onAnswer(CallbackInfoReturnable)V`
- 最终返回 142

### 用例 B：非 cancellable HEAD + RETURN

```
in 343 out 1874
real mixin HEAD
real mixin RETURN
42
```

- HEAD 只做副作用，不取消
- RETURN 注入同样生效
- 原方法仍返回 42


## 路径

```
项目：C:\Users\huanq\Desktop\mod\MODcreative\apocalypse-ends-site
实验：shots\jvm-lab
```

## 已实现

- Java 17 class 解析 + 解释器 + JDK 懒加载
- 反射 / 注解 / 枚举 / 泛型 / 内部类
- defineClass / Unsafe / ASM 变换
- 自研 MiniMixin（HEAD / RETURN / cancellable）
- SRG 映射
- Java → LWJGL → WebGL
- 真实 sponge-mixin：MixinEnvironment / MixinTransformer / MixinConfig / MixinInfo
- 真实 `@Inject(at=HEAD, cancellable=true)` + `CallbackInfoReturnable`

## 本轮关键修复

1. `ArrayList.get` 重载误判
   - `get(int)` 与 `get(AbstractInsnNode)` 被同一个 native 分支拦截
   - 导致 `InjectionNode` 被当成整数 1
   - 修复：只有 `typeof args[0] === 'number'` 才走索引 get

2. `CallbackInfo` / `CallbackInfoReturnable` 原生语义
   - `cancel()` / `isCancelled()`
   - `setReturnValue()` / `getReturnValue()`

3. `cancellable` 注解值
   - 真实注解读取为 `undefined`
   - 在 `Annotations.getValue` 中强制 `cancellable = true`
   - 使 `CallbackInjector` 生成取消分支和 `getReturnValueI()`

## 关键文件

```
shots\jvm-lab\vm2.js              解释器 + native shim
shots\jvm-lab\jvm.js              class 解析
shots\jvm-lab\mixin\             sponge-mixin 0.8.5
shots\jvm-lab\guava\ gson\ asm\ 依赖
shots\jvm-lab\jdk\classes\       java.base + java.logging
shots\jvm-lab\MiniMixinService.java
shots\jvm-lab\MiniBytecodeProvider.java
shots\jvm-lab\MiniClassProvider.java
shots\jvm-lab\MiniContainer.java
shots\jvm-lab\MiniLogger.java
shots\jvm-lab\MiniConfigStream.java
shots\jvm-lab\ConfigHolder.java
shots\jvm-lab\RealMixin.java
shots\jvm-lab\RealMixinTest.java
shots\jvm-lab\run-realmixin.mjs
```

## 运行

```powershell
$jdk="C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\bin"
cd "C:\Users\huanq\Desktop\mod\MODcreative\apocalypse-ends-site\shots\jvm-lab"

& "$jdk\javac.exe" -proc:none -nowarn -source 17 -target 17 `
  -cp "mixin.jar;asm.jar;asm-tree.jar" -d . `
  MiniClassProvider.java MiniBytecodeProvider.java MiniConfigStream.java `
  MiniContainer.java MiniLogger.java MiniMixinService.java `
  ConfigHolder.java RealMixin.java RealMixinTest.java

node run-realmixin.mjs
```

## 下一步

1. 用例 B：非 cancellable HEAD，只做副作用，原方法仍返回 42
2. `@Inject(at = RETURN)`
3. 把目标从 `Dynamic` 换成真实模组类
4. 再往 Forge / MixinConfig 平台层推进

## 注意

- 必须 `-source 17 -target 17`，不能 `--release 17`
- 必须一次编译全部 service 类
- 项目在桌面，写入需 `danger-full-access`
- PowerShell 双引号会吃掉 `$SubType` / `$Option`，改文件优先用 write/edit
- `vm2.js` 里仍有大量调试日志和 shim
