// The placement guide: how to set up the phone, frame the board and light it.
export const guide = {
  title: '摆放指南',
  // Opens the guide: the "?" button on the preview and the settings row.
  open: '摆放指南',
  openDescription: '手机怎么摆，画面和光线怎么调',
  // Under a round-start error or hint about the phone or the board.
  link: '查看摆放指南 ›',
  gotIt: '知道了',
  steps: {
    position: '位置',
    view: '画面',
    light: '光线',
  },
  // Status under each animation frame; a ✓ or ✕ is put in front.
  position: {
    tooStraight: '太正：几乎正对靶子',
    tooAngled: '太斜：超过 45°',
    tooFar: '太远：要在人和靶子中间、偏靶子',
    left: '左前方，就放这里',
    right: '右前方也可以',
    oche: '投掷线',
    midpoint: '中点',
  },
  view: {
    small: '靶子太小，也不在中间',
    centre: '先让靶子在画面中间',
    zoom: '拉大倍率，靶子填满方框',
    caption: '手机屏幕里的画面',
  },
  light: {
    dark: '太暗，靶上的颜色看不清',
    glare: '灯光直射，靶面反光',
    good: '光线充足、均匀',
  },
  // <b>…</b> is shown bold.
  tips: {
    side: '手机架在靶子<b>左前方或右前方</b>，斜着对准靶子：偏离正前方 15°–45°，不要太正，也不要太斜',
    depth: '前后位置在<b>人和靶子中间，稍靠近靶子</b>',
    frame: '让<b>整个靶子</b>在画面中间，太小就拉大倍率',
    light: '保证<b>光线充足</b>，靶面没有强反光',
    still: '开局前拔掉靶上的镖，投镖时别碰手机和支架',
  },
  support:
    '支持主流软式、钢镖飞镖和靶子。镖杆、镖翼太透明或颜色太浅，或者靶子配色特殊，可能影响识别准确率；识别错了可以在结果里拖动修正。',
};
