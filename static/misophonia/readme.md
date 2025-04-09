shadertoy pre/postamble

```glsl
#ifdef GL_ES
precision mediump float;
#endif
#define iTime u_time
#define iResolution u_resolution
#define texture(s,p) texture2D(s,p)

uniform float u_time;
uniform vec2 u_resolution;

void main() {
    mainImage(gl_FragColor,gl_FragCoord.xy);
}
```
