const fs = require('fs');
const path = require('path');

const visionCameraBuildGradlePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-vision-camera',
  'android',
  'build.gradle',
);

const pluginPortalBlock = `    maven {
      url "https://plugins.gradle.org/m2/"
    }
`;

const patchFile = (filePath, searchValue, replaceValue, message) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const original = fs.readFileSync(filePath, 'utf8');

  if (!original.includes(searchValue)) {
    return;
  }

  const updated = original.replace(searchValue, replaceValue);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(message);
};

patchFile(
  visionCameraBuildGradlePath,
  pluginPortalBlock,
  '',
  'Applied BullTrack mobile patch: removed plugins.gradle.org from Vision Camera buildscript repositories.',
);

const sqliteStorageBuildGradlePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-sqlite-storage',
  'platforms',
  'android',
  'build.gradle',
);

patchFile(
  sqliteStorageBuildGradlePath,
  '        jcenter()\n',
  '        mavenCentral()\n',
  'Applied BullTrack mobile patch: replaced SQLite Storage jcenter() repository with mavenCentral().',
);
