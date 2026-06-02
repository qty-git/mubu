// Runtime DOM references and shared mutable state.
// Extracted from app.js in r59 to keep the main loop smaller.

const cameraVideo = document.getElementById("cameraVideo");
    const startOverlay = document.getElementById("startOverlay");
    const startBtn = document.getElementById("startBtn");
    const statusEl = document.getElementById("status");
    const versionBadge = document.getElementById("versionBadge");
    const mediaInput = document.getElementById("mediaInput");
    const flipBtn = document.getElementById("flipBtn");
    const modeBtn = document.getElementById("modeBtn");
    const recordBtn = document.getElementById("recordBtn");
    const coverModeBtn = document.getElementById("coverModeBtn");
    const frostResetBtn = document.getElementById("frostResetBtn");
    const scaleInput = document.getElementById("scaleInput");
    const curtainSizeInput = document.getElementById("curtainSizeInput");
    const sizeTargetBtn = document.getElementById("sizeTargetBtn");
    const aspectSelect = document.getElementById("aspectSelect");
    const greenAspectSelect = document.getElementById("greenAspectSelect");
    const greenScreenBtn = document.getElementById("greenScreenBtn");
    const debugToggleBtn = document.getElementById("debugToggleBtn");
    const eyeBtn = document.getElementById("eyeBtn");
    const debugEl = document.getElementById("debug");
    const gestureHud = document.getElementById("gestureHud");

    let stageRect = { x: 0, y: 0, w: 0, h: 0 };
    let stageAspectKey = "auto";

    let ctx;
    let canvasEl;
    let hands;
    let handsReady = false;
    let sendingHands = false;
    let started = false;
    let facingMode = "user";
    let mirrorCamera = true;
    let stream = null;
    let mediaItems = [];
    let coverMode = localStorage.getItem("curtainCoverMode") || "transparent";
    let greenScreenEnabled = localStorage.getItem("curtainGreenScreen") === "1";
    let greenAspectKey = localStorage.getItem("curtainGreenAspect") || "inherit";
    let debugVisible = localStorage.getItem("curtainDebugVisible") === "1";
    let frostEraseMarks = [];
    let palmErasers = [];
    let frostEraseLastSamples = new Map();
    let frostEraseTargets = new Map();
    let frostEraseMasks = new Map();
    let frostRevealLayers = new Map();
    let mediaScale = 1;
    let cloths = [];
    let selectedCloth = null;
    let sizeAllCurtains = false;
    let dragMode = false;
    let audioCtx = null;
    let audioDestination = null;
    let mediaRecorder = null;
    let recordChunks = [];
    let recordingMicStream = null;
    let recordingMicSource = null;
    let recordingMicGain = null;
    let handTracks = [];
    let currentHandIds = new Set();
    let currentPinchIds = new Set();
    let nextHandId = 1;
    let grabs = new Map();
    let handMoves = new Map();
    let pointerGrab = null;
    let moveDrag = null;
    let pointerDown = false;
    let lastDebug = {
      ratio: "-",
      dist: "-",
      hands: 0,
      pinches: 0,
      scaling: false,
      scaleHands: 0,
      lastFrameAt: 0,
      palms: 0,
      triMoves: 0
    };
    let dualHandScale = null;
    let lastHudUpdateAt = 0;
    let lastDebugUpdateAt = 0;
