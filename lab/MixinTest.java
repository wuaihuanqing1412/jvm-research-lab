import java.io.InputStream;
import java.lang.reflect.Method;

public class MixinTest {
  public static void main(String[] args) throws Exception {
    InputStream in = MixinTest.class.getResourceAsStream("/dynamic.bin");
    byte[] original = in.readAllBytes();

    byte[] transformed = MiniMixin.inject(original, "answer", "Hook");

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", transformed, 0, transformed.length);
    Object o = c.getDeclaredConstructor().newInstance();
    Method answer = c.getMethod("answer");
    System.out.println(answer.invoke(o));
  }
}
