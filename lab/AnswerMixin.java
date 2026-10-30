@Mixin("Dynamic")
public class AnswerMixin {
  @Inject(method = "answer", at = "HEAD")
  public static void onHead(Object self) {
    System.out.println("mixin HEAD");
  }

  @Inject(method = "answer", at = "RETURN")
  public static void onReturn(Object self) {
    System.out.println("mixin RETURN");
  }
}
