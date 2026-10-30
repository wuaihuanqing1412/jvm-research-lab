class Outer {
  class Inner {
  }

  static class Nested {
  }
}

public class InnerTest {
  public static void main(String[] args) {
    Class<?>[] cs = Outer.class.getDeclaredClasses();
    System.out.println(cs.length);
    System.out.println(cs[0].getSimpleName());
    System.out.println(cs[1].getSimpleName());

    System.out.println(Outer.Inner.class.getEnclosingClass().getSimpleName());
  }
}
