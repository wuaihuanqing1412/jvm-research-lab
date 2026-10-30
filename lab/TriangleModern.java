import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL20;

public class TriangleModern {
  public static void main(String[] args) {
    int vs = GL20.glCreateShader(GL20.GL_VERTEX_SHADER);
    GL20.glShaderSource(vs, "attribute vec2 pos; void main(){ gl_Position = vec4(pos, 0.0, 1.0); }");
    GL20.glCompileShader(vs);

    int fs = GL20.glCreateShader(GL20.GL_FRAGMENT_SHADER);
    GL20.glShaderSource(fs, "precision mediump float; void main(){ gl_FragColor = vec4(0.25, 0.8, 1.0, 1.0); }");
    GL20.glCompileShader(fs);

    int p = GL20.glCreateProgram();
    GL20.glAttachShader(p, vs);
    GL20.glAttachShader(p, fs);
    GL20.glLinkProgram(p);
    GL20.glUseProgram(p);

    float[] data = { -0.6f, -0.5f, 0.6f, -0.5f, 0.0f, 0.7f };
    int vbo = GL15.glGenBuffers();
    GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);
    GL15.glBufferData(GL15.GL_ARRAY_BUFFER, data, GL15.GL_STATIC_DRAW);

    int loc = GL20.glGetAttribLocation(p, "pos");
    GL20.glEnableVertexAttribArray(loc);
    GL20.glVertexAttribPointer(loc, 2, GL11.GL_FLOAT, false, 0, 0L);

    GL11.glClearColor(0.04f, 0.04f, 0.07f, 1f);
    GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);
    GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, 3);
  }
}
