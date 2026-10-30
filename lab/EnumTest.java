enum Color {
  RED,
  GREEN,
  BLUE
}

public class EnumTest {
  public static void main(String[] args) {
    Color c = Color.GREEN;
    System.out.println(c.name());
    System.out.println(c.ordinal());

    Color[] all = Color.values();
    System.out.println(all.length);
    System.out.println(all[2].name());
  }
}
