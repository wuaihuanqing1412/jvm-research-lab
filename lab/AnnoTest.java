import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
@interface Info {
  String name();

  int level();
}

@Info(name = "ae", level = 3)
class Annotated {
  @Info(name = "run", level = 1)
  public void run() {
  }
}

public class AnnoTest {
  public static void main(String[] args) throws Exception {
    Info i = Annotated.class.getAnnotation(Info.class);
    System.out.println(i.name());
    System.out.println(i.level());

    java.lang.reflect.Method m = Annotated.class.getMethod("run");
    Info mi = m.getAnnotation(Info.class);
    System.out.println(mi.name());
    System.out.println(mi.level());
  }
}
