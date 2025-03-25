shadertoy pre/postamble

```glsl
#define iTime u_time
#define iResolution u_resolution

void main() {
    mainImage(gl_FragColor,gl_FragCoord.xy);
}
```
