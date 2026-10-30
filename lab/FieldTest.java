import java.lang.reflect.Field;

class Config {
  public int value = 41;
  public static String name = "ae";
}

public class FieldTest {
  public static void main(String[] args) throws Exception {
    Config c = new Config();
    Field f = Config.class.getDeclaredField("value");
    System.out.println(f.getInt(c));
    f.setInt(c, 42);
    System.out.println(f.getInt(c));

    Field s = Config.class.getDeclaredField("name");
    System.out.println(s.get(null));

    System.out.println(System.getProperty("java.version"));
    System.out.println(System.getProperty("user.dir"));
    System.out.println(System.currentTimeMillis());
  }
}
