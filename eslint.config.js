import tseslint from 'typescript-eslint';
export default [{ ignores: ['dist/**','work/**','attachments/**','node_modules/**'] }, ...tseslint.configs.recommended];
