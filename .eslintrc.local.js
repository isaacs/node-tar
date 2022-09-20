module.exports = {
  rules: {
    'max-len': 0,
    'no-shadow': 0,
    'no-unused-expressions': 0,
    'no-sequences': 0,
    'no-empty': 0,
  },
  overrides: [{
    files: ['test/**'],
    rules: {
      'promise/catch-or-return': 0,
      'promise/always-return': 0,
    },
  }],
}
