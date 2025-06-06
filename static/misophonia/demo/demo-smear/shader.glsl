#define PI 3.141592653589

uniform float u_dropoff;
uniform float u_intensity;
uniform vec2 u_direction;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  // uv.x *= iResolution.x / iResolution.y;

  // Get previous frame (feedback)
  vec4 lastFrame = texture(iChannel0, uv);

  // Get base image
  vec4 baseImage = texture(iChannel1, uv);

  // Smear UVs slightly based on some function (e.g., random noise or offset)
  vec2 offset = vec2(0.01, 0.0); // slight right smear
  // offset =
  // vec2(cos(iTime-atan(uv.x,uv.y)*2.),sin(iTime+atan(uv.x,uv.y)))*0.01;
  offset = normalize(u_direction) * u_intensity;
  // TODO: only "offset" sections matching some pattern/outline maybe?
  // basically, sample a monochrome depth map texture
  vec4 smeared = texture(iChannel0, uv - offset);
  smeared = 1. - ((1. - baseImage) * (1. - smeared));

  // Blend base image and smeared frame
  fragColor = mix(smeared, baseImage, u_dropoff); // 0.95 = strong smear
}
