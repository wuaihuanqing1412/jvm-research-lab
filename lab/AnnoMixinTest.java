import java.io.InputStream;
import java.lang.reflect.Method;

public class AnnoMixinTest {
  public static void main(String[] args) throws Exception {
    InputStream targetIn = AnnoMixinTest.class.getResourceAsStream("/dynamic.bin");
    byte[] target = targetIn.readAllBytes();

    InputStream mixinIn = AnnoMixinTest.class.getResourceAsStream("/AnswerMixin.bin");
    byte[] mixin = mixinIn.readAllBytes();

    byte[] transformed = AnnoMixin.transform(target, mixin);

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", transformed, 0, transformed.length);
    Object o = c.getDeclaredConstructor().newInstance();
    Method answer = c.getMethod("answer");
    System.out.println(answer.invoke(o));
  }
}
