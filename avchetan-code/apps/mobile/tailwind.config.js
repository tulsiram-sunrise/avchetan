const { light } = require('./src/theme/tokens.json');

// Colors are variables so one class works in both themes; src/theme/theme.tsx sets them.
const colors = Object.fromEntries(Object.keys(light).map((name) => [name, `var(--${name})`]));

module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: { colors } },
};
