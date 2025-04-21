shadertoy pre/postamble

```glsl
#version 300 es

#ifdef GL_ES
precision mediump float;
#endif
#define iTime u_time
#define iResolution u_resolution
#define texture(s,p) texture2D(s,p)

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_texture0;

in vec2 v_texCoord;
out vec4 outColor;

void main() {
    mainImage(outColor,v_texCoord);
}
```
