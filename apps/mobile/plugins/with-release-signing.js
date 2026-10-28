const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withReleaseSigning(config, { enabled }) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "Dock release signing requires the Expo Groovy Android template.",
      );
    }
    config.modResults.contents = config.modResults.contents.replace(
      /\n\/\/ Dock release signing[\s\S]*?android\.buildTypes\.release\.signingConfig = android\.signingConfigs\.dockRelease\n/,
      "",
    );
    if (enabled) {
      config.modResults.contents += `
// Dock release signing
def dockSigningPath = System.getenv("DOCK_ANDROID_SIGNING_PROPERTIES")
if (!dockSigningPath) {
    throw new GradleException("Set DOCK_ANDROID_SIGNING_PROPERTIES to a private signing properties file. Dock production builds cannot use the debug key.")
}
def dockSigning = new Properties()
file(dockSigningPath).withInputStream { dockSigning.load(it) }
android.signingConfigs.create("dockRelease") {
    storeFile file(dockSigning.getProperty("storeFile"))
    storePassword dockSigning.getProperty("storePassword")
    keyAlias dockSigning.getProperty("keyAlias")
    keyPassword dockSigning.getProperty("keyPassword")
}
android.buildTypes.release.signingConfig = android.signingConfigs.dockRelease
`;
    }
    return config;
  });
};
