public class Demo2 {
  static class Point {
    int x;
    int y;

    Point(int x, int y) {
      this.x = x;
      this.y = y;
    }

    int sum() {
      return x + y;
    }
  }

  static int[] squares(int n) {
    int[] a = new int[n];
    for (int i = 0; i < n; i++) {
      a[i] = i * i;
    }
    return a;
  }

  public static void main(String[] args) {
    Point p = new Point(3, 4);
    System.out.println(p.sum());

    int[] s = squares(5);
    int total = 0;
    for (int v : s) {
      total += v;
    }
    System.out.println(total);

    StringBuilder b = new StringBuilder();
    b.append("sum=").append(total);
    System.out.println(b.toString());
  }
}
