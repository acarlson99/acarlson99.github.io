shadertoy pre/postamble

```glsl
#version 300 es

#ifdef GL_ES
precision mediump float;
#endif
#define iTime u_time
#define iResolution u_resolution

#define iChannel0 u_texture0
#define iChannel1 u_texture1

#define PI 3.141592653589

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_texture0;

out vec4 outColor;

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
  vec2 uv = fragCoord / iResolution.xy;
  // vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
  // ...
}

void main() {
    mainImage(outColor, gl_FragCoord.xy);
}
```

sometimes add the following

```
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
```
