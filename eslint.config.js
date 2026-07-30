// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'playground/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // Filter option shapes are type aliases on purpose: interfaces lack
      // implicit index signatures and would not satisfy `Record<string, unknown>`.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['tests/**'],
    rules: {
      // expectTypeOf(image.crop) inspects method types without binding them.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['src/cpu/**', 'src/filters/**', 'tests/**'],
    rules: {
      // Kernels index typed arrays heavily; with noUncheckedIndexedAccess on,
      // bounds are guaranteed by loop structure and asserted with `!`.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
)
