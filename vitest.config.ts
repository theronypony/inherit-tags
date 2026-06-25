import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            // The 'obsidian' package has no runtime; stub it so pure modules import cleanly in tests.
            obsidian: path.resolve(__dirname, 'tests/stubs/obsidian.ts')
        }
    },
    test: {
        include: ['tests/**/*.test.ts']
    }
});
