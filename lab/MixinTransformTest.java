import org.spongepowered.asm.mixin.MixinEnvironment;
import org.spongepowered.asm.mixin.transformer.IMixinTransformer;
import sun.misc.Unsafe;

import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Field;

public class MixinTransformTest {
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

    Class<?> transformerClass = Class.forName("org.spongepowered.asm.mixin.transformer.MixinTransformer");
    Constructor<?> ctor = transformerClass.getDeclaredConstructor();
    ctor.setAccessible(true);
    Object transformer = ctor.newInstance();

    InputStream in = MixinTransformTest.class.getResourceAsStream("/dynamic.bin");
    byte[] original = in.readAllBytes();
    byte[] out = ((IMixinTransformer) transformer).transformClassBytes("Dynamic", "Dynamic", original);

    System.out.println("in " + original.length + " out " + out.length);

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);
    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", out, 0, out.length);
    Object o = c.getDeclaredConstructor().newInstance();
    System.out.println(c.getMethod("answer").invoke(o));
  }
}
