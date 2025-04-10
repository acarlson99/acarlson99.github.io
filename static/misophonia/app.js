/***************************************
 * Global Setup & Utility Functions
 ***************************************/
const canvas = document.getElementById('shader-canvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
if (!gl) {
    alert("WebGL is not supported by your browser.");
}
let devMode = document.URL.startsWith("http://localhost");

function LOG(...args) {
    if (devMode) console.log(...args);
}

const maxLines = 100;
const outputMessages = [];

function logMessage(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); }
            catch (e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    outputMessages.push(message);
    if (outputMessages.length > maxLines) outputMessages.shift();
    const outputEl = document.getElementById('output');
    outputEl.textContent = outputMessages.join('\n');
    document.getElementById('output-container').scrollTop = document.getElementById('output-container').scrollHeight;
}

function logMessageErr(...args) {
    logMessage("ERROR:", ...args);
}

let customUniforms = {};

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

function mix(a, b, t) {
    return a * (1 - t) + b * t;
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

/***************************************
 * Off‑Screen Rendering Setup
 ***************************************/
let shaderBuffers = [];

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
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn("Framebuffer is not complete!");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { framebuffer, texture };
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
        gl.viewport(0, 0, width, height);
        // Update each shader buffer's offscreen framebuffer
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
 * Shader & Buffer Helpers
 ***************************************/
const MAX_TEXTURE_SLOTS = 4;

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
    return {
        name,
        shaderProgram: program,
        timeLocation,
        resolutionLocation,
        offscreenFramebuffer: fbObj.framebuffer,
        offscreenTexture: fbObj.texture,
        sampleTextures,
        sampleTextureLocations,
        sampleMedia,
        controlSchema: {}
    };
}

let currentShaderIndex = 0;
function initShaderBuffers() {
    // For demonstration, we create two shader buffers using the same shader sources.
    let shader1 = createShaderBuffer("Shader 1", vertexShaderSource, fragmentShaderSource);
    let shader2 = createShaderBuffer("Shader 2", vertexShaderSource, fragmentShaderSource);
    shaderBuffers = [shader1, shader2];
}

/***************************************
 * Shader Sources
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
  uniform sampler2D u_texture0;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform sampler2D u_texture3;
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

initShaderBuffers();

/***************************************
 * Advanced Media Input (Per–Shader)
 ***************************************/
function createAdvancedMediaInput(shaderBuffer, slotIndex) {
    const container = document.createElement('div');
    container.className = 'advanced-media-input';

    const sourceSelect = document.createElement('select');
    sourceSelect.innerHTML = `
        <option value="none">None</option>
        <option value="file">File Upload</option>
        <option value="url">URL</option>
        <option value="mic">Microphone</option>
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

    function clearPreview() {
        previewContainer.innerHTML = '';
    }
    function resetMedia() {
        shaderBuffer.sampleMedia[slotIndex] = null;
        clearPreview();
    }

    function setupFileInput() {
        inputControlsContainer.innerHTML = '';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*';
        fileInput.addEventListener('change', (event) => {
            resetMedia();
            const file = event.target.files[0];
            if (!file) return;
            const fileType = file.type;
            let mediaObj = null;
            if (fileType.startsWith('image/')) {
                const img = new Image();
                img.onload = () => {
                    gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[slotIndex]);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                    if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
                        gl.generateMipmap(gl.TEXTURE_2D);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    } else {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    }
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    logMessage(`Slot ${slotIndex} loaded (image file).`);
                    clampPreviewSize(img);
                };
                img.src = URL.createObjectURL(file);
                mediaObj = { type: "image", element: img };
            } else if (fileType.startsWith('video/')) {
                const video = document.createElement('video');
                video.setAttribute('playsinline', '');
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.src = URL.createObjectURL(file);
                video.play();
                video.addEventListener('loadeddata', () => {
                    gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[slotIndex]);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    logMessage(`Slot ${slotIndex} loaded (video file).`);
                    clampPreviewSize(video);
                });
                mediaObj = { type: "video", element: video };
            } else if (fileType.startsWith('audio/')) {
                const src = URL.createObjectURL(file);
                const audioSource = createAudioSource(src);
                mediaObj = {
                    type: "audio",
                    element: audioSource.audio,
                    analyser: audioSource.analyser,
                    dataArray: audioSource.dataArray,
                    outputGain: audioSource.outputGain
                };
                mediaObj.element.style.maxWidth = "300px";
            } else {
                logMessage("Unsupported file type.");
                return;
            }
            shaderBuffer.sampleMedia[slotIndex] = mediaObj;
            clearPreview();
            previewContainer.appendChild(mediaObj.element);
            if (mediaObj && mediaObj.type === "audio") {
                const muteBtn = document.createElement('button');
                muteBtn.textContent = "Mute";
                let muted = false;
                muteBtn.addEventListener('click', () => {
                    muted = !muted;
                    toggleMute(mediaObj, muted);
                    muteBtn.textContent = muted ? "Unmute" : "Mute";
                });
                previewContainer.appendChild(muteBtn);
            }
        });
        inputControlsContainer.appendChild(fileInput);
    }

    function setupUrlInput() {
        inputControlsContainer.innerHTML = '';
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.placeholder = 'Enter media URL...';
        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', () => {
            resetMedia();
            const url = urlInput.value;
            if (!url) return;
            let mediaObj = null;
            if (url.match(/\.(jpg|jpeg|png|gif)$/i)) {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[slotIndex]);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                    if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
                        gl.generateMipmap(gl.TEXTURE_2D);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    } else {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    }
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    logMessage(`Slot ${slotIndex} loaded (image URL).`);
                    clampPreviewSize(img);
                };
                img.src = url;
                mediaObj = { type: "image", element: img };
            } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
                const video = document.createElement('video');
                video.setAttribute('playsinline', '');
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.crossOrigin = "anonymous";
                video.src = url;
                video.play();
                video.addEventListener('loadeddata', () => {
                    gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[slotIndex]);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    logMessage(`Slot ${slotIndex} loaded (video URL).`);
                    clampPreviewSize(video);
                });
                mediaObj = { type: "video", element: video };
            } else if (url.match(/\.(mp3|wav|ogg)$/i)) {
                const audioSource = createAudioSource(url);
                mediaObj = {
                    type: "audio",
                    element: audioSource.audio,
                    analyser: audioSource.analyser,
                    dataArray: audioSource.dataArray,
                    outputGain: audioSource.outputGain
                };
                mediaObj.element.style.maxWidth = "300px";
            } else {
                logMessage(`Cannot determine media type for URL: ${url}`);
                return;
            }
            shaderBuffer.sampleMedia[slotIndex] = mediaObj;
            clearPreview();
            previewContainer.appendChild(mediaObj.element);
            if (mediaObj && mediaObj.type === "audio") {
                const muteBtn = document.createElement('button');
                muteBtn.textContent = "Mute";
                let muted = false;
                muteBtn.addEventListener('click', () => {
                    muted = !muted;
                    toggleMute(mediaObj, muted);
                    muteBtn.textContent = muted ? "Unmute" : "Mute";
                });
                previewContainer.appendChild(muteBtn);
            }
        });
        inputControlsContainer.appendChild(urlInput);
        inputControlsContainer.appendChild(loadBtn);
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
                .catch(err => {
                    logMessageErr("Error accessing microphone:", err);
                });
        });
        inputControlsContainer.appendChild(micBtn);
    }

    sourceSelect.addEventListener('change', () => {
        shaderBuffer.sampleMedia[slotIndex] = null;
        clearPreview();
        const val = sourceSelect.value;
        if (val === 'file') {
            setupFileInput();
        } else if (val === 'url') {
            setupUrlInput();
        } else if (val === 'mic') {
            setupMicInput();
        } else {
            inputControlsContainer.innerHTML = '';
        }
    });
    return container;
}

/***************************************
 * Quad Setup for Post‑Processing
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

/***************************************
 * Full‑Screen Quad Geometry Setup
 ***************************************/
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

/***************************************
 * Audio Texture Setup (Microphone)
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
 * UI for Shader Buffer Tabs
 ***************************************/
function updateActiveShaderUI() {
    // Log the change or update other UI elements.
    logMessage("Switched to " + shaderBuffers[currentShaderIndex].name);
    // Rebuild the advanced inputs for texture channels.
    const advancedInputContainer = document.getElementById('advanced-inputs');
    advancedInputContainer.innerHTML = '';
    const activeShader = shaderBuffers[currentShaderIndex];
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        let advancedInput = createAdvancedMediaInput(activeShader, i);
        advancedInputContainer.appendChild(advancedInput);
    }
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
 * Control Panel Setup & Rendering
 ***************************************/
const defaultControlSchema = { controls: [] };
function renderControls(schema) {
    const container = document.getElementById('controls-container');
    container.innerHTML = '';
    schema.controls.forEach(control => {
        const controlDiv = document.createElement('div');
        controlDiv.className = 'control';
        const label = document.createElement('label');
        label.textContent = control.label;
        controlDiv.appendChild(label);
        let inputElement;
        customUniforms[control.uniform] = control.default;
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
                const grid = document.createElement('div');
                grid.className = 'xy-grid';
                inputElement.appendChild(grid);
                const normX = (control.default.x - control.min.x) / (control.max.x - control.min.x);
                const normY = (control.default.y - control.min.y) / (control.max.y - control.min.y);
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
                const infoBubble = document.createElement('div');
                infoBubble.className = 'xy-info-bubble';
                infoBubble.style.display = 'none';
                inputElement.appendChild(infoBubble);
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
                    customUniforms[control.uniform] = { x, y };
                    infoBubble.innerText = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
                    infoBubble.style.left = (clampedX + 50) + 'px';
                    infoBubble.style.top = (clampedY - 25) + 'px';
                }
                inputElement.addEventListener('mousedown', e => {
                    infoBubble.style.display = 'block';
                    updateXY(e);
                    function onMouseMove(e) { updateXY(e); }
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', function onMouseUp() {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
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
 * Directory Upload Setup
 ***************************************/
function handleFolderUpload(event) {
    const files = event.target.files;
    let schemaFile = null;
    let shaderFile = null;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) schemaFile = file;
        else if (name.endsWith('.glsl') || name.endsWith('.frag') || name.endsWith('.txt')) shaderFile = file;
    }
    if (!schemaFile) {
        logMessage("No JSON schema file found in the directory.");
    }
    if (!shaderFile) {
        logMessage("No GLSL shader file found in the directory.");
        return;
    }
    let newSchemaData = null, newShaderSource = null;
    const schemaReader = new FileReader();
    schemaReader.onload = e => {
        try { newSchemaData = JSON.parse(e.target.result); }
        catch (err) { logMessage("Error parsing JSON schema:", err); }
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
            const newProgram = createProgram(gl, vertexShaderSource, newShaderSource);
            if (newProgram) {
                let activeShader = shaderBuffers[currentShaderIndex];
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
            document.getElementById('controls-container').innerHTML = "";
            renderControls(newSchemaData);
        }
    }
}
document.getElementById('folder-upload').addEventListener('change', handleFolderUpload);

/***************************************
 * Main Render Loop (Two‑Pass Rendering)
 ***************************************/
let isPaused = false;
let lastFrameTime = 0;
let effectiveTime = 0;
function render(time) {
    if (lastFrameTime === 0) lastFrameTime = time;
    const delta = time - lastFrameTime;
    lastFrameTime = time;
    if (!isPaused) effectiveTime += delta;

    const currentShader = shaderBuffers[currentShaderIndex];

    // First Pass: render scene into offscreen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, currentShader.offscreenFramebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(currentShader.shaderProgram);
    if (currentShader.timeLocation) gl.uniform1f(currentShader.timeLocation, effectiveTime * 0.001);
    if (currentShader.resolutionLocation) gl.uniform2f(currentShader.resolutionLocation, canvas.width, canvas.height);

    // Update dynamic texture inputs (video, audio, etc.)
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        if (currentShader.sampleTextures[i] && currentShader.sampleTextureLocations[i] && currentShader.sampleMedia[i]) {
            if (currentShader.sampleMedia[i].type === "video") {
                gl.bindTexture(gl.TEXTURE_2D, currentShader.sampleTextures[i]);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, currentShader.sampleMedia[i].element);
                gl.bindTexture(gl.TEXTURE_2D, null);
            } else if (currentShader.sampleMedia[i].type === "audio") {
                const { analyser, dataArray } = currentShader.sampleMedia[i];
                analyser.getByteFrequencyData(dataArray);
                gl.bindTexture(gl.TEXTURE_2D, currentShader.sampleTextures[i]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, dataArray.length, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, dataArray);
                gl.bindTexture(gl.TEXTURE_2D, null);
            }
            gl.activeTexture(gl.TEXTURE2 + i);
            gl.bindTexture(gl.TEXTURE_2D, currentShader.sampleTextures[i]);
            gl.uniform1i(currentShader.sampleTextureLocations[i], 2 + i);
        }
    }
    const positionLocation = gl.getAttribLocation(currentShader.shaderProgram, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Second Pass: blit offscreen texture to the canvas
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
    gl.bindTexture(gl.TEXTURE_2D, currentShader.offscreenTexture);
    gl.uniform1i(quadTextureLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}
requestAnimationFrame(render);

/***************************************
 * Update Custom Uniforms (Global)
 ***************************************/
function updateCustomUniforms() {
    for (let name in customUniforms) {
        const value = customUniforms[name];
        const loc = gl.getUniformLocation(shaderBuffers[currentShaderIndex].shaderProgram, name);
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

/***************************************
 * Main Controls & Recording
 ***************************************/
document.getElementById('play-pause').addEventListener('click', function () {
    isPaused = !isPaused;
    this.textContent = isPaused ? 'Play' : 'Pause';
});
document.getElementById('restart').addEventListener('click', function () {
    effectiveTime = 0;
    if (window.audioAnalyser) loadMicrophone();
});
const canvasStream = canvas.captureStream(30);
let mediaRecorder;
let recordedChunks = [];
function startRecording() {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) recordedChunks.push(event.data);
    };
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
