#define PI 3.141592653589

uniform float u_displaceStrength; // TODO: experiment with shifting displacement
uniform float u_detail;
uniform float u_colorLag;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  // uv.x *= iResolution.x / iResolution.y;

  // Sample distortion map
  float distortion = texture(u_texture2, uv).r;
  vec3 prev = texture(u_texture1, uv).rgb;
  vec2 detail = vec2(sin(iTime * 0.1), cos(iTime * 0.1)) * u_detail;
  detail = vec2(u_detail);

  vec2 off = vec2(cos(distortion * PI * 2. * detail.x),
                  sin(distortion * PI * 2. * detail.y)) *
             u_displaceStrength;
  vec3 curr = texture(u_texture0, uv + off).rgb;

  vec3 diff = curr - prev;
  diff = abs(diff);
  //                        sqrt for better control experience (gets finnicky
  //                        near 1 if not sqrted)
  vec3 col = curr + (diff * sqrt(u_colorLag));
  fragColor = vec4(col, 1.);

  // // Sample distortion map
  // vec3 distortion = texture(iChannel1, uv).rgb;

  // // Calculate displacement offset
  // vec2 offset = (distortion.rg - 0.5) * u_colorLag;

  // // Apply offset to UVs
  // vec3 color = texture(iChannel0, uv + offset).rgb;

  // fragColor = vec4(color, 1.0);
}
