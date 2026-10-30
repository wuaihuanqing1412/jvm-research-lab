import org.spongepowered.asm.mixin.MixinEnvironment;
import sun.misc.Unsafe;

import java.lang.reflect.Field;

public class MixinServiceTest {
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
    System.out.println("phase " + env.getPhase());
  }
}
