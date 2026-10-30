import java.lang.reflect.Field;
import java.lang.reflect.Method;

class Thing {
  public int a = 1;

  public String hello() {
    return "hi";
  }

  private int secret() {
    return 2;
  }
}

public class MethodsTest {
  public static void main(String[] args) throws Exception {
    Method[] ms = Thing.class.getDeclaredMethods();
    System.out.println(ms.length);
    System.out.println(ms[0].getName());

    Field[] fs = Thing.class.getDeclaredFields();
    System.out.println(fs.length);
    System.out.println(fs[0].getName());
  }
}
