import java.lang.reflect.Method;

class Box {
  public int value() {
    return 7;
  }

  public String label() {
    return "box";
  }
}

public class ReflectTest {
  public static void main(String[] args) throws Exception {
    Box b = new Box();
    Class<?> c = b.getClass();
    System.out.println(c.getName());

    Method m = c.getMethod("value");
    System.out.println(m.invoke(b));

    Method l = c.getMethod("label");
    System.out.println(l.invoke(b));
  }
}
