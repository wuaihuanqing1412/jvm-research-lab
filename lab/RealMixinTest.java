import org.spongepowered.asm.mixin.MixinEnvironment;
import org.spongepowered.asm.mixin.transformer.IMixinTransformer;
import sun.misc.Unsafe;

import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

public class RealMixinTest {
  public static void main(String[] args) throws Exception {
    System.out.println("boot");

    Field uf = Unsafe.class.getDeclaredField("theUnsafe");
    uf.setAccessible(true);
    Unsafe unsafe = (Unsafe) uf.get(null);

    Class<?> serviceClass = Class.forName("org.spongepowered.asm.service.MixinService");
    Object service = unsafe.allocateInstance(serviceClass);
    Field instance = serviceClass.getDeclaredField("instance");
    instance.setAccessible(true);
    instance.set(null, service);
    Field field = serviceClass.getDeclaredField("service");
    field.setAccessible(true);
    field.set(service, new MiniMixinService());

    Class<?> bootstrap = Class.forName("org.spongepowered.asm.launch.MixinBootstrap");
    bootstrap.getMethod("init").invoke(null);
    MixinEnvironment env = MixinEnvironment.getDefaultEnvironment();
    env.addConfiguration("mixins.test.json");
    Method gotoPhase = MixinEnvironment.class.getDeclaredMethod("gotoPhase", MixinEnvironment.Phase.class);
    gotoPhase.setAccessible(true);
    gotoPhase.invoke(null, MixinEnvironment.Phase.INIT);
    gotoPhase.invoke(null, MixinEnvironment.Phase.DEFAULT);

    Class<?> transformerClass = Class.forName("org.spongepowered.asm.mixin.transformer.MixinTransformer");
    Constructor<?> ctor = transformerClass.getDeclaredConstructor();
    ctor.setAccessible(true);
    Object transformer = ctor.newInstance();

    Object config = ConfigHolder.get();
    if (config != null) {
      Class<?> configClass = Class.forName("org.spongepowered.asm.mixin.transformer.MixinConfig");
      Field pkgField = configClass.getDeclaredField("mixinPackage");
      pkgField.setAccessible(true);
      Field classesField = configClass.getDeclaredField("mixinClasses");
      classesField.setAccessible(true);
      Field preparedField = configClass.getDeclaredField("prepared");
      preparedField.setAccessible(true);
      preparedField.setBoolean(config, false);
      System.out.println("pkg=" + pkgField.get(config) + " classes=" + classesField.get(config));
      Class<?> extensionsClass = Class.forName("org.spongepowered.asm.mixin.transformer.ext.Extensions");
      Method prepare = configClass.getDeclaredMethod("prepare", extensionsClass);
      prepare.setAccessible(true);
      Object extensions = transformerClass.getMethod("getExtensions").invoke(transformer);
      prepare.invoke(config, extensions);
      System.out.println("config prepared");
    }

    InputStream in = RealMixinTest.class.getResourceAsStream("/dynamic.bin");
    byte[] original = in.readAllBytes();
    byte[] out = ((IMixinTransformer) transformer).transformClassBytes("Dynamic", "Dynamic", original);
    System.out.println("in " + original.length + " out " + out.length);

    org.objectweb.asm.tree.ClassNode dumpNode = new org.objectweb.asm.tree.ClassNode();
    new org.objectweb.asm.ClassReader(out).accept(dumpNode, 0);
    System.out.println("dump methods=" + dumpNode.methods.size() + " fields=" + dumpNode.fields.size());
    for (Object mo : dumpNode.methods) {
      org.objectweb.asm.tree.MethodNode mn = (org.objectweb.asm.tree.MethodNode) mo;
      System.out.println("dump M " + mn.name + mn.desc + " insns=" + mn.instructions.size());
      if (mn.name.equals("answer")) {
        for (org.objectweb.asm.tree.AbstractInsnNode insn = mn.instructions.getFirst(); insn != null; insn = insn.getNext()) {
          if (insn instanceof org.objectweb.asm.tree.MethodInsnNode) {
            org.objectweb.asm.tree.MethodInsnNode call = (org.objectweb.asm.tree.MethodInsnNode) insn;
            System.out.println("  CALL " + call.owner + "." + call.name + call.desc);
          } else {
            System.out.println("  OP " + insn.getOpcode());
          }
        }
      }
    }

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);
    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", out, 0, out.length);
    Object o = c.getDeclaredConstructor().newInstance();
    System.out.println(c.getMethod("answer").invoke(o));
  }
}
