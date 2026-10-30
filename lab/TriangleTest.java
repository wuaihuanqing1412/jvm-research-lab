import org.lwjgl.opengl.GL11;

public class TriangleTest {
  public static void main(String[] args) {
    GL11.glClearColor(0.04f, 0.04f, 0.07f, 1f);
    GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);

    GL11.glBegin(GL11.GL_TRIANGLES);
    GL11.glColor3f(1f, 0.72f, 0.25f);
    GL11.glVertex2f(-0.6f, -0.5f);
    GL11.glVertex2f(0.6f, -0.5f);
    GL11.glVertex2f(0f, 0.7f);
    GL11.glEnd();
  }
}
