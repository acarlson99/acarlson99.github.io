#ifdef GL_ES
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_imageTexture;
uniform float u_squares;
uniform vec2 u_uvOff;

void main( void )
{
    // Normalize pixel coordinates (0.0 to 1.0)
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    uv.x *= u_resolution.x/u_resolution.y;
    
    // Define the number of squares per row/column
    float squares = u_squares;//9.;

    // Determine the grid cell (integer coordinate) for the current uv.
    vec2 grid = floor(uv * squares);
    
    // Compute the local coordinate within the square.
    vec2 f = fract(uv * squares);
    
    // Define the rotation angle (in radians). 
    // For example, use -90 degrees (clockwise) as default.
    float angle = -radians(0.0);
    
    // Build the rotation matrix for clockwise rotation.
    mat2 rot = mat2(cos(angle), sin(angle),
                    -sin(angle), cos(angle));
                    
    // Rotate the local coordinate about the center of the square.
    vec2 center = vec2(0.5);
    vec2 rotated_f = (f - center) * rot + center;
    
    // Reconstruct the full UV coordinate for the rotated square.
    vec2 rotated_uv = (grid + rotated_f) / squares + u_uvOff-.25/2.;
    
    // Determine which squares will use which coordinate.
    float checker = mod(grid.x + grid.y, 2.0);
    
    // Sample textures: one with the original uv, one with the rotated uv.
    vec3 sampleNonRotated = texture2D(u_imageTexture, uv).rgb * vec3(1.,1.,1.);
    vec3 sampleRotated    = texture2D(u_imageTexture, rotated_uv).rgb * vec3(1.,1.,1.);
    
    // Mix the two samples based on the checker pattern.
    vec3 color = mix(sampleRotated, sampleNonRotated, checker);
    
    gl_FragColor = vec4(color, 1.0);
}
