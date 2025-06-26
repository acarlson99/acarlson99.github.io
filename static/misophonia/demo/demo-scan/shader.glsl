#define PI 3.141592653589

mat2 rot(float theta) {
  float s = sin(theta);
  float c = cos(theta);
  return mat2(c, -s, s, c);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // Normalized pixel coordinates (from 0 to 1)
  vec2 uv = fragCoord / iResolution.xy;

  // Time varying pixel color
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));

  vec3 tx = texture(u_texture0, uv).rgb;

  vec3 a = texture(u_texture1, uv).rgb;
  vec3 b = texture(u_texture2, uv).rgb;

  // TODO: handle non-monochrome case maybe
  col = mix(a, b, tx);

#if 0
    col = tx;
    col *= sin(uv.y*PI*.2+length(tx)*PI*1.+iTime)*.5+.5;
#endif

  // Output to screen
  fragColor = vec4(col, 1.);
}
