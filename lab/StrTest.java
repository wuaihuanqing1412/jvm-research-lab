public class StrTest {
  public static void main(String[] args) {
    StringBuilder b = new StringBuilder();
    b.append("JVM");
    System.out.println(b.length());
    System.out.println(b.toString());
    b.append(" rocks");
    System.out.println(b.length());
    System.out.println(b.toString());
  }
}
