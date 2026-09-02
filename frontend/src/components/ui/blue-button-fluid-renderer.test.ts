import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueButtonFluidRenderer } from "./blue-button-fluid-renderer";

function context() {
  const loseContext = vi.fn();
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    TEXTURE_2D: 5, TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7,
    TEXTURE_WRAP_S: 8, TEXTURE_WRAP_T: 9, NEAREST: 10, CLAMP_TO_EDGE: 11,
    RGBA16F: 12, RGBA: 13, HALF_FLOAT: 14, FRAMEBUFFER: 15,
    COLOR_ATTACHMENT0: 16, FRAMEBUFFER_COMPLETE: 17, COLOR_BUFFER_BIT: 18,
    TEXTURE0: 19, TRIANGLES: 20,
    getExtension: vi.fn((name: string): { loseContext?: () => void } | null => name === "WEBGL_lose_context" ? { loseContext } : {}),
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true),
    createTexture: vi.fn(() => ({})), createFramebuffer: vi.fn(() => ({})),
    deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
    bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
    bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(), checkFramebufferStatus: vi.fn(() => 17),
    clearColor: vi.fn(), clear: vi.fn(), getUniformLocation: vi.fn((_handle: unknown, name: string) => name),
    useProgram: vi.fn(), uniform1i: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(),
    activeTexture: vi.fn(), viewport: vi.fn(), drawArrays: vi.fn(), isContextLost: vi.fn(() => false),
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as WebGL2RenderingContext);
  return { canvas, gl, loseContext };
}

afterEach(() => vi.restoreAllMocks());

describe("blue-button fluid renderer", () => {
  it("falls back when WebGL is unavailable or blocked", () => {
    const canvas = document.createElement("canvas");
    const getContext = vi.spyOn(canvas, "getContext").mockReturnValue(null);
    expect(createBlueButtonFluidRenderer(canvas)).toBeNull();
    getContext.mockImplementation(() => { throw new Error("Blocked"); });
    expect(createBlueButtonFluidRenderer(canvas)).toBeNull();
  });

  it("releases an unsupported floating-point context", () => {
    const { canvas, gl, loseContext } = context();
    gl.getExtension.mockImplementation((name) => name === "WEBGL_lose_context" ? { loseContext } : null);
    expect(createBlueButtonFluidRenderer(canvas)).toBeNull();
    expect(loseContext).toHaveBeenCalledOnce();
    expect(gl.createShader).not.toHaveBeenCalled();
  });

  it.each(["compile", "link"])("cleans up GPU resources after a %s failure", (failure) => {
    const { canvas, gl, loseContext } = context();
    if (failure === "compile") gl.getShaderParameter.mockReturnValue(false);
    else gl.getProgramParameter.mockReturnValue(false);
    expect(createBlueButtonFluidRenderer(canvas)).toBeNull();
    expect(gl.deleteShader).toHaveBeenCalledTimes(gl.createShader.mock.calls.length);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(gl.createProgram.mock.calls.length);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("keeps resolution bounded, renders actual fluid passes, and does no scheduling itself", () => {
    const { canvas, gl, loseContext } = context();
    const schedule = vi.spyOn(window, "requestAnimationFrame");
    const renderer = createBlueButtonFluidRenderer(canvas)!;
    renderer.resize(1000, 48, 4);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(96);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
    expect(gl.texImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 24, 0, gl.RGBA, gl.HALF_FLOAT, null);
    renderer.resize(1000, 48, 4);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
    renderer.move(.8, .3);
    renderer.render(10, true);
    expect(gl.uniform1f).toHaveBeenCalledWith("dt", 1 / 30);
    expect(gl.uniform2f).toHaveBeenCalledWith("point", .8, .7);
    expect(gl.drawArrays.mock.calls.length).toBeGreaterThanOrEqual(19);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 2000, 96);
    expect(schedule).not.toHaveBeenCalled();
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(7);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(7);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(6);
    expect(gl.deleteShader).toHaveBeenCalledTimes(7);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("reallocates only on resize and bounds queued pointer work", () => {
    const { canvas, gl } = context();
    const renderer = createBlueButtonFluidRenderer(canvas)!;
    renderer.resize(160, 44, 1);
    renderer.resize(200, 44, 1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(7);
    expect(gl.createTexture).toHaveBeenCalledTimes(14);
    renderer.render(1 / 60, false);
    gl.drawArrays.mockClear();
    for (let index = 0; index < 100; index += 1) renderer.move(index / 100, .5);
    renderer.render(1 / 60, false);
    expect(gl.drawArrays.mock.calls.length).toBeLessThan(55);
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(14);
  });

  it("clears every fluid field and the visible canvas, then recreates a fresh first frame", () => {
    const { canvas, gl } = context();
    const renderer = createBlueButtonFluidRenderer(canvas)!;
    renderer.resize(160, 44, 1);
    renderer.move(.8, .3);
    renderer.render(1 / 60, true);
    const initial = {
      scalar: [...gl.uniform1f.mock.calls],
      point: [...gl.uniform2f.mock.calls],
      impulse: [...gl.uniform3f.mock.calls],
    };
    renderer.move(.1, .9);
    renderer.render(.03, true);
    renderer.move(.2, .8);
    gl.clear.mockClear();
    gl.bindFramebuffer.mockClear();
    gl.uniform1f.mockClear();
    gl.uniform2f.mockClear();
    gl.uniform3f.mockClear();

    renderer.reset();
    expect(gl.clear).toHaveBeenCalledTimes(8);
    expect(new Set(gl.bindFramebuffer.mock.calls.map((call) => call[1])).size).toBe(8);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
    renderer.move(.8, .3);
    renderer.render(1 / 60, true);
    expect(gl.uniform1f.mock.calls).toEqual(initial.scalar);
    expect(gl.uniform2f.mock.calls).toEqual(initial.point);
    expect(gl.uniform3f.mock.calls).toEqual(initial.impulse);
    renderer.dispose();
  });

  it("allows cleanup when a framebuffer cannot be created", () => {
    const { canvas, gl } = context();
    const renderer = createBlueButtonFluidRenderer(canvas)!;
    gl.checkFramebufferStatus.mockReturnValue(0);
    expect(() => renderer.resize(160, 44, 1)).toThrow("Fluid surface incomplete");
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledOnce();
    expect(gl.deleteFramebuffer).toHaveBeenCalledOnce();
  });

  it("does not render before sizing or after context loss", () => {
    const { canvas, gl } = context();
    const renderer = createBlueButtonFluidRenderer(canvas)!;
    renderer.render(1 / 60, true);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    renderer.resize(160, 44, 1);
    gl.isContextLost.mockReturnValue(true);
    renderer.render(1 / 60, true);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    renderer.dispose();
  });
});
