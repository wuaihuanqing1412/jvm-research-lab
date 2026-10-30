import java.lang.reflect.Method;
import java.lang.reflect.Type;

class Base<T> {
}

class Child extends Base<String> {
}

class GBox {
  public String label() {
    return "box";
  }
}

public class GenericTest {
  public static void main(String[] args) throws Exception {
    Type t = Child.class.getGenericSuperclass();
    System.out.println(t.getTypeName());

    Method m = GBox.class.getMethod("label");
    System.out.println(m.getReturnType().getName());
    System.out.println(m.getParameterTypes().length);
  }
}
