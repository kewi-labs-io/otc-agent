import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'contracts/**',
      'solana/**',
      'elizaos/**',
      'eliza/**',
      'privy-frames-v2-demo/**',
      'a2a-js/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
    ],
  },
  
  // Base JS config
  js.configs.recommended,
  
  // Next.js config via compat layer
  ...compat.extends('next/core-web-vitals'),
  
  // TypeScript files configuration
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    settings: {
      'import/resolver': {
        alias: {
          map: [['@', './src']],
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      },
    },
    rules: {
      // Disable rules that conflict with TypeScript
      'no-unused-vars': 'off',
      'no-undef': 'off',
      
      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      
      // Allow empty catch blocks (common pattern for optional error handling)
      'no-empty': ['error', { allowEmptyCatch: true }],
      
      // Next.js specific
      '@next/next/no-img-element': 'off',
    },
  },
  
  // JavaScript files configuration
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
