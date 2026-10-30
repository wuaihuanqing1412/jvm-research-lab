public class JdkTest {
  public static void main(String[] args) {
    int[] a = {1, 2, 3};
    System.out.println(java.util.Arrays.hashCode(a));
    System.out.println(java.lang.Math.max(3, 9));
    System.out.println(java.lang.Math.abs(-42));
  }
}
