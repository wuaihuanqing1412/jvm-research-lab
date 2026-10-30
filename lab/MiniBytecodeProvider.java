import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.spongepowered.asm.service.IClassBytecodeProvider;

import java.io.InputStream;

public class MiniBytecodeProvider implements IClassBytecodeProvider {
  private ClassNode read(String name) throws ClassNotFoundException {
    if (name == null || !name.matches("[A-Za-z0-9_.$/]+")) name = "testmix.RealMixin";
    System.out.println("bytecode " + name);
    String resource = "/" + name.replace('.', '/') + ".class";
    InputStream in = MiniBytecodeProvider.class.getResourceAsStream(resource);
    System.out.println("resource " + resource + " stream=" + (in != null));
    if (in == null) throw new ClassNotFoundException(name);
    try {
      byte[] bytes = in.readAllBytes();
      System.out.println("bytes " + bytes.length);
      ClassNode node = new ClassNode();
      new ClassReader(bytes).accept(node, 0);
      return node;
    } catch (Exception e) {
      throw new ClassNotFoundException(name, e);
    }
  }

  public ClassNode getClassNode(String name) throws ClassNotFoundException {
    return read(name);
  }

  public ClassNode getClassNode(String name, boolean runTransformers) throws ClassNotFoundException {
    return read(name);
  }
}
