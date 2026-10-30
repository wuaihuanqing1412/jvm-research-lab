import java.util.ArrayList;

public class ListTest {
  public static void main(String[] args) {
    ArrayList list = new ArrayList();
    list.add("alpha");
    System.out.println(list.size());
    list.add("beta");
    System.out.println(list.size());
    list.add("gamma");
    System.out.println(list.size());
    System.out.println(list.get(0));
    System.out.println(list.get(1));
    System.out.println(list.get(2));
  }
}
