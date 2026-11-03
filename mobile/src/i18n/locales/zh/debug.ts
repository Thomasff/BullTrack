// The debug screen (developer mode).
export const debug = {
  title: '调试图',
  description: '保存最近 10 轮的调试图和日志。识别出错时选中那一轮导出调试包，反馈问题时附上。',
  boardPreview: '虚拟靶盘预览',
  rounds: '轮次',
  // A round chip: its save time, marked when it is the round being played.
  currentRound: '{{clock}}（本轮）',
  noRounds: '还没有保存的调试图。打开「显示调试信息」后打一轮，这里就会出现。',
  noImages: '这一轮没有调试图（比如开局就失败了），调试包里只有日志。',
  packing: '正在打包…',
  exportBundle: '导出调试包',
  exportFailed: '导出失败：{{error}}',
  reload: '重新加载',
};
