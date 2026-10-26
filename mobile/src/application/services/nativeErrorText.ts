// Maps raw native error messages to short user-facing Chinese text.
// The raw message stays available in the debug panel.
export const toFriendlyErrorText = (rawMessage: string) => {
  const message = rawMessage.toLowerCase();
  if (message.includes('phone right of the board')) {
    return '手机在靶的右侧，请移到靶的左前方再开始';
  }
  if (message.includes('board') || message.includes('双倍区') || message.includes('首帧')) {
    return '没看到完整的靶盘，请把手机对准飞镖盘后重试';
  }
  if (message.includes('飞镖轮廓') || message.includes('dart') || message.includes('落点')) {
    return '这支镖没识别出来，可以在结果里手动修改';
  }
  if (message.includes('camera') || message.includes('相机') || message.includes('activity')) {
    return '相机暂时不可用，请退出对局后重试';
  }
  if (message.includes('already running') || message.includes('awaiting confirmation')) {
    return '上一轮还没结束，请先确认或退出对局';
  }
  return '识别出错了，请重试';
};
