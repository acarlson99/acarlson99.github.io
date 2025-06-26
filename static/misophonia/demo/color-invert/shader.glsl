#define PI 3.141592653589

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  //   vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
  vec4 c = texture(u_texture0, uv);
  c.rgb = 1. - c.rgb;
  fragColor = c;
}
