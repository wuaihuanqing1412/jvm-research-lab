public class ExcTest {
  static void boom() {
    throw new RuntimeException("boom");
  }

  public static void main(String[] args) {
    try {
      boom();
      System.out.println("not reached");
    } catch (RuntimeException e) {
      System.out.println("caught RuntimeException");
    }
    System.out.println("after try");
  }
}
