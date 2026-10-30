public class Demo {
  static int fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
  }

  public static void main(String[] args) {
    System.out.println("JVM-FROM-SCRATCH");
    for (int i = 0; i < 10; i++) {
      System.out.println(fib(i));
    }
    int sum = 0;
    for (int i = 1; i <= 100; i++) {
      sum += i;
    }
    System.out.println(sum);
  }
}
