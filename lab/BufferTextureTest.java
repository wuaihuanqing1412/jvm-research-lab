import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL20;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;

public class BufferTextureTest {
  public static void main(String[] args) throws Exception {
    int vs = GL20.glCreateShader(GL20.GL_VERTEX_SHADER);
    GL20.glShaderSource(vs, "attribute vec2 pos; uniform mat4 mvp; varying vec2 vUV; void main(){ vUV = pos * 0.5 + 0.5; gl_Position = mvp * vec4(pos, 0.0, 1.0); }");
    GL20.glCompileShader(vs);

    int fs = GL20.glCreateShader(GL20.GL_FRAGMENT_SHADER);
    GL20.glShaderSource(fs, "precision mediump float; uniform sampler2D tex; varying vec2 vUV; void main(){ gl_FragColor = texture2D(tex, vUV); }");
    GL20.glCompileShader(fs);

    int p = GL20.glCreateProgram();
    GL20.glAttachShader(p, vs);
    GL20.glAttachShader(p, fs);
    GL20.glLinkProgram(p);
    GL20.glUseProgram(p);

    FloatBuffer m = BufferUtils.createFloatBuffer(16);
    m.put(new float[] { 0.9f, 0f, 0f, 0f, 0f, 0.9f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f });
    m.flip();
    GL20.glUniformMatrix4fv(GL20.glGetUniformLocation(p, "mvp"), false, m);

    int tex = GL20.glGetUniformLocation(p, "tex");
    GL20.glUniform1i(tex, 0);

    InputStream in = BufferTextureTest.class.getResourceAsStream("/block.png");
    byte[] png = in.readAllBytes();
    ByteBuffer bb = BufferUtils.createByteBuffer(png.length);
    bb.put(png);
    bb.flip();

    int texture = GL11.glGenTextures();
    GL11.glBindTexture(GL11.GL_TEXTURE_2D, texture);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_NEAREST);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_NEAREST);
    GL11.glTexImage2D(GL11.GL_TEXTURE_2D, 0, GL11.GL_RGBA, 16, 16, 0, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, bb);

    float[] quad = {
      -0.8f, -0.8f,
      0.8f, -0.8f,
      0.8f, 0.8f,
      -0.8f, -0.8f,
      0.8f, 0.8f,
      -0.8f, 0.8f,
    };
    int vbo = GL15.glGenBuffers();
    GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);
    GL15.glBufferData(GL15.GL_ARRAY_BUFFER, quad, GL15.GL_STATIC_DRAW);

    int loc = GL20.glGetAttribLocation(p, "pos");
    GL20.glEnableVertexAttribArray(loc);
    GL20.glVertexAttribPointer(loc, 2, GL11.GL_FLOAT, false, 0, 0L);

    GL11.glClearColor(0.04f, 0.04f, 0.07f, 1f);
    GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);
    GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, 6);
  }
}
