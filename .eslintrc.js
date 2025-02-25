module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      modules: true,
      spread: true,
      arrowFunctions: true,
    },
  },
  // settings: { react: { version: 'detect' } },
  rules: {
    'array-bracket-spacing': ['warn', 'never'],
    'arrow-body-style': ['warn', 'as-needed'],
    'arrow-parens': ['warn', 'as-needed'],
    camelcase: 'off',
    curly: ['warn', 'multi-or-nest'],
    'implicit-arrow-linebreak': 'off', // ['warn', 'beside'],
    indent: 'off', // disable when using prettier
    // 'jsx-a11y/anchor-is-valid': 'off',
    // 'jsx-a11y/click-events-have-key-events': 'warn',
    'linebreak-style': ['warn', 'unix'],
    'multiline-ternary': 'off', // ['warn', 'never'],
    'no-async-promise-executor': 'off',
    'no-debugger': 'warn',
    'no-extra-boolean-cast': ['off'],
    'no-multiple-empty-lines': ['warn', { max: 1 }],
    'no-return-assign': 'off',
    'no-spaced-func': 'warn',
    'no-trailing-spaces': 'warn',
    'no-plusplus': 'off',
    'no-prototype-builtins': 'off',
    'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_' }],
    'no-unreachable': 'warn',
    'object-curly-newline': 'off', // ['warn', { multiline: true, minProperties: 4 }],
    'operator-linebreak': 'off', // ['warn', 'before'],
    'padding-line-between-statements': [
      'warn',
      {
        blankLine: 'always',
        prev: 'directive',
        next: '*',
      },
      {
        blankLine: 'always',
        prev: ['const', 'let', 'var'],
        next: '*',
      },
      {
        blankLine: 'any',
        prev: ['const', 'let', 'var'],
        next: ['const', 'let', 'var', 'if'],
      },
      {
        blankLine: 'always',
        prev: '*',
        next: 'return',
      },
    ],
    'prefer-destructuring': ['error', { object: true, array: false }],
    'prettier/prettier': [
      'warn',
      {
        bracketSameLine: false,
        bracketSpacing: true,
        parser: 'babel-ts',
        printWidth: 80,
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        trailingComma: 'es5',
        arrowParens: 'avoid',
      },
    ],
    quotes: ['warn', 'single', { avoidEscape: true }],
    // 'react/display-name': 'off',
    // 'react/prop-types': 'off',
    // 'react-hooks/exhaustive-deps': 'warn',
    semi: ['warn', 'always'],
    'sort-keys': 'off',
    'space-before-function-paren': 'off',
    'space-in-parens': ['warn', 'never'],
    'space-infix-ops': 'warn',
    'wrap-regex': 'warn',
    // '@next/next/no-img-element': 'warn',
    // Turn off all typescript rules by default
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/ban-ts-ignore': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars-experimental': 'off',
    '@typescript-eslint/no-var-requires': 'off',
  },
  overrides: [
    {
      // Enable typescript rules for ts files only
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/ban-ts-ignore': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { args: 'after-used', argsIgnorePattern: '^_' },
        ],
      },
    },
  ],
};
