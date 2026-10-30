import org.spongepowered.asm.logging.ILogger;
import org.spongepowered.asm.logging.Level;

public class MiniLogger implements ILogger {
  private final String id;

  public MiniLogger(String id) {
    this.id = id;
  }

  public String getId() { return id; }
  public String getType() { return "mini"; }
  public void catching(Level level, Throwable t) {}
  public void catching(Throwable t) {}
  public void debug(String message, Object... params) {}
  public void debug(String message, Throwable t) {}
  public void error(String message, Object... params) {
    System.out.println("LOGERROR " + message);
  }
  public void error(String message, Throwable t) {
    System.out.println("LOGERROR " + message + " :: " + (t == null ? "null" : t.getClass().getName() + " " + t.getMessage()));
  }
  public void fatal(String message, Object... params) {}
  public void fatal(String message, Throwable t) {}
  public void info(String message, Object... params) {
    System.out.println("LOGINFO " + message);
  }
  public void info(String message, Throwable t) {
    System.out.println("LOGINFO " + message);
  }
  public void log(Level level, String message, Object... params) {}
  public void log(Level level, String message, Throwable t) {}
  public <T extends Throwable> T throwing(T t) { return t; }
  public void trace(String message, Object... params) {}
  public void trace(String message, Throwable t) {}
  public void warn(String message, Object... params) {}
  public void warn(String message, Throwable t) {}
}
