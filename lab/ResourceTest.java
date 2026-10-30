import java.io.InputStream;

public class ResourceTest {
  public static void main(String[] args) throws Exception {
    InputStream in = ResourceTest.class.getResourceAsStream("/data.txt");
    byte[] b = in.readAllBytes();
    System.out.println(b.length);
    System.out.println(b[0]);
    System.out.println(b[4]);
    in.close();

    InputStream in2 = ResourceTest.class.getClassLoader().getResourceAsStream("data.txt");
    byte[] c = in2.readAllBytes();
    System.out.println(c.length);
  }
}
