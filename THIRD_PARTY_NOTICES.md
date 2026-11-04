# Third-party notices

BullTrack is licensed under the GNU Affero General Public License v3.0 or later (see [LICENSE](LICENSE)).

It builds on the third-party components listed below, each under its own license. This repository does not contain their code: they are downloaded at build time (npm, Gradle and `scripts/fetch-native-deps.js`) and bundled into the APK.

## Detection model

| Component | License | Source |
| --- | --- | --- |
| Ultralytics YOLO11s | AGPL-3.0 | https://github.com/ultralytics/ultralytics |

The model published in Releases (`model.ncnn.param` / `model.ncnn.bin`) was fine-tuned from the YOLO11s pretrained weights with Ultralytics and converted to the ncnn format. It is distributed under AGPL-3.0.

## Native libraries

| Component | Version | License | Source |
| --- | --- | --- | --- |
| OpenCV Android SDK | 4.12.0 | Apache-2.0 | https://github.com/opencv/opencv |
| ncnn (android-vulkan build) | 20260113 | BSD-3-Clause | https://github.com/Tencent/ncnn |

OpenCV includes further third-party components (libjpeg-turbo, libpng, libtiff, OpenJPEG, OpenEXR, protobuf, flatbuffers and others); their license texts are in `sdk/etc/licenses/` of the OpenCV Android SDK. For the components bundled with ncnn, see `LICENSE.txt` in the ncnn repository.

## Android libraries

| Component | Version | License |
| --- | --- | --- |
| React Native for Android (`react-android`, Hermes) | 0.84.1 | MIT |
| AndroidX Core, Lifecycle, ExifInterface | see `bulltrack-core/build.gradle` and `mobile/android/app/build.gradle` | Apache-2.0 |
| AndroidX CameraX | 1.3.4 | Apache-2.0 |
| Kotlin standard library | follows the Kotlin Gradle plugin (`mobile/android/build.gradle`) | Apache-2.0 |
| kotlinx.coroutines | 1.8.1 | Apache-2.0 |
| Guava | 33.2.1-android | Apache-2.0 |

React Native's Android libraries include further open-source components under their own licenses; see https://github.com/facebook/react-native.

## JavaScript libraries

| Package | Version | License |
| --- | --- | --- |
| react | 19.2.3 | MIT |
| react-native | 0.84.1 | MIT |
| @react-navigation/native | 7.2.2 | MIT |
| @react-navigation/native-stack | 7.14.10 | MIT |
| react-native-gesture-handler | 2.31.0 | MIT |
| react-native-safe-area-context | 5.7.0 | MIT |
| react-native-screens | 4.24.0 | MIT |
| react-native-sqlite-storage | 6.0.1 | MIT |
| react-native-svg | 15.15.5 | MIT |
| react-native-view-shot | 6.1.1 | MIT |
| zustand | 5.0.12 | MIT |

Their dependencies are mostly MIT; the others are BSD-2-Clause (css-select, css-what, domelementtype, domhandler, domutils, entities, nth-check), BSD-3-Clause (hoist-non-react-statics, source-map), ISC (boolbase) and CC0-1.0 (mdn-data). After `npm install`, each package's license text is in `mobile/node_modules/<package>/`.

## Other assets

- The in-game sound cues (`mobile/android/app/src/main/res/raw/cue_*.wav`) are synthesized by `mobile/scripts/generate-sound-cues.js`, part of this project.
- The share cards use the Outfit font (Bold and Medium, `mobile/android/app/src/main/assets/fonts/`), Copyright 2021 The Outfit Project Authors, SIL Open Font License 1.1 (license text in `OFL.txt` next to the fonts), https://github.com/Outfitio/Outfit-Fonts. The README banner wordmark is set in the same font and converted to outlines.
