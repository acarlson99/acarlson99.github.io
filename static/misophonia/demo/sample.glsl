#ifdef GL_ES
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_resolution;

uniform vec3 u_color;
uniform vec2 u_position;
uniform float u_speed;
uniform bool u_mode;
uniform float u_intensity;

void main(void) {
  // Normalize pixel coordinates (0.0 to 1.0)
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Center the coordinates (-0.5 to 0.5) and adjust for aspect ratio
  uv = uv - u_position;
  uv.x *= u_resolution.x / u_resolution.y;

  // Calculate the distance from the center
  float dist = length(uv);

  // Create a wave pattern that varies over time
  float wave = sin(dist * 10.0 + u_time * u_speed * 3.0);

  // Smooth the wave to create a gentle gradient effect
  float intensity = smoothstep(0.3, 0.0, abs(wave));

  // Mix two colors based on the intensity
  vec3 color = mix(u_color, vec3(1.0, 0.8, 0.3), intensity*u_intensity);
  if (u_mode) color = 1.-color;

  gl_FragColor = vec4(color, 1.0);
}
