public class Hook {
  public static void before(Object self) {
    System.out.println("before");
  }

  public static void beforeReturn(Object self) {
    System.out.println("beforeReturn");
  }

  public static boolean cancel(Object self) {
    return false;
  }
}
