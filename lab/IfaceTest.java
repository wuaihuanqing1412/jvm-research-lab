interface Greeter {
  default String greet(String name) {
    return "hi " + name;
  }

  static int twice(int x) {
    return x * 2;
  }
}

class Impl implements Greeter {
}

public class IfaceTest {
  public static void main(String[] args) {
    Greeter g = new Impl();
    System.out.println(g.greet("bob"));
    System.out.println(Greeter.twice(21));

    int n = 7;
    String s = "x" + n + "!";
    System.out.println(s);
  }
}
