/***************************************
 * Global Setup & Utility Functions
 ***************************************/
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('shader-canvas');
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext('webgl', {
    preserveDrawingBuffer: true,
    premultipliedAlpha: false
});
if (!gl) {
    alert("WebGL is not supported by your browser.");
}
gl.enable(gl.DITHER);

const devMode = document.URL.startsWith("http://localhost");

function LOG(...args) {
    if (devMode) console.log(...args);
}

const maxLines = 100;
const outputMessages = [];
function logMessage(...args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    outputMessages.push(message);
    if (outputMessages.length > maxLines) outputMessages.shift();
    const outputEl = document.getElementById('output');
    outputEl.textContent = outputMessages.join('\n');
    document.getElementById('output-container').scrollTop =
        document.getElementById('output-container').scrollHeight;
}
function logMessageErr(...args) { logMessage("ERROR:", ...args); }

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const intVal = parseInt(hex, 16);
    return [((intVal >> 16) & 255) / 255, ((intVal >> 8) & 255) / 255, (intVal & 255) / 255];
}
function mix(a, b, t) { return a * (1 - t) + b * t; }
function isPowerOf2(value) { return (value & (value - 1)) === 0; }

// Helper function to clamp preview media dimensions
function clampPreviewSize(element) {
    element.style.maxWidth = "300px";
    element.style.maxHeight = "300px";
}

// Global array of shader buffers (each representing a tab)
let shaderBuffers = [];

/***************************************
 * WebGL: Shader, Program & Framebuffer Helpers
 ***************************************/
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const e = gl.getShaderInfoLog(shader);
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

function createFramebuffer(width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, texture, 0
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn("Framebuffer is not complete!");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { framebuffer, texture };
}

/***************************************
 * Canvas Dimensions Update
 ***************************************/
function updateCanvasDimensions() {
    const width = parseInt(document.getElementById('canvas-width').value, 10);
    const height = parseInt(document.getElementById('canvas-height').value, 10);
    if (!isNaN(width) && !isNaN(height)) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        gl.viewport(0, 0, width, height);
        // Update only the offscreen framebuffer (sample textures persist)
        shaderBuffers.forEach(sb => {
            const fbObj = createFramebuffer(width, height);
            sb.offscreenFramebuffer = fbObj.framebuffer;
            sb.offscreenTexture = fbObj.texture;
        });
    }
}
document.getElementById('update-canvas-dimensions').addEventListener('click', updateCanvasDimensions);
updateCanvasDimensions();

/***************************************
 * Audio Helpers
 ***************************************/
function createAudioSource(src) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.loop = true;
    audio.src = src;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const outputGain = audioContext.createGain();
    outputGain.gain.value = 1;
    source.connect(outputGain);
    outputGain.connect(audioContext.destination);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    return { audio, analyser, dataArray, outputGain };
}

function toggleMute(mediaObj, mute) {
    if (mediaObj.outputGain) {
        mediaObj.outputGain.gain.value = mute ? 0 : 1;
    }
}

/***************************************
 * Shader Buffer Creation & Management
 ***************************************/
const MAX_TEXTURE_SLOTS = 4;
const defaultControlSchema = {
    controls: [
        { type: 'slider', label: 'Test Slider', uniform: 'u_test', default: 0.5, min: 0, max: 1, step: 0.01 },
        { type: 'slider', label: 'Test Slider', uniform: 'u_test2', default: 1.0, min: 0, max: 6, step: 0.25 }
    ]
};

function createShaderBuffer(name, vertexSrc, fragmentSrc) {
    const program = createProgram(gl, vertexSrc, fragmentSrc);
    if (!program) {
        console.error("Failed to initialize shader program for", name);
        return null;
    }
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const fbObj = createFramebuffer(canvas.width, canvas.height);
    let sampleTextures = new Array(MAX_TEXTURE_SLOTS).fill(null);
    let sampleTextureLocations = new Array(MAX_TEXTURE_SLOTS).fill(null);
    let sampleMedia = new Array(MAX_TEXTURE_SLOTS).fill(null);
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        sampleTextures[i] = gl.createTexture();
        sampleTextureLocations[i] = gl.getUniformLocation(program, `u_texture${i}`);
    }

    // Create persistent containers for controls and advanced media inputs
    let controlContainer = document.createElement('div');
    controlContainer.className = 'shader-control-panel';
    document.getElementById('controls-container').appendChild(controlContainer);

    let advancedInputsContainer = document.createElement('div');
    advancedInputsContainer.className = 'advanced-inputs-container';
    document.getElementById('advanced-inputs').appendChild(advancedInputsContainer);

    // Each shader now gets its own customUniforms state
    const customUniforms = {};

    const shadBuf = {
        name,
        shaderProgram: program,
        timeLocation,
        resolutionLocation,
        offscreenFramebuffer: fbObj.framebuffer,
        offscreenTexture: fbObj.texture,
        sampleTextures,
        sampleTextureLocations,
        sampleMedia,
        controlSchema: defaultControlSchema, // default control schema
        controlContainer,
        advancedInputsContainer,
        customUniforms
    };

    // Initialize advanced media inputs for each texture slot
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        let advancedInput = createAdvancedMediaInput(shadBuf, i);
        advancedInputsContainer.appendChild(advancedInput);
    }

    return shadBuf;
}

function initShaderBuffers() {
    // For demonstration, create two shader buffers (tabs)
    let shader1 = createShaderBuffer("Shader 1", vertexShaderSource, fragmentShaderSource);
    let shader2 = createShaderBuffer("Shader 2", vertexShaderSource, fragmentShaderSource);
    shaderBuffers = [shader1, shader2];
}

// Define default vertex and fragment shader sources
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
  uniform sampler2D u_texture0;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform sampler2D u_texture3;
  uniform float u_test;
  uniform float u_test2;
  void main(void) {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv = uv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    float dist = length(uv);
    float wave = sin(dist * 10.0 * u_test2 - u_time * 3.0 * u_test);
    float intensity = smoothstep(0.3, 0.0, abs(wave));
    vec3 color = mix(vec3(0.2, 0.1, 0.5), vec3(1.0, 0.8, 0.3), intensity);
    gl_FragColor = vec4(color, 1.0);
  }
`;

initShaderBuffers();

/***************************************
 * Advanced Media Input (Per Shader)
 ***************************************/
// Helper to update the sample texture for a given media element.
function updateTextureForMedia(shaderBuffer, slotIndex, mediaElement) {
    gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[slotIndex]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mediaElement);
    if (mediaElement.tagName === 'IMG') {
        if (isPowerOf2(mediaElement.width) && isPowerOf2(mediaElement.height)) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
    } else {
        // video, webcam, canvas, etc — always clamp & linear
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
}

// Helper to load an image from a source URL.
function loadImageFromSource(src, shaderBuffer, slotIndex, previewContainer) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        updateTextureForMedia(shaderBuffer, slotIndex, img);
        logMessage(`Slot ${slotIndex} loaded (image).`);
        clampPreviewSize(img);
        shaderBuffer.sampleMedia[slotIndex] = { type: 'image', element: img };
        previewContainer.innerHTML = '';
        previewContainer.appendChild(img);
    };
    img.src = src;
}

// Helper to load a video from a source URL.
function loadVideoFromSource(src, shaderBuffer, slotIndex, previewContainer) {
    const video = document.createElement('video');
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.muted = true;
    video.src = src;
    // Match the shader's pause state.
    if (!isPaused) { video.play(); } else { video.pause(); }
    video.addEventListener('loadeddata', () => {
        updateTextureForMedia(shaderBuffer, slotIndex, video);
        logMessage(`Slot ${slotIndex} loaded (video).`);
        clampPreviewSize(video);
    });
    shaderBuffer.sampleMedia[slotIndex] = { type: 'video', element: video };
    previewContainer.innerHTML = '';
    previewContainer.appendChild(video);
}

// Helper to load audio from a source URL.
function loadAudioFromSource(src, shaderBuffer, slotIndex, previewContainer) {
    const audioSource = createAudioSource(src);
    if (!isPaused && typeof audioSource.audio.play === 'function') {
        audioSource.audio.play();
    } else {
        audioSource.audio.pause();
    }
    shaderBuffer.sampleMedia[slotIndex] = {
        type: 'audio',
        element: audioSource.audio,
        analyser: audioSource.analyser,
        dataArray: audioSource.dataArray,
        outputGain: audioSource.outputGain
    };
    audioSource.audio.style.maxWidth = "300px";
    previewContainer.innerHTML = '';
    previewContainer.appendChild(audioSource.audio);

    // Add a mute/unmute button.
    const muteBtn = document.createElement('button');
    let muted = true;
    muteBtn.textContent = "Unmute";
    toggleMute(shaderBuffer.sampleMedia[slotIndex], muted);
    muteBtn.addEventListener('click', () => {
        muted = !muted;
        toggleMute(shaderBuffer.sampleMedia[slotIndex], muted);
        muteBtn.textContent = muted ? "Unmute" : "Mute";
    });
    previewContainer.appendChild(muteBtn);
}

// Helper to create a URL form that triggers on Enter.
function createUrlForm(callback) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter media URL...';
    form.appendChild(input);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = input.value.trim();
        if (url) {
            callback(url);
        }
    });
    return form;
}

// Main function to create the advanced media input interface.
function createAdvancedMediaInput(shaderBuffer, slotIndex) {
    const container = document.createElement('div');
    container.className = 'advanced-media-input';

    const sourceSelect = document.createElement('select');
    sourceSelect.innerHTML = `
    <option value="none">None</option>
    <option value="file">File Upload</option>
    <option value="url">URL</option>
    <option value="mic">Microphone</option>
    <option value="webcam">Webcam</option>
    <option value="tab">Tab Sample</option>
    `;
    container.appendChild(sourceSelect);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
        shaderBuffer.sampleMedia[slotIndex] = null;
        clearPreview();
        logMessage(`Slot ${slotIndex} unassigned.`);
    });
    container.appendChild(removeBtn);

    const inputControlsContainer = document.createElement('div');
    inputControlsContainer.className = 'media-input-controls';
    container.appendChild(inputControlsContainer);

    const previewContainer = document.createElement('div');
    previewContainer.id = `media-preview-${slotIndex}`;
    previewContainer.className = 'media-preview';
    container.appendChild(previewContainer);

    function clearPreview() { previewContainer.innerHTML = ''; }
    function resetMedia() { shaderBuffer.sampleMedia[slotIndex] = null; clearPreview(); }

    function setupFileInput() {
        inputControlsContainer.innerHTML = '';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*';
        fileInput.addEventListener('change', (event) => {
            resetMedia();
            const file = event.target.files[0];
            if (!file) return;
            const src = URL.createObjectURL(file);
            const fileType = file.type;
            if (fileType.startsWith('image/')) {
                loadImageFromSource(src, shaderBuffer, slotIndex, previewContainer);
            } else if (fileType.startsWith('video/')) {
                loadVideoFromSource(src, shaderBuffer, slotIndex, previewContainer);
            } else if (fileType.startsWith('audio/')) {
                loadAudioFromSource(src, shaderBuffer, slotIndex, previewContainer);
            } else {
                logMessage("Unsupported file type.");
            }
        });
        inputControlsContainer.appendChild(fileInput);
    }

    function setupUrlInput() {
        inputControlsContainer.innerHTML = '';
        const form = createUrlForm((url) => {
            resetMedia();
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.match(/\.(jpg|jpeg|png|gif)$/)) {
                loadImageFromSource(url, shaderBuffer, slotIndex, previewContainer);
            } else if (lowerUrl.match(/\.(mp4|webm|ogg)$/)) {
                loadVideoFromSource(url, shaderBuffer, slotIndex, previewContainer);
            } else if (lowerUrl.match(/\.(mp3|wav|ogg)$/)) {
                loadAudioFromSource(url, shaderBuffer, slotIndex, previewContainer);
            } else {
                logMessage(`Cannot determine media type for URL: ${url}`);
            }
        });
        inputControlsContainer.appendChild(form);
    }

    function setupMicInput() {
        inputControlsContainer.innerHTML = '';
        const micBtn = document.createElement('button');
        micBtn.textContent = 'Enable Microphone';
        micBtn.addEventListener('click', () => {
            resetMedia();
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(stream);
                    const analyser = audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);
                    shaderBuffer.sampleMedia[slotIndex] = { type: "audio", element: null, analyser, dataArray };
                    clearPreview();
                    previewContainer.innerHTML = 'Microphone Enabled';
                })
                .catch(err => { logMessageErr("Error accessing microphone:", err); });
        });
        inputControlsContainer.appendChild(micBtn);
    }

    function setupTabSampleInput() {
        inputControlsContainer.innerHTML = '';
        const tabSelect = document.createElement('select');
        // Add a default placeholder option.
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Select a Shader Tab --";
        tabSelect.appendChild(defaultOption);

        // List available shader buffers.
        shaderBuffers.forEach((shaderBuf, idx) => {
            // Optionally, you might want to prevent sampling yourself.
            if (idx !== currentShaderIndex) {
                const opt = document.createElement('option');
                opt.value = idx;  // use the tab index as the value.
                opt.textContent = shaderBuf.name;
                tabSelect.appendChild(opt);
            }
        });
        tabSelect.addEventListener('change', () => {
            const selectedIndex = tabSelect.value;
            if (selectedIndex !== "") {
                // Store a reference to the target tab.
                shaderBuffer.sampleMedia[slotIndex] = {
                    type: "tab",
                    tabIndex: parseInt(selectedIndex)
                };
                LOG(`sampling shaderBuffer ${shaderBuffer.sampleMedia[slotIndex].tabIndex}`)
                clearPreview();
                // Update preview area with simple text info.
                const info = document.createElement('div');
                info.textContent = `Sampling from tab: ${shaderBuffers[selectedIndex].name}`;
                previewContainer.appendChild(info);
            }
        });
        inputControlsContainer.appendChild(tabSelect);
    }

    function setupWebcamInput() {
        inputControlsContainer.innerHTML = '';
        const camBtn = document.createElement('button');
        camBtn.textContent = 'Enable Webcam';
        camBtn.addEventListener('click', () => {
            resetMedia();
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const video = document.createElement('video');
                    video.autoplay = true;
                    video.muted = true;               // must be muted for autoplay
                    video.setAttribute('playsinline', '');
                    video.srcObject = stream;

                    video.addEventListener('loadeddata', () => {
                        // first texture upload
                        updateTextureForMedia(shaderBuffer, slotIndex, video);
                        clampPreviewSize(video);
                        logMessage(`Slot ${slotIndex} loaded (webcam).`);

                        // keep updating the texture each frame
                        function updateLoop() {
                            if (shaderBuffer.sampleMedia[slotIndex]?.type === 'webcam') {
                                updateTextureForMedia(shaderBuffer, slotIndex, video);
                                requestAnimationFrame(updateLoop);
                            }
                        }
                        shaderBuffer.sampleMedia[slotIndex] = { type: 'webcam', element: video };
                        clearPreview();
                        previewContainer.appendChild(video);
                        updateLoop();
                    });
                })
                .catch(err => {
                    logMessageErr("Error accessing webcam:", err);
                });
        });
        inputControlsContainer.appendChild(camBtn);
    }

    sourceSelect.addEventListener('change', () => {
        shaderBuffer.sampleMedia[slotIndex] = null;
        clearPreview();
        const val = sourceSelect.value;
        if (val === 'file') setupFileInput();
        else if (val === 'url') setupUrlInput();
        else if (val === 'mic') setupMicInput();
        else if (val === 'webcam') setupWebcamInput();
        else if (val === 'tab') setupTabSampleInput();
        else inputControlsContainer.innerHTML = '';
    });

    return container;
}


/***************************************
 * Quad & Geometry Setup for Post‑Processing
 ***************************************/
const quadVertexShaderSource = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;
const quadFragmentShaderSource = `
  precision mediump float;
  uniform sampler2D u_texture;
  varying vec2 v_texCoord;
  void main(void) {
    gl_FragColor = texture2D(u_texture, v_texCoord);
  }
`;
const quadProgram = createProgram(gl, quadVertexShaderSource, quadFragmentShaderSource);
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

/***************************************
 * Audio Texture Setup (Global Microphone)
 ***************************************/
let audioTexture = null;
function loadMicrophone() {
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
    if (audioTexture === null) audioTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, audioTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE,
        window.audioDataArray ? window.audioDataArray.length : 128, 1,
        0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
}
document.getElementById('enable-mic').addEventListener('click', loadMicrophone);

/***************************************
 * UI: Shader Buffer Tabs & Control Panels
 ***************************************/
let currentShaderIndex = 0;
function updateActiveShaderUI() {
    const activeShader = shaderBuffers[currentShaderIndex];
    logMessage("Switched to " + activeShader.name);
    // Hide all advanced-input and control panels
    document.querySelectorAll('.advanced-inputs-container').forEach(container => {
        container.style.display = 'none';
    });
    document.querySelectorAll('.shader-control-panel').forEach(container => {
        container.style.display = 'none';
    });
    // Show only the active shader’s panels.
    activeShader.advancedInputsContainer.style.display = 'block';
    activeShader.controlContainer.style.display = 'block';
    // Refresh sample media textures if needed.
    refreshShaderTextures(activeShader);
}
function createShaderTabs() {
    const tabContainer = document.getElementById('shader-tabs');
    tabContainer.innerHTML = '';
    shaderBuffers.forEach((shaderBuf, index) => {
        const tabButton = document.createElement('button');
        tabButton.textContent = shaderBuf.name;
        tabButton.addEventListener('click', () => {
            currentShaderIndex = index;
            updateActiveShaderUI();
        });
        tabContainer.appendChild(tabButton);
    });
}
createShaderTabs();
updateActiveShaderUI();

/***************************************
 * Control Panel Rendering
 ***************************************/
function renderControlsForShader(shaderBuffer, schema) {
    LOG(`Rendering controls for ${shaderBuffer.name}`);
    shaderBuffer.controlContainer.innerHTML = ''; // Clear previous controls
    schema?.controls?.forEach(control => {
        const controlDiv = document.createElement('div');
        controlDiv.className = 'control';
        const label = document.createElement('label');
        label.textContent = control.label;
        controlDiv.appendChild(label);
        let inputElement;
        // Use default value from the schema; store in the shader's custom uniforms
        const initialValue = control.default;
        shaderBuffer.customUniforms[control.uniform] = initialValue;
        switch (control.type) {
            case 'knob':
            case 'slider':
                // Create the slider input
                inputElement = document.createElement('input');
                inputElement.type = 'range';
                inputElement.min = control.min;
                inputElement.max = control.max;
                inputElement.step = control.step;
                inputElement.value = initialValue;
                inputElement.setAttribute('data-uniform', control.uniform);

                // Create an info bubble for displaying the current value
                const infoBubble = document.createElement('div');
                infoBubble.className = 'slider-info-bubble';
                infoBubble.style.display = 'none';
                controlDiv.style.position = 'relative';
                controlDiv.appendChild(infoBubble);

                // Function to update bubble content and position
                function updateSliderBubble(e) {
                    const rect = inputElement.getBoundingClientRect();
                    const pct = (parseFloat(inputElement.value) - control.min) / (control.max - control.min);
                    const bubbleX = pct * rect.width;
                    infoBubble.innerText = parseFloat(inputElement.value).toFixed(2);
                    infoBubble.style.left = `${bubbleX}px`;
                    infoBubble.style.top = `-1.5em`;
                }

                // Update uniform and bubble on input
                inputElement.addEventListener('input', e => {
                    const val = parseFloat(e.target.value);
                    shaderBuffer.customUniforms[control.uniform] = val;
                    updateSliderBubble(e);
                });

                // Show bubble on interaction
                inputElement.addEventListener('mousedown', e => {
                    infoBubble.style.display = 'block';
                    updateSliderBubble(e);
                });
                document.addEventListener('mouseup', () => {
                    infoBubble.style.display = 'none';
                });
                break;
            case 'button':
                inputElement = document.createElement('button');
                inputElement.textContent = control.label;
                inputElement.addEventListener('click', () => {
                    shaderBuffer.customUniforms[control.uniform] = true;
                    LOG(`Button action for ${control.uniform} triggered.`);
                });
                break;
            case 'toggle':
                inputElement = document.createElement('input');
                inputElement.type = 'checkbox';
                inputElement.checked = initialValue;
                inputElement.addEventListener('change', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.checked;
                });
                break;
            case 'xy-plane':
                inputElement = document.createElement('div');
                inputElement.className = 'xy-plane';
                const grid = document.createElement('div');
                grid.className = 'xy-grid';
                inputElement.appendChild(grid);
                // Compute normalized position for the indicator
                const normX = (initialValue.x - control.min.x) / (control.max.x - control.min.x);
                const normY = (initialValue.y - control.min.y) / (control.max.y - control.min.y);
                const indicator = document.createElement('div');
                indicator.className = 'xy-indicator';
                indicator.style.left = (normX * 200) + 'px';
                indicator.style.top = ((1 - normY) * 200) + 'px';
                inputElement.appendChild(indicator);
                const minLabel = document.createElement('div');
                minLabel.className = 'xy-label xy-label-min';
                minLabel.innerText = `Min: ${control.min.x}, ${control.min.y}`;
                inputElement.appendChild(minLabel);
                const maxLabel = document.createElement('div');
                maxLabel.className = 'xy-label xy-label-max';
                maxLabel.innerText = `Max: ${control.max.x}, ${control.max.y}`;
                inputElement.appendChild(maxLabel);
                const xyInfo = document.createElement('div');
                xyInfo.className = 'xy-info-bubble';
                xyInfo.style.display = 'none';
                inputElement.appendChild(xyInfo);
                function updateXY(e) {
                    const rect = inputElement.getBoundingClientRect();
                    const rawX = e.clientX - rect.left;
                    const rawY = e.clientY - rect.top;
                    const clampedX = Math.min(Math.max(rawX, 0), rect.width);
                    const clampedY = Math.min(Math.max(rawY, 0), rect.height);
                    indicator.style.left = clampedX + 'px';
                    indicator.style.top = clampedY + 'px';
                    let x = mix(control.min.x, control.max.x, clampedX / rect.width);
                    let y = mix(control.min.y, control.max.y, 1 - (clampedY / rect.height));
                    LOG("x,y=", x, y);
                    shaderBuffer.customUniforms[control.uniform] = { x, y };
                    xyInfo.innerText = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
                    xyInfo.style.left = (clampedX + 50) + 'px';
                    xyInfo.style.top = (clampedY - 25) + 'px';
                }
                inputElement.addEventListener('mousedown', e => {
                    xyInfo.style.display = 'block';
                    updateXY(e);
                    function onMouseMove(e) { updateXY(e); }
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', function onMouseUp() {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        xyInfo.style.display = 'none';
                    });
                });
                break;
            case 'color-picker':
                inputElement = document.createElement('input');
                inputElement.type = 'color';
                inputElement.value = initialValue;
                inputElement.addEventListener('input', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                });
                break;
            case 'dropdown':
                inputElement = document.createElement('select');
                control.options.forEach(option => {
                    const opt = document.createElement('option');
                    opt.value = option;
                    opt.textContent = option;
                    if (option === initialValue) opt.selected = true;
                    inputElement.appendChild(opt);
                });
                inputElement.addEventListener('change', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                });
                break;
            case 'text-input':
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.value = initialValue;
                inputElement.addEventListener('input', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                });
                break;
            default:
                console.warn(`Unknown control type: ${control.type}`);
        }
        if (inputElement) {
            controlDiv.appendChild(inputElement);
        }
        shaderBuffer.controlContainer.appendChild(controlDiv);
    });
}

// On page load, render controls for each shader.
document.addEventListener('DOMContentLoaded', () => {
    shaderBuffers.forEach(shaderBuffer => {
        renderControlsForShader(shaderBuffer, shaderBuffer.controlSchema);
    });
});

/***************************************
 * Refresh Uploaded Textures
 ***************************************/
function refreshShaderTextures(shaderBuffer) {
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        const media = shaderBuffer.sampleMedia[i];
        gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
        if (!media) {
            // No media assigned: Use a default 1x1 black texture
            const defaultPixel = new Uint8Array([0, 0, 0, 255]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, defaultPixel);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        } else if (media.type === "image" || media.type === "video") {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                gl.RGBA, gl.UNSIGNED_BYTE, media.element);
            if (media.type === "image") {
                if (isPowerOf2(media.element.width) && isPowerOf2(media.element.height)) {
                    gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                }
            }
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

/***************************************
 * Directory Upload (JSON Schema & Shader Files)
 ***************************************/
function handleFolderUpload(event) {
    const files = event.target.files;
    let schemaFile = null, shaderFile = null;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) schemaFile = file;
        else if (name.endsWith('.glsl') || name.endsWith('.frag') || name.endsWith('.txt')) shaderFile = file;
    }
    if (!shaderFile) { logMessage("No GLSL shader file found in the directory."); return; }
    let newSchemaData = null, newShaderSource = null;
    const schemaReader = new FileReader();
    if (!schemaFile) { logMessage("No JSON schema file found in the directory."); }
    else {
        schemaReader.onload = e => {
            try { newSchemaData = JSON.parse(e.target.result); }
            catch (err) { logMessage("Error parsing JSON schema:", err); }
            checkAndApply();
        };
        schemaReader.readAsText(schemaFile);
    }
    const shaderReader = new FileReader();
    shaderReader.onload = e => {
        newShaderSource = e.target.result;
        checkAndApply();
    };
    shaderReader.readAsText(shaderFile);
    function checkAndApply() {
        if (!newShaderSource) return;
        const newProgram = createProgram(gl, vertexShaderSource, newShaderSource);
        const activeShader = shaderBuffers[currentShaderIndex];
        if (newProgram) {
            activeShader.shaderProgram = newProgram;
            activeShader.timeLocation = gl.getUniformLocation(newProgram, 'u_time');
            activeShader.resolutionLocation = gl.getUniformLocation(newProgram, 'u_resolution');
            for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
                activeShader.sampleTextureLocations[i] = gl.getUniformLocation(newProgram, `u_texture${i}`);
            }
            logMessage("Shader updated from folder successfully!");
        } else {
            logMessageErr("Failed to compile shader from folder.");
        }
        activeShader.controlSchema = newSchemaData;
        renderControlsForShader(activeShader, newSchemaData);
    }
}
document.getElementById('folder-upload').addEventListener('change', handleFolderUpload);

/***************************************
 * Main Render Loop (Two‑Pass Rendering)
 ***************************************/
let isPaused = false;
let lastFrameTime = 0;
let effectiveTime = 0;

function updateCustomUniforms(shaderBuffer) {
    for (let name in shaderBuffer.customUniforms) {
        const value = shaderBuffer.customUniforms[name];
        const loc = gl.getUniformLocation(shaderBuffer.shaderProgram, name);
        if (loc === null) continue;
        if (typeof value === 'number') {
            gl.uniform1f(loc, value);
        } else if (typeof value === 'boolean') {
            gl.uniform1i(loc, value ? 1 : 0);
        } else if (typeof value === 'object' && value && 'x' in value && 'y' in value) {
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

// TODO: only update shaders either in use or sampled by other shaders
function updateAllShaderBuffers() {
    // Loop through each shader buffer and update its offscreen texture.
    shaderBuffers.forEach((shaderBuffer, idx) => {
        // Bind the offscreen framebuffer of the shader buffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, shaderBuffer.offscreenFramebuffer);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Use the shader's program and update its uniforms.
        gl.useProgram(shaderBuffer.shaderProgram);
        if (shaderBuffer.timeLocation)
            gl.uniform1f(shaderBuffer.timeLocation, effectiveTime * 0.001);
        if (shaderBuffer.resolutionLocation)
            gl.uniform2f(shaderBuffer.resolutionLocation, canvas.width, canvas.height);
        updateCustomUniforms(shaderBuffer);

        // Bind the sample media textures.
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            if (!shaderBuffer.sampleTextures[i] || !shaderBuffer.sampleTextureLocations[i])
                continue;
            const textureLocation = shaderBuffer.sampleTextureLocations[i];
            const media = shaderBuffer.sampleMedia[i];
            gl.activeTexture(gl.TEXTURE2 + i);
            if (!media) {
                // No media: use a fallback texture.
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "tab") {
                // For tab-sampled shaders, bind the target shader's offscreen texture.
                const targetShader = shaderBuffers[media.tabIndex];
                gl.bindTexture(gl.TEXTURE_2D, targetShader.offscreenTexture);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "video" || media.type === "webcam") {
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.element
                );
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "audio") {
                const { analyser, dataArray } = media;
                analyser.getByteFrequencyData(dataArray);
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.LUMINANCE, dataArray.length, 1, 0,
                    gl.LUMINANCE, gl.UNSIGNED_BYTE, dataArray
                );
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "image") {
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.element
                );
                if (isPowerOf2(media.element.width) && isPowerOf2(media.element.height)) {
                    gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                }
                gl.uniform1i(textureLocation, 2 + i);
            } else {
                LOG(`WARN: uncaught shaderbuffer media.type case: ${media.type}`);
            }
        }

        // Draw the full-screen quad to update the offscreen texture.
        const posLoc = gl.getAttribLocation(shaderBuffer.shaderProgram, "a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
}

function render(time) {
    if (lastFrameTime === 0) lastFrameTime = time;
    const delta = time - lastFrameTime;
    lastFrameTime = time;
    if (!isPaused) effectiveTime += delta;

    // --- Update All Shader Buffers ---
    // This function call makes sure that every shader’s offscreen texture is updated,
    // even if its corresponding tab is not active.
    updateAllShaderBuffers();

    // --- Final Pass: Blit the active shader's offscreen texture to the canvas ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(quadProgram);
    const quadPosLocation = gl.getAttribLocation(quadProgram, "a_position");
    gl.enableVertexAttribArray(quadPosLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(quadPosLocation, 2, gl.FLOAT, false, 0, 0);
    const quadTextureLocation = gl.getUniformLocation(quadProgram, "u_texture");
    gl.activeTexture(gl.TEXTURE0);
    // Use the currently active shader buffer’s updated offscreen texture.
    gl.bindTexture(gl.TEXTURE_2D, shaderBuffers[currentShaderIndex].offscreenTexture);
    gl.uniform1i(quadTextureLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}
requestAnimationFrame(render);

/***************************************
 * Main Controls & Recording
 ***************************************/
document.getElementById('play-pause').addEventListener('click', function () {
    isPaused = !isPaused;
    this.textContent = isPaused ? 'Play' : 'Pause';

    // For the active shader, pause/resume attached media
    const currentShader = shaderBuffers[currentShaderIndex];
    currentShader.sampleMedia.forEach(media => {
        if (media && media.element) {
            if (isPaused && typeof media.element.pause === 'function') {
                media.element.pause();
            } else if (!isPaused && typeof media.element.play === 'function') {
                media.element.play();
            }
        }
    });
});
document.getElementById('restart').addEventListener('click', function () {
    effectiveTime = 0;

    // For the active shader, reset attached media
    const currentShader = shaderBuffers[currentShaderIndex];
    currentShader.sampleMedia.forEach(media => {
        if (media && media.element) {
            // Reset time to zero for video/audio elements
            media.element.currentTime = 0;
            if (!isPaused && typeof media.element.play === 'function') {
                media.element.play();
            }
        }
    });

    // Restart microphone capture if applicable.
    if (window.audioAnalyser) loadMicrophone();
});
const canvasStream = canvas.captureStream(30);
let mediaRecorder;
let recordedChunks = [];
function startRecording() {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = event => { if (event.data.size > 0) recordedChunks.push(event.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
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
document.getElementById('save-image').addEventListener('click', () => {
    isPaused = true;
    requestAnimationFrame(() => {
        gl.finish();
        const dataURL = canvas.toDataURL("image/png");
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = 'shader_snapshot.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        isPaused = false;
    });
});
