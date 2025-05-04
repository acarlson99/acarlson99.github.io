#version 300 es

#ifdef GL_ES
precision mediump float;
#endif
#define iTime u_time
#define iResolution u_resolution

#define PI 3.141592653589

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_texture0;

out vec4 outColor;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  //   vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
  vec4 c = texture(u_texture0, uv);
  c.rgb = 1. - c.rgb;
  fragColor = c;
}

void main() { mainImage(outColor, gl_FragCoord.xy); }
