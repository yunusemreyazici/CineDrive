import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: {
      // tsup injects `baseUrl: "."` into the rollup-plugin-dts compiler
      // options, and TypeScript 6 turns the baseUrl deprecation into a hard
      // error (TS5101) that fails the DTS build. Silence it until tsup stops
      // injecting baseUrl.
      ignoreDeprecations: '6.0',
    },
  },
});
