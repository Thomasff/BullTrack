import { i18n, t } from '../../i18n';
import type { zh } from '../../i18n/locales/zh';
import type { NativeStatusParams } from '../../native-bridge/bulltrack/types';
import { splitNativeError, toNativeErrorDebugText } from './nativeErrorText';

type StatusKey = `native.status.${keyof typeof zh.native.status}`;
type CameraKey = `native.camera.${keyof typeof zh.native.camera}`;
type GateKey = `native.gate.${keyof typeof zh.native.gate}`;

// Why a frame did not trigger precise detection, from the native gate's reason code.
export const describeGateReason = (reason: string): string => {
  if (reason.trim() === '') {
    return t('native.gate.unknown');
  }
  if (reason.startsWith('yolo_count_increased_no_board_change')) {
    const spaceIndex = reason.indexOf(' ');
    return t('native.gate.yolo_count_increased_no_board_change', {
      detail: spaceIndex < 0 ? '' : reason.slice(spaceIndex + 1),
    });
  }
  // These carry extra text after the code.
  if (reason.startsWith('yolo_detect_failed:')) {
    return t('native.gate.yolo_detect_failed');
  }
  if (reason.startsWith('alignment_low')) {
    return t('native.gate.alignment_low');
  }
  if (reason.startsWith('lost_box_')) {
    return t('native.gate.lost_box');
  }
  const key = `native.gate.${reason}`;
  return i18n.exists(key) ? t(key as GateKey) : reason;
};

// A native round status code with its parameters in the app language; an unknown code is shown
// as it is.
export const toNativeStatusText = (code: string, params: NativeStatusParams = {}): string => {
  const key = `native.status.${code}`;
  if (!i18n.exists(key)) {
    return code;
  }
  const values: NativeStatusParams = { ...params };
  if (code === 'frame_not_triggered' && typeof params.reason === 'string') {
    values.reason = describeGateReason(params.reason);
  }
  if (code === 'frame_failed' && typeof params.error === 'string') {
    values.error = toNativeErrorDebugText(params.error);
  }
  // The camera's note on the first frame is a camera status code.
  if (code === 'camera_message' && typeof params.message === 'string') {
    values.message = toCameraStatusText(params.message);
  }
  return t(key as StatusKey, values);
};

// Camera status messages and lock reasons are camera codes (optionally "code: detail"), and a
// camera in its error state reports an error code; anything else (CameraX's own exception text)
// passes through.
export const toCameraStatusText = (message: string): string => {
  const { code, detail } = splitNativeError(message);
  const key = `native.camera.${code}`;
  if (i18n.exists(key)) {
    return t(key as CameraKey, { detail });
  }
  return toNativeErrorDebugText(message);
};
