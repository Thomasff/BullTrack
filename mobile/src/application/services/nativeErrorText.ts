import { t } from '../../i18n';
import type { zh } from '../../i18n/locales/zh';

export type FriendlyErrorCategory = keyof typeof zh.native.friendly;
type NativeErrorCode = keyof typeof zh.native.errors;

// Friendly category of each native error code (every key of native.errors). The C++ codes keep
// what their old Chinese messages were sorted into, except the red-bed failures, which now ask
// for light and the whole board; camera errors are all cameraUnavailable.
export const NATIVE_ERROR_CATEGORIES: Record<NativeErrorCode, FriendlyErrorCategory> = {
  debug_image_encode_failed: 'generic',
  first_frame_board_box_invalid: 'boardNotFound',
  board_crop_input_empty: 'boardNotFound',
  board_crop_invalid: 'boardNotFound',
  board_not_found: 'boardNotFound',
  first_frame_empty: 'boardNotFound',
  resize_input_empty: 'generic',
  resize_target_invalid: 'generic',
  first_frame_rectification_missing: 'boardNotFound',
  first_frame_radius_invalid: 'boardNotFound',
  point_rectification_failed: 'generic',
  first_frame_preprocessed_empty: 'boardNotFound',
  round_not_started: 'generic',
  frame_empty: 'generic',
  redetect_frame_empty: 'generic',
  prep_frame_empty: 'generic',
  double_bed_points_failed: 'boardNotFound',
  no_red_regions: 'boardUnclear',
  no_long_red_regions: 'boardUnclear',
  too_few_perpendicular_double_beds: 'boardNotFound',
  too_few_double_seats: 'boardNotFound',
  double_seats_inconsistent: 'boardNotFound',
  unsupported_motion_type: 'generic',
  invalid_pyramid_levels: 'generic',
  ecc_size_mismatch: 'generic',
  ecc_alignment_failed: 'generic',
  dart_component_empty: 'dartNotFound',
  dart_diff_blank: 'dartNotFound',
  dart_contour_not_found: 'dartNotFound',
  image_not_found: 'generic',
  image_read_failed: 'generic',
  red_lab_input_empty: 'generic',
  bitmap_null: 'generic',
  bitmap_info_failed: 'generic',
  bitmap_format_invalid: 'generic',
  bitmap_pixels_failed: 'generic',
  rotation_invalid: 'generic',
  session_invalid: 'generic',
  no_round_photo: 'generic',
  board_not_in_photo: 'generic',
  ncnn_asset_manager_missing: 'generic',
  asset_open_failed: 'generic',
  asset_empty: 'generic',
  asset_read_failed: 'generic',
  classes_empty: 'generic',
  yolo_input_empty: 'generic',
  yolo_square_outside_frame: 'generic',
  ncnn_asset_manager_not_set: 'generic',
  yolo_param_load_failed: 'generic',
  yolo_bin_load_failed: 'generic',
  yolo_input_failed: 'generic',
  yolo_output_failed: 'generic',
  yolo_output_size_mismatch: 'generic',
  yolo_output_empty: 'generic',
  camera_init_failed: 'cameraUnavailable',
  camera_bind_failed: 'cameraUnavailable',
  camera_not_ready: 'cameraUnavailable',
  camera_context_missing: 'cameraUnavailable',
  capture_failed: 'cameraUnavailable',
  unsupported_image_format: 'cameraUnavailable',
  camera_image_decode_failed: 'cameraUnavailable',
};

// Native errors are a snake_case code, optionally followed by ": detail".
export const splitNativeError = (rawMessage: string) => {
  const colon = rawMessage.indexOf(':');
  const code = (colon < 0 ? rawMessage : rawMessage.slice(0, colon)).trim();
  const detail = colon < 0 ? '' : rawMessage.slice(colon + 1).trim();
  return { code, detail };
};

const isNativeErrorCode = (code: string): code is NativeErrorCode =>
  Object.prototype.hasOwnProperty.call(NATIVE_ERROR_CATEGORIES, code);

// The raw native error for the debug panel, translated when it is a known code.
export const toNativeErrorDebugText = (rawMessage: string) => {
  const { code, detail } = splitNativeError(rawMessage);
  if (!isNativeErrorCode(code)) {
    return rawMessage;
  }
  const text = t(`native.errors.${code}`);
  return detail ? `${text}: ${detail}` : text;
};

export const classifyNativeError = (rawMessage: string): FriendlyErrorCategory => {
  const { code } = splitNativeError(rawMessage);
  if (isNativeErrorCode(code)) {
    return NATIVE_ERROR_CATEGORIES[code];
  }
  // English messages from Kotlin and CameraX, and anything without a code.
  const message = rawMessage.toLowerCase();
  if (message.includes('board too small in frame')) {
    return 'boardTooSmall';
  }
  if (message.includes('board too large in frame')) {
    return 'boardTooLarge';
  }
  if (message.includes('board off the frame centre')) {
    return 'boardOffCentre';
  }
  if (message.includes('board')) {
    return 'boardNotFound';
  }
  if (message.includes('dart')) {
    return 'dartNotFound';
  }
  if (message.includes('camera') || message.includes('activity')) {
    return 'cameraUnavailable';
  }
  if (message.includes('already running') || message.includes('awaiting confirmation')) {
    return 'roundBusy';
  }
  return 'generic';
};

// Categories that come down to where the phone or the board is; the game screen offers the
// placement guide with them.
const PLACEMENT_CATEGORIES: FriendlyErrorCategory[] = [
  'boardTooSmall',
  'boardTooLarge',
  'boardOffCentre',
  'boardNotFound',
  'boardUnclear',
];

export const isPlacementError = (rawMessage: string) =>
  PLACEMENT_CATEGORIES.includes(classifyNativeError(rawMessage));

// Maps raw native error messages to short user-facing text in the app language.
// The raw message stays available in the debug panel.
export const toFriendlyErrorText = (rawMessage: string) =>
  t(`native.friendly.${classifyNativeError(rawMessage)}`);
