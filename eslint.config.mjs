export default [{
  files: ['*.js'],
  ignores: ['fix_issues.js', 'rewrite_haptic.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  rules: {
    'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error',
    'no-duplicate-case': 'error', 'valid-typeof': 'error', 'no-unsafe-finally': 'error',
    'constructor-super': 'error', 'no-constant-binary-expression': 'error'
  }
}];
