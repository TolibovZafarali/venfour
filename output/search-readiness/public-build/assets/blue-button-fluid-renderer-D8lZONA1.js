var e={advect:`uniform sampler2D source;
uniform sampler2D velocity;
uniform float dt;
uniform float decay;
void main() {
  vec2 point = uv - dt * bilinear(velocity, uv).xy * texel;
  color = bilinear(source, point) * exp(-decay * dt);
}`,splat:`uniform sampler2D source;
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
}`,divergence:`uniform sampler2D velocity;
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
}`,pressure:`uniform sampler2D pressure;
uniform sampler2D divergence;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  float d = texture(divergence, uv).x;
  color = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`,project:`uniform sampler2D pressure;
uniform sampler2D velocity;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  color = vec4(texture(velocity, uv).xy - 0.5 * vec2(r - l, t - b), 0.0, 1.0);
}`,display:`uniform sampler2D dye;
void main() {
  vec3 density = max(bilinear(dye, uv).rgb, vec3(0.0));
  vec3 light = (1.0 - exp(-density * 1.4)) * vec3(0.22, 0.30, 0.82);
  color = vec4(light, 1.0);
}`},t=(e,t,n)=>Math.min(n,Math.max(t,e));function n(n){let r;try{r=n.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:`low-power`})}catch{return null}if(!r)return null;let i=[],a=[],o=[],s=()=>{i.splice(0).forEach(({texture:e,framebuffer:t})=>{r.deleteTexture(e),r.deleteFramebuffer(t)})},c=()=>{s(),a.splice(0).forEach(({handle:e})=>r.deleteProgram(e)),o.splice(0).forEach(e=>r.deleteShader(e)),r.getExtension(`WEBGL_lose_context`)?.loseContext()};try{if(!r.getExtension(`EXT_color_buffer_float`))return c(),null;let l=(e,t)=>{let n=r.createShader(e);if(!n)throw Error(`Shader unavailable`);if(o.push(n),r.shaderSource(n,t),r.compileShader(n),!r.getShaderParameter(n,r.COMPILE_STATUS))throw Error(`Shader compilation failed`);return n},u=l(r.VERTEX_SHADER,`#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`),d=e=>{let t=r.createProgram();if(!t)throw Error(`Program unavailable`);let n={handle:t,uniforms:new Map};if(a.push(n),r.attachShader(t,u),r.attachShader(t,l(r.FRAGMENT_SHADER,`#version 300 es
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
`+e)),r.linkProgram(t),!r.getProgramParameter(t,r.LINK_STATUS))throw Error(`Program linking failed`);return n},f=Object.fromEntries(Object.entries(e).map(([e,t])=>[e,d(t)])),p=0,m=0,h=1,g=1,_=1,v,y,b,x,S={x:.5,y:.5},C=0,w=!0,T=[],E=()=>{let e=r.createTexture(),t=r.createFramebuffer();if(!e||!t)throw e&&r.deleteTexture(e),t&&r.deleteFramebuffer(t),Error(`Fluid surface unavailable`);let n={texture:e,framebuffer:t};if(i.push(n),r.bindTexture(r.TEXTURE_2D,e),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA16F,g,_,0,r.RGBA,r.HALF_FLOAT,null),r.bindFramebuffer(r.FRAMEBUFFER,t),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,e,0),r.checkFramebufferStatus(r.FRAMEBUFFER)!==r.FRAMEBUFFER_COMPLETE)throw Error(`Fluid surface incomplete`);return r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT),n},D=(e,t)=>(e.uniforms.has(t)||e.uniforms.set(t,r.getUniformLocation(e.handle,t)),e.uniforms.get(t)),O=(e,t,i,a={})=>{r.useProgram(e.handle),r.uniform2f(D(e,`texel`),1/g,1/_),Object.entries(i).forEach(([t,n],i)=>{r.activeTexture(r.TEXTURE0+i),r.bindTexture(r.TEXTURE_2D,n.texture),r.uniform1i(D(e,t),i)}),Object.entries(a).forEach(([t,n])=>{let i=D(e,t);typeof n==`number`?r.uniform1f(i,n):n.length===2?r.uniform2f(i,n[0],n[1]):r.uniform3f(i,n[0],n[1],n[2])}),r.bindFramebuffer(r.FRAMEBUFFER,t?.framebuffer??null),r.viewport(0,0,t?g:n.width,t?_:n.height),r.drawArrays(r.TRIANGLES,0,3)},k=e=>{[e[0],e[1]]=[e[1],e[0]]},A=(e,n,r,i,a)=>{let o=[e,n];O(f.splat,v[1],{source:v[0]},{point:o,aspect:h,radius:.045,spin:220*a,impulse:[t(r*g*16,-220,220),t(i*_*16,-160,160),0]}),k(v),O(f.splat,y[1],{source:y[0]},{point:o,aspect:h,radius:.025,spin:0,impulse:[a*.45,a*.8,a]}),k(y)};return{reset(){if(T.length=0,S={x:.5,y:.5},C=0,w=!0,!r.isContextLost()){r.clearColor(0,0,0,0);for(let{framebuffer:e}of i)r.bindFramebuffer(r.FRAMEBUFFER,e),r.clear(r.COLOR_BUFFER_BIT);r.bindFramebuffer(r.FRAMEBUFFER,null),r.clear(r.COLOR_BUFFER_BIT)}},resize(e,r,i){let a=Math.round(e*t(i,1,2)),o=Math.round(r*t(i,1,2));(p!==e||m!==r||n.width!==a||n.height!==o)&&(p=Math.max(1,e),m=Math.max(1,r),h=p/m,n.width=a,n.height=o,g=Math.round(t(h*48,48,256)),_=Math.round(t(g/h,24,96)),s(),v=[E(),E()],y=[E(),E()],b=[E(),E()],x=E(),w=!0,T.length=0)},move(e,n){let r={x:t(e,0,1),y:1-t(n,0,1)};!w&&T.length<16&&T.push({...r,dx:r.x-S.x,dy:r.y-S.y}),S=r},render(e,n){if(!p||!m||r.isContextLost())return;let i=t(e,1/120,1/30);C+=i,w&&=(A(S.x,S.y,.025,.03,1.25),!1),T.splice(0).forEach(({x:e,y:t,dx:n,dy:r})=>A(e,t,n,r,.55)),n&&A(S.x+Math.sin(C*2.2)*.045/h,S.y+Math.cos(C*1.7)*.065,.002,-.001,i*.8),O(f.advect,v[1],{source:v[0],velocity:v[0]},{dt:i,decay:1.6}),k(v),O(f.divergence,x,{velocity:v[0]}),r.bindFramebuffer(r.FRAMEBUFFER,b[0].framebuffer),r.clear(r.COLOR_BUFFER_BIT);for(let e=0;e<10;e+=1)O(f.pressure,b[1],{pressure:b[0],divergence:x}),k(b);O(f.project,v[1],{velocity:v[0],pressure:b[0]}),k(v),O(f.advect,y[1],{source:y[0],velocity:v[0]},{dt:i,decay:1.15}),k(y),O(f.display,null,{dye:y[0]})},dispose:c}}catch{return c(),null}}export{n as createBlueButtonFluidRenderer};