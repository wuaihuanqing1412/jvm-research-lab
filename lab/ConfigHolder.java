public class ConfigHolder {
  public static Object value;

  public static void set(Object config) {
    value = config;
  }

  public static Object get() {
    return value;
  }
}
