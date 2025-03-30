shadertoy pre/postamble

```glsl
#ifdef GL_ES
precision mediump float;
#endif
#define iTime u_time
#define iResolution u_resolution

void main() {
    mainImage(gl_FragColor,gl_FragCoord.xy);
}
```
