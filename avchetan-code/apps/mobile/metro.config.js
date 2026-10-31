const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Expo's defaults find the pnpm workspace, so `@avchetan/*` resolve to their TypeScript source.
module.exports = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
