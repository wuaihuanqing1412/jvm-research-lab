import org.spongepowered.asm.service.IClassProvider;

import java.net.URL;

public class MiniClassProvider implements IClassProvider {
  public URL[] getClassPath() { return new URL[0]; }
  public Class<?> findClass(String name) throws ClassNotFoundException { return Class.forName(name); }
  public Class<?> findClass(String name, boolean initialize) throws ClassNotFoundException { return Class.forName(name); }
  public Class<?> findAgentClass(String name, boolean initialize) throws ClassNotFoundException { return Class.forName(name); }
}
