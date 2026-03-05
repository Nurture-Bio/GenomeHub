import path from 'node:path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import type { StorybookConfig } from '@storybook/react-vite';

function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

// __dirname = packages/client/.storybook
const CLIENT = path.resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const REPO = path.resolve(CLIENT, '../..');

const config: StorybookConfig = {
  stories: ['../src/ui/**/*.stories.@(ts|tsx)', '../src/ui/**/*.mdx'],
  staticDirs: ['../public'],
  addons: [
    getAbsolutePath('@storybook/addon-docs'),
    getAbsolutePath('@storybook/addon-a11y'),
  ],
  framework: getAbsolutePath('@storybook/react-vite'),
  viteFinal: async (config) => {
    const { mergeConfig } = await import('vite');
    const tailwind = (await import('@tailwindcss/vite')).default;

    return mergeConfig(config, {
      plugins: [tailwind()],
      envDir: REPO,
      resolve: {
        alias: {
          '@strand/core': path.resolve(REPO, 'vendor/strand/src/index.ts'),
          '@strand/inference': path.resolve(
            REPO,
            'packages/strand/src/inference.ts',
          ),
        },
      },
    });
  },
};

export default config;
