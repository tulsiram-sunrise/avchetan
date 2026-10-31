const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// long-native-paths';
/** The block must come first: applying this plugin evaluates every module. */
const ANCHOR = 'apply plugin: "expo-root-project"';

// CMake repeats each native module's source path inside its build folder, which goes past Windows'
// path limit under pnpm's nested folders. Android's default CMake bundles a Ninja that can't exceed
// that limit; this one can, once Windows' LongPathsEnabled is on (apps/mobile/README.md).
const GRADLE = `${MARKER}
subprojects {
  ['com.android.application', 'com.android.library'].each { id ->
    plugins.withId(id) {
      android.externalNativeBuild.cmake.version = '3.31.6'
    }
  }
}

`;

module.exports = (config) =>
  withProjectBuildGradle(config, (gradle) => {
    const { contents } = gradle.modResults;
    if (contents.includes(MARKER)) return gradle;
    if (!contents.includes(ANCHOR)) throw new Error(`long-native-paths: no "${ANCHOR}" line`);
    gradle.modResults.contents = contents.replace(ANCHOR, GRADLE + ANCHOR);
    return gradle;
  });
