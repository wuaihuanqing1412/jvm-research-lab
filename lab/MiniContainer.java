import org.spongepowered.asm.launch.platform.container.IContainerHandle;

import java.util.Collection;
import java.util.Collections;

public class MiniContainer implements IContainerHandle {
  public String getAttribute(String name) {
    if ("MixinCompatibilityLevel".equals(name)) return "JAVA_17";
    return null;
  }

  public Collection<IContainerHandle> getNestedContainers() { return Collections.emptyList(); }
}
