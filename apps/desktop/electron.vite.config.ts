import { join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import Vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'unplugin-vue-router/vite'
import Yaml from 'unplugin-yaml/vite'
import Layouts from 'vite-plugin-vue-layouts'
import VueMacros from 'vue-macros/vite'

import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        include: [
          'electron-click-drag-plugin',
          'node-pty',
        ],
      },
    },
    plugins: [
      {
        // To replace `build.rolldownOptions`, as electron-vite still uses the deprecated
        // `rollupOptions`, using `rollupOptions` and `rolldownOptions` at the same
        // time may lead to unexpected merge results. Using `rollupOptions` to manipulate
        // `manualChunks` also did not work. Therefore, it was transformed into a plugin
        // declaration with the recommended `codeSplitting` option.
        name: 'manual-chunks',
        outputOptions(options) {
          options.codeSplitting = {
            groups: [
              {
                name(moduleId) {
                  // Prevent debug package from being bundled into index.js to avoid side-effect pollution
                  if (moduleId.includes('node_modules/debug')) {
                    return 'vendor-debug'
                  }
                },
              },
              {
                name(moduleId) {
                  // Prevent debug package from being bundled into index.js to avoid side-effect pollution
                  if (moduleId.includes('node_modules/h3')) {
                    return 'vendor-h3'
                  }
                },
              },
            ],
          }

          return options
        },
      },
      Info(),
    ],

    resolve: {
      alias: {
        '@jiaban/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      },
    },
  },

  preload: {
    build: {
      lib: {
        entry: {
          index: resolve(join(import.meta.dirname, 'src', 'preload', 'index.ts')),
        },
      },
    },

    plugins: [],
  },

  renderer: {
    // Use relative asset paths so packaged desktop builds can load the renderer correctly.
    base: './',

    build: {
      rolldownOptions: {
        input: {
          main: resolve(join(import.meta.dirname, 'src', 'renderer', 'index.html')),
        },
      },
    },

    optimizeDeps: {
      include: [
        '@moeru/std',
        '@xterm/addon-fit',
        'monaco-editor',
        'xterm',
      ],
      exclude: [
        // Static Assets: Models, Images, etc.
        'src/renderer/public/assets/*',
      ],
    },

    resolve: {
      alias: {
        '@jiaban/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      },
    },

    server: {
      fs: {
        // To mute errors like:
        //   The request id ".../node_modules/@fontsource/sniglet/files/sniglet-latin-400-normal.woff" is outside of Vite serving allow list.
        //
        // See: https://vite.dev/config/server-options#server-fs-strict
        strict: false,
      },
      warmup: {
        clientFiles: [resolve(join(import.meta.dirname, 'src', 'renderer', 'main.ts'))],
      },
    },

    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          inlineDynamicImports: false,
        },
      },
    },

    plugins: [
      Info(),

      {
        name: 'jiaban:defines',
        config(ctx) {
          const define: Record<string, any> = {
            'import.meta.env.RUNTIME_ENVIRONMENT': '\'electron\'',
          }
          if (ctx.mode === 'development') {
            define['import.meta.env.URL_MODE'] = '\'server\''
          }
          if (ctx.mode === 'production') {
            define['import.meta.env.URL_MODE'] = '\'file\''
          }

          return { define }
        },
      },

      Yaml(),

      VueMacros({
        plugins: {
          vue: Vue({
            include: [/\.vue$/, /\.md$/],
          }),
          vueJsx: false,
        },
        betterDefine: false,
      }),

      VueRouter({
        dts: resolve(import.meta.dirname, 'src/renderer/typed-router.d.ts'),
        routesFolder: [resolve(import.meta.dirname, 'src', 'renderer', 'pages')],
        exclude: ['**/components/**'],
      }),

      Layouts({
        layoutsDirs: [resolve(import.meta.dirname, 'src', 'renderer', 'layouts')],
        pagesDirs: [resolve(import.meta.dirname, 'src', 'renderer', 'pages')],
      }),

      UnoCss(),

      // https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n
      VueI18n({
        runtimeOnly: true,
        compositionOnly: true,
        fullInstall: true,
      }),
    ],
  },
})
