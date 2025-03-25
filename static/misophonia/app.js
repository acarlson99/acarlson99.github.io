/***************************************
 * Global Setup & Utility Functions
 ***************************************/
const canvas = document.getElementById('shader-canvas');
const gl = canvas.getContext('webgl');
if (!gl) {
    alert("WebGL is not supported by your browser.");
}

let devMode = false;
if (document.URL.startsWith("http://localhost")) {
    devMode = true;
}

function LOG() {
    if (devMode) console.log(...arguments);
}

const maxLines = 100;
const outputMessages = [];

function logMessage(...args) {
    // Convert each argument to a string.
    const message = args
        .map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        })
        .join(' ');

    // Add the new message to our array.
    outputMessages.push(message);

    // Remove the oldest message if we exceed maxLines.
    if (outputMessages.length > maxLines) {
        outputMessages.shift();
    }

    // Update the output element's text content.
    const outputEl = document.getElementById('output');
    outputEl.textContent = outputMessages.join('\n');

    // Scroll the output container to the bottom so that the latest message is visible.
    const container = document.getElementById('output-container');
    container.scrollTop = container.scrollHeight;
}
function logMessageErr(...args) {
    logMessage("ERROR:", ...args)
}

// Global object to store control values
let customUniforms = {};

// Convert hex color string to normalized RGB array
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(x => x + x).join('');
    }
    const intVal = parseInt(hex, 16);
    return [
        ((intVal >> 16) & 255) / 255,
        ((intVal >> 8) & 255) / 255,
        (intVal & 255) / 255
    ];
}

// mix helper function
function mix(a, b, t) {
    return a * (1 - t) + b * t;
}

/***************************************
 * Canvas Dimension Management
 ***************************************/
function updateCanvasDimensions() {
    const width = parseInt(document.getElementById('canvas-width').value, 10);
    const height = parseInt(document.getElementById('canvas-height').value, 10);
    if (!isNaN(width) && !isNaN(height)) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
}
document.getElementById('update-canvas-dimensions')
    .addEventListener('click', updateCanvasDimensions);
updateCanvasDimensions(); // Initialize on load

/***************************************
 * Image Texture Setup
 ***************************************/
let imageTexture = gl.createTexture();
function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}
document.getElementById('image-upload').addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA,
            gl.RGBA, gl.UNSIGNED_BYTE, img
        );

        if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
            // For power-of-two textures, enable mipmapping.
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            // For NPOT textures, disable mipmapping and set wrapping to CLAMP_TO_EDGE.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
        console.log("Image texture loaded from file.");
    };
    img.src = URL.createObjectURL(file);
    img.width = 200;
    img.height = 200;
    document.getElementById("image-upload-container").appendChild(img);
});

/***************************************
 * Shader Renderer Setup
 ***************************************/
const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

let fragmentShaderSource = `
  #ifdef GL_ES
  precision mediump float;
  #endif
  uniform float u_time;
  uniform vec2 u_resolution;
  void main(void) {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv = uv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    float dist = length(uv);
    float wave = sin(dist * 10.0 - u_time * 3.0);
    float intensity = smoothstep(0.3, 0.0, abs(wave));
    vec3 color = mix(vec3(0.2, 0.1, 0.5), vec3(1.0, 0.8, 0.3), intensity);
    gl_FragColor = vec4(color, 1.0);
  }
`;

let shaderProgram = createProgram(gl, vertexShaderSource, fragmentShaderSource);
if (!shaderProgram) {
    console.error("Failed to initialize the shader program.");
}

let timeLocation, resolutionLocation, audioTextureLocation, imageTextureLocation;
function updateUniformLocations() {
    timeLocation = gl.getUniformLocation(shaderProgram, 'u_time');
    resolutionLocation = gl.getUniformLocation(shaderProgram, 'u_resolution');
    audioTextureLocation = gl.getUniformLocation(shaderProgram, 'u_audioTexture');
    imageTextureLocation = gl.getUniformLocation(shaderProgram, 'u_imageTexture');
}
updateUniformLocations();

// Helper functions for shader compilation and linking
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        let e = gl.getShaderInfoLog(shader);
        console.error("Shader compile error:", e);
        logMessageErr("Shader compile error:", e);
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program linking error:", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

// Setup full-screen quad geometry
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

/***************************************
 * Audio Setup: Creating an Audio Texture
 ***************************************/
navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        window.audioAnalyser = analyser;
        window.audioDataArray = dataArray;
    })
    .catch(err => console.error("Error accessing microphone:", err));

let audioTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, audioTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
// Allocate initial texture (using default size if audioDataArray is not ready)
gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.LUMINANCE,
    window.audioDataArray ? window.audioDataArray.length : 128, 1,
    0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null
);

/***************************************
 * Control Panel Setup & Rendering
 ***************************************/
const defaultControlSchema = { "controls": [] };

function renderControls(schema) {
    const container = document.getElementById('controls-container');
    schema.controls.forEach(control => {
        const controlDiv = document.createElement('div');
        controlDiv.className = 'control';
        const label = document.createElement('label');
        label.textContent = control.label;
        controlDiv.appendChild(label);
        let inputElement;
        // Initialize uniform value
        customUniforms[control.uniform] = control.default;
        // Create input element based on control type
        switch (control.type) {
            case 'knob':
            case 'slider':
                inputElement = document.createElement('input');
                inputElement.type = 'range';
                inputElement.min = control.min;
                inputElement.max = control.max;
                inputElement.step = control.step;
                inputElement.value = control.default;
                inputElement.addEventListener('input', e => {
                    customUniforms[control.uniform] = parseFloat(e.target.value);
                });
                break;
            case 'button':
                inputElement = document.createElement('button');
                inputElement.textContent = control.label;
                inputElement.addEventListener('click', () => {
                    customUniforms[control.uniform] = true;
                    console.log(`Action ${control.action} triggered for ${control.uniform}`);
                });
                break;
            case 'toggle':
                inputElement = document.createElement('input');
                inputElement.type = 'checkbox';
                inputElement.checked = control.default;
                inputElement.addEventListener('change', e => {
                    customUniforms[control.uniform] = e.target.checked;
                });
                break;
            case 'xy-plane':
                inputElement = document.createElement('div');
                inputElement.className = 'xy-plane';

                // Create a grid overlay for guideline lines.
                const grid = document.createElement('div');
                grid.className = 'xy-grid';
                inputElement.appendChild(grid);

                // Calculate normalized default values.
                const normX = (control.default.x - control.min.x) / (control.max.x - control.min.x);
                const normY = (control.default.y - control.min.y) / (control.max.y - control.min.y);

                // Create the indicator element.
                // Use normalized default values to position the indicator.
                const indicator = document.createElement('div');
                indicator.className = 'xy-indicator';
                indicator.style.left = (normX * 200) + 'px';
                indicator.style.top = ((1 - normY) * 200) + 'px';
                inputElement.appendChild(indicator);

                // Create labels for min and max values.
                const minLabel = document.createElement('div');
                minLabel.className = 'xy-label xy-label-min';
                minLabel.innerText = `Min: ${control.min.x}, ${control.min.y}`;
                inputElement.appendChild(minLabel);

                const maxLabel = document.createElement('div');
                maxLabel.className = 'xy-label xy-label-max';
                maxLabel.innerText = `Max: ${control.max.x}, ${control.max.y}`;
                inputElement.appendChild(maxLabel);

                // Create an info bubble for displaying the current XY value.
                const infoBubble = document.createElement('div');
                infoBubble.className = 'xy-info-bubble';
                infoBubble.style.display = 'none';
                inputElement.appendChild(infoBubble);

                // Update function that moves the indicator and updates the info bubble.
                function updateXY(e) {
                    const rect = inputElement.getBoundingClientRect();
                    const rawX = e.clientX - rect.left;
                    const rawY = e.clientY - rect.top;
                    const clampedX = Math.min(Math.max(rawX, 0), rect.width);
                    const clampedY = Math.min(Math.max(rawY, 0), rect.height);

                    // Position the indicator.
                    indicator.style.left = clampedX + 'px';
                    indicator.style.top = clampedY + 'px';

                    // Map raw values to the control's min/max range.
                    // For x: left (0) -> min.x and right (rect.width) -> max.x.
                    let x = mix(control.min.x, control.max.x, clampedX / rect.width);
                    // For y: bottom (rect.height) -> min.y and top (0) -> max.y.
                    let y = mix(control.min.y, control.max.y, 1 - (clampedY / rect.height));

                    LOG("x,y=", x, y);
                    customUniforms[control.uniform] = { x, y };

                    // Update the info bubble's text and position.
                    infoBubble.innerText = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
                    // Position the bubble to the right of the indicator and slightly above.
                    infoBubble.style.left = (clampedX + 50) + 'px';
                    infoBubble.style.top = (clampedY - 25) + 'px';
                }

                inputElement.addEventListener('mousedown', e => {
                    // Show the info bubble when the user begins interaction.
                    infoBubble.style.display = 'block';
                    updateXY(e);

                    function onMouseMove(e) {
                        updateXY(e);
                    }

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', function onMouseUp() {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        // Hide the bubble when the user releases the mouse.
                        infoBubble.style.display = 'none';
                    });
                });
                break;
            case 'color-picker':
                inputElement = document.createElement('input');
                inputElement.type = 'color';
                inputElement.value = control.default;
                inputElement.addEventListener('input', e => {
                    customUniforms[control.uniform] = e.target.value;
                });
                break;
            case 'dropdown':
                inputElement = document.createElement('select');
                control.options.forEach(option => {
                    const opt = document.createElement('option');
                    opt.value = option;
                    opt.textContent = option;
                    if (option === control.default) opt.selected = true;
                    inputElement.appendChild(opt);
                });
                inputElement.addEventListener('change', e => {
                    customUniforms[control.uniform] = e.target.value;
                });
                break;
            case 'text-input':
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.value = control.default;
                inputElement.addEventListener('input', e => {
                    customUniforms[control.uniform] = e.target.value;
                });
                break;
            default:
                console.warn(`Unknown control type: ${control.type}`);
        }
        if (inputElement) controlDiv.appendChild(inputElement);
        container.appendChild(controlDiv);
    });
}
document.addEventListener('DOMContentLoaded', () => {
    renderControls(defaultControlSchema);
});

/***************************************
 * Directory (Folder) Upload Setup
 ***************************************/
document.getElementById('folder-upload').addEventListener('change', handleFolderUpload);

function handleFolderUpload(event) {
    const files = event.target.files;
    let schemaFile = null;
    let shaderFile = null;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) {
            schemaFile = file;
        } else if (name.endsWith('.glsl') || name.endsWith('.frag') || name.endsWith('.txt')) {
            shaderFile = file;
        }
    }
    if (!schemaFile) {
        console.error("No JSON schema file found in the directory.");
        return;
    }
    if (!shaderFile) {
        console.error("No GLSL shader file found in the directory.");
        return;
    }
    let newSchemaData = null;
    let newShaderSource = null;
    const schemaReader = new FileReader();
    schemaReader.onload = e => {
        try {
            newSchemaData = JSON.parse(e.target.result);
        } catch (err) {
            console.error("Error parsing JSON schema:", err);
        }
        checkAndApply();
    };
    schemaReader.readAsText(schemaFile);
    const shaderReader = new FileReader();
    shaderReader.onload = e => {
        newShaderSource = e.target.result;
        checkAndApply();
    };
    shaderReader.readAsText(shaderFile);
    function checkAndApply() {
        if (newSchemaData && newShaderSource) {
            fragmentShaderSource = newShaderSource;
            const newProgram = createProgram(gl, vertexShaderSource, fragmentShaderSource);
            if (newProgram) {
                shaderProgram = newProgram;
                updateUniformLocations();
                logMessage("Shader updated from folder successfully!");
            } else {
                logMessageErr("Failed to compile shader from folder.");
            }
            const controlsContainer = document.getElementById('controls-container');
            controlsContainer.innerHTML = "";
            renderControls(newSchemaData);
        }
    }
}

/***************************************
 * Main Render Loop
 ***************************************/
function updateCustomUniforms() {
    for (let name in customUniforms) {
        const value = customUniforms[name];
        const loc = gl.getUniformLocation(shaderProgram, name);
        if (loc === null) continue;
        if (typeof value === 'number') {
            gl.uniform1f(loc, value);
        } else if (typeof value === 'boolean') {
            gl.uniform1i(loc, value ? 1 : 0);
        } else if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value) {
            gl.uniform2f(loc, value.x, value.y);
        } else if (typeof value === 'string') {
            if (value.startsWith('#')) {
                const rgb = hexToRgb(value);
                gl.uniform3f(loc, rgb[0], rgb[1], rgb[2]);
            } else {
                gl.uniform1f(loc, parseFloat(value) || 0);
            }
        }
    }
}

let isPaused = false;
let lastFrameTime = 0;   // Last timestamp from requestAnimationFrame
let effectiveTime = 0;   // Accumulated animation time (in ms)
function render(time) {
    if (lastFrameTime === 0) lastFrameTime = time;
    const delta = time - lastFrameTime;
    lastFrameTime = time;

    // Only update effectiveTime if not paused.
    if (!isPaused) {
        effectiveTime += delta;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderProgram);
    updateCustomUniforms();
    if (timeLocation) gl.uniform1f(timeLocation, effectiveTime * 0.001);
    if (resolutionLocation) gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

    if (imageTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    }
    if (imageTextureLocation) {
        gl.uniform1i(imageTextureLocation, 1);
    }

    // Update the audio texture from the analyser data
    if (window.audioAnalyser && window.audioDataArray) {
        window.audioAnalyser.getByteFrequencyData(window.audioDataArray);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, audioTexture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.LUMINANCE,
            window.audioDataArray.length, 1,
            0, gl.LUMINANCE, gl.UNSIGNED_BYTE, window.audioDataArray
        );
        if (audioTextureLocation) {
            gl.uniform1i(audioTextureLocation, 0);
        }
    }

    const positionLocation = gl.getAttribLocation(shaderProgram, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Add event listeners for the new buttons.
document.getElementById('play-pause').addEventListener('click', function () {
    isPaused = !isPaused;
    // Update button text: when paused, button shows "Play"
    this.textContent = isPaused ? 'Play' : 'Pause';
});

document.getElementById('restart').addEventListener('click', function () {
    effectiveTime = 0; // Reset animation time
});

// Create a stream from the canvas at 30 fps.
const canvasStream = canvas.captureStream(30);

// Variables to manage recording.
let mediaRecorder;
let recordedChunks = [];

// Start recording function.
function startRecording() {
    recordedChunks = [];
    // Create a MediaRecorder instance with the canvas stream.
    mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType: 'video/webm'
    });
    // When data is available, push it into the recordedChunks array.
    mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    // When recording stops, create a Blob from the chunks.
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        // Create a download link for the video.
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'recording.webm';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    };
    mediaRecorder.start();
    logMessage("Recording started.");
}

// Stop recording function.
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        logMessage("Recording stopped.");
    } else {
        logMessage("No recording active.");
    }
}

document.getElementById('start-record').addEventListener('click', startRecording);
document.getElementById('stop-record').addEventListener('click', stopRecording);
