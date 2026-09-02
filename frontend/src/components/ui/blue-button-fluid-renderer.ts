export interface BlueButtonFluidRenderer {
  resize(width: number, height: number, pixelRatio: number): void;
  reset(): void;
  move(x: number, y: number): void;
  render(deltaSeconds: number, hovering: boolean): void;
  dispose(): void;
}

const vertexSource = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentPrelude = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform vec2 texel;
vec4 bilinear(sampler2D field, vec2 point) {
  vec2 pixel = point / texel - 0.5;
  vec2 base = (floor(pixel) + 0.5) * texel;
  vec2 f = fract(pixel);
  return mix(mix(texture(field, base), texture(field, base + vec2(texel.x, 0.0)), f.x),
    mix(texture(field, base + vec2(0.0, texel.y)), texture(field, base + texel), f.x), f.y);
}
`;

const fragments = {
  advect: `uniform sampler2D source;
uniform sampler2D velocity;
uniform float dt;
uniform float decay;
void main() {
  vec2 point = uv - dt * bilinear(velocity, uv).xy * texel;
  color = bilinear(source, point) * exp(-decay * dt);
}`,
  splat: `uniform sampler2D source;
uniform vec2 point;
uniform vec3 impulse;
uniform float aspect;
uniform float radius;
uniform float spin;
void main() {
  vec2 offset = (uv - point) * vec2(aspect, 1.0);
  float weight = exp(-dot(offset, offset) / radius);
  vec3 force = impulse + vec3(-offset.y, offset.x, 0.0) * spin;
  color = texture(source, uv) + vec4(force * weight, 0.0);
}`,
  divergence: `uniform sampler2D velocity;
void main() {
  float l = texture(velocity, uv - vec2(texel.x, 0.0)).x;
  float r = texture(velocity, uv + vec2(texel.x, 0.0)).x;
  float b = texture(velocity, uv - vec2(0.0, texel.y)).y;
  float t = texture(velocity, uv + vec2(0.0, texel.y)).y;
  vec2 center = texture(velocity, uv).xy;
  if (uv.x < texel.x) l = -center.x;
  if (uv.x > 1.0 - texel.x) r = -center.x;
  if (uv.y < texel.y) b = -center.y;
  if (uv.y > 1.0 - texel.y) t = -center.y;
  color = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`,
  pressure: `uniform sampler2D pressure;
uniform sampler2D divergence;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  float d = texture(divergence, uv).x;
  color = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`,
  project: `uniform sampler2D pressure;
uniform sampler2D velocity;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  color = vec4(texture(velocity, uv).xy - 0.5 * vec2(r - l, t - b), 0.0, 1.0);
}`,
  display: `uniform sampler2D dye;
void main() {
  vec3 density = max(bilinear(dye, uv).rgb, vec3(0.0));
  vec3 light = (1.0 - exp(-density * 1.4)) * vec3(0.22, 0.30, 0.82);
  color = vec4(light, 1.0);
}`,
};

interface Field {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

interface Program {
  handle: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A small, shared velocity/pressure/dye simulation; no work is scheduled here. */
export function createBlueButtonFluidRenderer(canvas: HTMLCanvasElement): BlueButtonFluidRenderer | null {
  let gl: WebGL2RenderingContext | null;
  try {
    gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  } catch { return null; }
  if (!gl) return null;
  const fields: Field[] = [];
  const programs: Program[] = [];
  const shaders: WebGLShader[] = [];
  const releaseFields = () => {
    fields.splice(0).forEach(({ texture, framebuffer }) => {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
    });
  };
  const dispose = () => {
    releaseFields();
    programs.splice(0).forEach(({ handle }) => gl.deleteProgram(handle));
    shaders.splice(0).forEach((shader) => gl.deleteShader(shader));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  try {
    if (!gl.getExtension("EXT_color_buffer_float")) { dispose(); return null; }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Shader unavailable");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Shader compilation failed");
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const buildProgram = (source: string): Program => {
      const handle = gl.createProgram();
      if (!handle) throw new Error("Program unavailable");
      const program = { handle, uniforms: new Map<string, WebGLUniformLocation | null>() };
      programs.push(program);
      gl.attachShader(handle, vertex);
      gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fragmentPrelude + source));
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error("Program linking failed");
      return program;
    };
    const passes = Object.fromEntries(Object.entries(fragments).map(([name, source]) => [name, buildProgram(source)])) as Record<keyof typeof fragments, Program>;
    let width = 0;
    let height = 0;
    let aspect = 1;
    let simulationWidth = 1;
    let simulationHeight = 1;
    let velocity: [Field, Field];
    let dye: [Field, Field];
    let pressure: [Field, Field];
    let divergence: Field;
    let pointer = { x: .5, y: .5 };
    let elapsed = 0;
    let seed = true;
    const movements: Array<{ x: number; y: number; dx: number; dy: number }> = [];

    const field = (): Field => {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) {
        if (texture) gl.deleteTexture(texture);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        throw new Error("Fluid surface unavailable");
      }
      const result = { texture, framebuffer };
      fields.push(result);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, simulationWidth, simulationHeight, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Fluid surface incomplete");
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return result;
    };
    const location = (program: Program, name: string) => {
      if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.handle, name));
      return program.uniforms.get(name)!;
    };
    const pass = (program: Program, output: Field | null, textures: Record<string, Field>, values: Record<string, number | number[]> = {}) => {
      gl.useProgram(program.handle);
      gl.uniform2f(location(program, "texel"), 1 / simulationWidth, 1 / simulationHeight);
      Object.entries(textures).forEach(([name, input], unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, input.texture);
        gl.uniform1i(location(program, name), unit);
      });
      Object.entries(values).forEach(([name, value]) => {
        const uniform = location(program, name);
        if (typeof value === "number") gl.uniform1f(uniform, value);
        else if (value.length === 2) gl.uniform2f(uniform, value[0], value[1]);
        else gl.uniform3f(uniform, value[0], value[1], value[2]);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, output?.framebuffer ?? null);
      gl.viewport(0, 0, output ? simulationWidth : canvas.width, output ? simulationHeight : canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const swap = (pair: [Field, Field]) => { [pair[0], pair[1]] = [pair[1], pair[0]]; };
    const splat = (x: number, y: number, dx: number, dy: number, strength: number) => {
      const point = [x, y];
      pass(passes.splat, velocity[1], { source: velocity[0] }, {
        point, aspect, radius: .045, spin: 220 * strength,
        impulse: [clamp(dx * simulationWidth * 16, -220, 220), clamp(dy * simulationHeight * 16, -160, 160), 0],
      });
      swap(velocity);
      pass(passes.splat, dye[1], { source: dye[0] }, {
        point, aspect, radius: .025, spin: 0,
        impulse: [strength * .45, strength * .8, strength],
      });
      swap(dye);
    };

    return {
      reset() {
        movements.length = 0;
        pointer = { x: .5, y: .5 };
        elapsed = 0;
        seed = true;
        if (gl.isContextLost()) return;
        gl.clearColor(0, 0, 0, 0);
        for (const { framebuffer } of fields) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      resize(nextWidth, nextHeight, pixelRatio) {
        const nextPixelWidth = Math.round(nextWidth * clamp(pixelRatio, 1, 2));
        const nextPixelHeight = Math.round(nextHeight * clamp(pixelRatio, 1, 2));
        if (width === nextWidth && height === nextHeight && canvas.width === nextPixelWidth && canvas.height === nextPixelHeight) return;
        width = Math.max(1, nextWidth);
        height = Math.max(1, nextHeight);
        aspect = width / height;
        canvas.width = nextPixelWidth;
        canvas.height = nextPixelHeight;
        simulationWidth = Math.round(clamp(aspect * 48, 48, 256));
        simulationHeight = Math.round(clamp(simulationWidth / aspect, 24, 96));
        releaseFields();
        velocity = [field(), field()];
        dye = [field(), field()];
        pressure = [field(), field()];
        divergence = field();
        seed = true;
        movements.length = 0;
      },
      move(x, y) {
        const next = { x: clamp(x, 0, 1), y: 1 - clamp(y, 0, 1) };
        if (!seed && movements.length < 16) movements.push({ ...next, dx: next.x - pointer.x, dy: next.y - pointer.y });
        pointer = next;
      },
      render(deltaSeconds, hovering) {
        if (!width || !height || gl.isContextLost()) return;
        const dt = clamp(deltaSeconds, 1 / 120, 1 / 30);
        elapsed += dt;
        if (seed) {
          splat(pointer.x, pointer.y, .025, .03, 1.25);
          seed = false;
        }
        movements.splice(0).forEach(({ x, y, dx, dy }) => splat(x, y, dx, dy, .55));
        if (hovering) {
          splat(pointer.x + Math.sin(elapsed * 2.2) * .045 / aspect, pointer.y + Math.cos(elapsed * 1.7) * .065, .002, -.001, dt * .8);
        }
        pass(passes.advect, velocity[1], { source: velocity[0], velocity: velocity[0] }, { dt, decay: 1.6 });
        swap(velocity);
        pass(passes.divergence, divergence, { velocity: velocity[0] });
        gl.bindFramebuffer(gl.FRAMEBUFFER, pressure[0].framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (let iteration = 0; iteration < 10; iteration += 1) {
          pass(passes.pressure, pressure[1], { pressure: pressure[0], divergence });
          swap(pressure);
        }
        pass(passes.project, velocity[1], { velocity: velocity[0], pressure: pressure[0] });
        swap(velocity);
        pass(passes.advect, dye[1], { source: dye[0], velocity: velocity[0] }, { dt, decay: 1.15 });
        swap(dye);
        pass(passes.display, null, { dye: dye[0] });
      },
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}
