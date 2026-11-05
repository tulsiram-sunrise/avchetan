const { withAppBuildGradle } = require('expo/config-plugins');

// Release APKs are signed with the project's release key when the AVCHETAN_KEYSTORE_* variables
// are set (the release workflow sets them from GitHub secrets; ADR-0018). Without them, a release
// build is signed with the debug key and only installs over another debug-signed build.
// AVCHETAN_VERSION_CODE (the workflow's run number) lets each published APK update the last one.
const MARKER = '// release-signing';

const SIGNING = `${MARKER}
        release {
            def releaseStore = System.getenv('AVCHETAN_KEYSTORE_PATH')
            if (releaseStore) {
                storeFile file(releaseStore)
                storePassword System.getenv('AVCHETAN_KEYSTORE_PASSWORD')
                keyAlias System.getenv('AVCHETAN_KEY_ALIAS')
                keyPassword System.getenv('AVCHETAN_KEY_PASSWORD')
            }
        }
`;

function replaceOnce(contents, from, to, what) {
  if (!contents.includes(from)) throw new Error(`release-signing: no ${what} in app/build.gradle`);
  return contents.replace(from, to);
}

module.exports = (config) =>
  withAppBuildGradle(config, (gradle) => {
    let contents = gradle.modResults.contents;
    if (contents.includes(MARKER)) return gradle;
    contents = replaceOnce(
      contents,
      /versionCode \d+/.exec(contents)?.[0] ?? 'versionCode',
      "versionCode((System.getenv('AVCHETAN_VERSION_CODE') ?: '1').toInteger())",
      'versionCode',
    );
    contents = replaceOnce(
      contents,
      '    signingConfigs {\n',
      `    signingConfigs {\n${SIGNING}`,
      'signingConfigs block',
    );
    // The release build type is the one Expo's template marks with this comment.
    contents = replaceOnce(
      contents,
      '// see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.debug',
      "// see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig System.getenv('AVCHETAN_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
      'release signingConfig',
    );
    gradle.modResults.contents = contents;
    return gradle;
  });
