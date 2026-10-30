import org.spongepowered.asm.mixin.MixinEnvironment;
import org.spongepowered.asm.service.IClassBytecodeProvider;
import org.spongepowered.asm.service.IClassProvider;
import org.spongepowered.asm.service.IClassTracker;
import org.spongepowered.asm.service.IMixinAuditTrail;
import org.spongepowered.asm.service.IMixinInternal;
import org.spongepowered.asm.service.IMixinService;
import org.spongepowered.asm.service.ITransformerProvider;
import org.spongepowered.asm.util.ReEntranceLock;
import org.spongepowered.asm.launch.platform.container.IContainerHandle;
import org.spongepowered.asm.logging.ILogger;

import java.io.InputStream;
import java.util.Collection;
import java.util.Collections;

public class MiniMixinService implements IMixinService {
  private static final String CONFIG = "{\"required\":true,\"package\":\"\",\"mixins\":[\"RealMixin\"]}";

  public String getName() { return "mini"; }
  public boolean isValid() { return true; }
  public void prepare() {}
  public MixinEnvironment.Phase getInitialPhase() { return MixinEnvironment.Phase.PREINIT; }
  public void offer(IMixinInternal internal) {}
  public void init() {}
  public void beginPhase() {}
  public void checkEnv(Object bootSource) {}
  private final ReEntranceLock lock = new ReEntranceLock(1);
  public ReEntranceLock getReEntranceLock() { return lock; }
  public IClassProvider getClassProvider() { return new MiniClassProvider(); }
  public IClassBytecodeProvider getBytecodeProvider() { return new MiniBytecodeProvider(); }
  public ITransformerProvider getTransformerProvider() { return null; }
  public IClassTracker getClassTracker() { return null; }
  public IMixinAuditTrail getAuditTrail() { return null; }
  public Collection<String> getPlatformAgents() { return Collections.emptyList(); }
  private final MiniContainer container = new MiniContainer();
  public IContainerHandle getPrimaryContainer() { return container; }
  public Collection<IContainerHandle> getMixinContainers() { return Collections.emptyList(); }
  public InputStream getResourceAsStream(String name) {
    System.out.println("resource requested " + name);
    if (name != null && name.endsWith("mixins.test.json")) return new MiniConfigStream(CONFIG);
    if (name != null && name.endsWith("refmap.json")) return new MiniConfigStream("{\"mappings\":{}}");
    return null;
  }
  public String getSideName() { return "CLIENT"; }
  public MixinEnvironment.CompatibilityLevel getMinCompatibilityLevel() { return MixinEnvironment.CompatibilityLevel.JAVA_17; }
  public MixinEnvironment.CompatibilityLevel getMaxCompatibilityLevel() { return MixinEnvironment.CompatibilityLevel.JAVA_17; }
  public ILogger getLogger(String name) { return new MiniLogger(name); }
}
