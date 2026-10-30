import org.spongepowered.asm.mixin.MixinEnvironment;

public class MixinRealTest {
  public static void main(String[] args) {
    System.out.println("start");
    MixinEnvironment env = MixinEnvironment.getDefaultEnvironment();
    System.out.println(env.getPhase());
  }
}
