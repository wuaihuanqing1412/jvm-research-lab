import java.io.InputStream;
import java.lang.reflect.Method;

public class DefineTest {
  public static void main(String[] args) throws Exception {
    InputStream in = DefineTest.class.getResourceAsStream("/dynamic.bin");
    byte[] bytes = in.readAllBytes();

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", bytes, 0, bytes.length);
    Object o = c.getDeclaredConstructor().newInstance();

    Method answer = c.getMethod("answer");
    System.out.println(answer.invoke(o));

    Method greeting = c.getMethod("greeting");
    System.out.println(greeting.invoke(o));
  }
}
