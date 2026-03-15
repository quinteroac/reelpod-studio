module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'prettier'
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ],
    // React Three Fiber uses Three.js object properties as JSX props which the
    // standard react/no-unknown-property rule does not recognise.
    'react/no-unknown-property': 'off',
    // R3F useFrame callbacks and useMemo uniforms legitimately access refs
    // outside the React render cycle; the rule produces false positives here.
    'react-hooks/refs': 'off'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  overrides: [
    {
      // React Three Fiber effect and visualizer components use patterns that are
      // idiomatic in Three.js but trigger React-compiler-style lint rules:
      //   - react-hooks/immutability: uniforms must be mutated each frame
      //   - react-hooks/purity: Math.random() in useRef initial value is a one-time init
      files: [
        'src/components/effects/**/*.{ts,tsx}',
        'src/components/visualizers/**/*.{ts,tsx}'
      ],
      rules: {
        'react-hooks/immutability': 'off',
        'react-hooks/purity': 'off'
      }
    }
  ],
  ignorePatterns: ['dist/', 'node_modules/']
};
