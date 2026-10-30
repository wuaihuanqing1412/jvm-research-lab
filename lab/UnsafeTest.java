import sun.misc.Unsafe;

import java.lang.reflect.Field;

class UBox {
  int value = 7;

  UBox() {
    value = 7;
  }
}

public class UnsafeTest {
  public static void main(String[] args) throws Exception {
    Field f = Unsafe.class.getDeclaredField("theUnsafe");
    f.setAccessible(true);
    Unsafe u = (Unsafe) f.get(null);

    System.out.println(u.addressSize());

    UBox b = (UBox) u.allocateInstance(UBox.class);
    System.out.println(b.value);

    Field vf = UBox.class.getDeclaredField("value");
    long off = u.objectFieldOffset(vf);
    u.putInt(b, off, 99);
    System.out.println(b.value);
  }
}
