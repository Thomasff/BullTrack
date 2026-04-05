const fs = require('fs');
const path = require('path');

const filePath = path.join(
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

if (!fs.existsSync(filePath)) {
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');

if (!original.includes(pluginPortalBlock)) {
  process.exit(0);
}

const updated = original.replace(pluginPortalBlock, '');
fs.writeFileSync(filePath, updated, 'utf8');

console.log(
  'Applied BullTrack mobile patch: removed plugins.gradle.org from Vision Camera buildscript repositories.',
);
