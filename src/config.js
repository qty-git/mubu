// 应用版本和核心参数。
// 从主逻辑中拆出，便于后续调参。

const APP_VERSION = "v2026.06.02-r86";

const CFG = {
      cols: 44,
      rows: 42,
      friction: 0.928,
      gravity: 0.155,
      iterations: 7,
      stickStiffness: 0.24,
      bendStiffness: 0.026,
      grabRadius: 142,
      maxGrabPoints: 24,
      matchRadius: 270,
      pinchOnRatio: 0.34,
      pinchOffRatio: 0.52,
      pinchOnAbs: 0.055,
      pinchOffAbs: 0.095,
      pinchConfirmFrames: 2,
      pinchReleaseFrames: 5,
      maxPinchStartSpeed: 62,
      dualScaleConfirmFrames: 6,
      dualScaleDeadZone: 34,
      dualScaleMinHandDistance: 120,
      dualScaleMaxStartSpeed: 38,
      // 双手缩放速度增益：拉开/合拢越快，虚拟缩放距离越大，
      // 这样不用把手移动很远也能放大到最大。
      dualScaleVelocityDivisor: 18,
      dualScaleVelocityMaxGain: 3.4,
      dualScaleSmoothMin: 0.14,
      dualScaleSmoothMax: 0.30,
      // 双手同时捏住时，手掌中点移动会平移幕布/媒体区域。
      dualPanDeadZone: 10,
      dualPanGain: 0.92,
      dualPanMaxStep: 58,
      triMoveConfirmFrames: 4,
      triMoveReleaseFrames: 5,
      triMoveMaxStartSpeed: 42,
      triMoveOnRatio: 0.30,
      triMoveOffRatio: 0.42,
      triMoveOnAbs: 0.085,
      triMoveCooldownMs: 420,
      triMovePanGain: 1,
      triMovePanMaxStep: 58,
      mobileRolledHitHeightRatio: 0.22,
      mobileRolledDropRatio: 0.34,
      frostedHitPadMin: 82,
      frostedHitPadRatio: 0.22
    };

const ASPECT_PRESETS = {
      full: null,
      "16:9": 16 / 9,
      "4:3": 4 / 3,
      "3:4": 3 / 4,
      "9:16": 9 / 16,
      "1:1": 1
    };

const COVER_MODES = {
  transparent: "透明幕布",
  frosted: "磨砂玻璃"
};

const DISPLAY_ASPECT_PRESETS = {
  inherit: null,
  full: null,
  "1:1": 1,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "16:9": 16 / 9
};

const CHROMA_GREEN = "#00b140";

const FROST_CFG = {
  blur: 15,
  glassAlpha: 0.34,
  // r74: persistent low-cost erase mask; animation is applied every draw frame
  // so wipe motion is smooth even when MediaPipe hand frames arrive unevenly.
  eraseRadius: 78,
  eraseRadiusMin: 30,
  eraseRadiusMax: 230,
  // 1.0 means eraser diameter is close to the visible palm horizontal diameter.
  erasePalmDiameterScale: 1.08,
  eraseStepFactor: 0.035,
  eraseRadiusSmooth: 0.82,
  erasePositionFollow: 0.78,
  eraseTargetMaxAge: 170,
  eraseMaskSize: 720,
  revealLayerMaxSize: 960,
  eraseSoftEdge: 0.22,
  eraseFadeMs: 0
};
