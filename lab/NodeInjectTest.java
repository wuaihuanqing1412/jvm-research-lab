import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LabelNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import java.io.InputStream;
import java.lang.reflect.Method;

public class NodeInjectTest {
  public static void main(String[] args) throws Exception {
    InputStream in = NodeInjectTest.class.getResourceAsStream("/dynamic.bin");
    byte[] original = in.readAllBytes();

    ClassReader cr = new ClassReader(original);
    ClassNode cn = new ClassNode();
    cr.accept(cn, ClassReader.SKIP_FRAMES);

    for (MethodNode mn : cn.methods) {
      if (!mn.name.equals("answer")) continue;

      LabelNode skip = new LabelNode();
      InsnList pre = new InsnList();
      pre.add(new VarInsnNode(Opcodes.ALOAD, 0));
      pre.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "Hook", "before", "(Ljava/lang/Object;)V", false));
      pre.add(new VarInsnNode(Opcodes.ALOAD, 0));
      pre.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "Hook", "cancel", "(Ljava/lang/Object;)Z", false));
      pre.add(new JumpInsnNode(Opcodes.IFEQ, skip));
      pre.add(new InsnNode(Opcodes.ICONST_0));
      pre.add(new InsnNode(Opcodes.IRETURN));
      pre.add(skip);
      mn.instructions.insert(pre);

      AbstractInsnNode ret = mn.instructions.getLast();
      InsnList post = new InsnList();
      post.add(new VarInsnNode(Opcodes.ALOAD, 0));
      post.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "Hook", "beforeReturn", "(Ljava/lang/Object;)V", false));
      mn.instructions.insertBefore(ret, post);
      mn.maxStack = 2;
    }

    ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
    cn.accept(cw);
    byte[] transformed = cw.toByteArray();

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", transformed, 0, transformed.length);
    Object o = c.getDeclaredConstructor().newInstance();
    Method answer = c.getMethod("answer");
    System.out.println(answer.invoke(o));
  }
}
