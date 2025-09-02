#define PI 3.141592653589

uniform float u_dropoff;
uniform float u_intensity;
uniform vec2 u_direction;
uniform bool u_sameDirection;
uniform bool u_invertDirection;
uniform bool u_useNormalMap;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;

  vec4 normalMap = texture(iChannel2, uv);

  vec2 dir = normalize(u_direction);
  if (u_sameDirection)
    dir = normalize(u_direction - uv);

  // smear in direction
  // or perchance use a normal map??
  if (u_useNormalMap) {
    vec4 normalMap = texture(iChannel2, uv);
    vec3 normal = normalize(normalMap.rgb * 2.0 - 1.0);
    dir = normalize(normal.xy);
  }

  if (u_invertDirection)
    dir *= -1.;

  vec2 offset = dir * u_intensity;

  vec4 smeared = texture(iChannel0, uv + offset);

  vec4 baseImage = texture(iChannel1, uv);
  baseImage *= (sin(iTime * PI * 2. * 2.) * .5 + .5);

  fragColor = mix(smeared, baseImage, u_dropoff);
}
