const path = require('path');

module.exports = {
  presets: ['@babel/preset-env'],
  plugins: [
    '@babel/plugin-proposal-object-rest-spread',
    '@babel/plugin-proposal-class-properties',
    [
      'module-resolver',
      {
        root: [path.resolve('./')],
        alias: {
          '@': './src',
        },
      },
    ],
  ],
};
