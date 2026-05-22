import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts')
      },
      rollupOptions: {
        external: ['electron', 'node-pty', 'chokidar', 'electron-store']
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      // Multi-entry: main preload (index) + webview-specific preload (preview-webview).
      // Preview-webview é attached ao <webview> via `preload` attr → bridge IPC nativo
      // (ipcRenderer.sendToHost) em vez do console.log hack que tinha antes.
      // CRÍTICO #1: treeshake.moduleSideEffects: true — sem isso, Rollup remove
      // `contextBridge.exposeInMainWorld(...)` por considerar side-effect-free.
      // CRÍTICO #2: manualChunks função vazia — força TUDO inline em cada entry,
      // sem chunks compartilhados. Sandbox/contextIsolation do Electron NÃO
      // consegue require() de chunks externos, então preload boota mas falha
      // silencioso → window.akaiAPI fica undefined no renderer.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'preview-webview': resolve(__dirname, 'src/preload/preview-webview.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          // Sem chunks compartilhados — null = não criar chunk pra esse modulo
          // (vai inline no entry que o importa). Aplica pra TODOS os modulos.
          manualChunks: () => null,
        },
        treeshake: {
          moduleSideEffects: true,
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      // Chunk splitting: separa libs pesadas em chunks paralelizáveis.
      // Antes: tudo num único index.js de 8.5MB → load serial inteiro no boot.
      // Depois: chunks carregados em paralelo + cacheable por library version.
      //   - monaco-editor: ~6-8MB (editor + 80 languages stubs)
      //   - prism + react vendor + outras libs em chunks separados
      // Reduz time-to-interactive em 150-300ms numa máquina decente.
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          manualChunks(id: string) {
            // node_modules → chunk vendor por package
            if (id.includes('node_modules')) {
              if (id.includes('monaco-editor')) return 'monaco';
              if (id.includes('prismjs')) return 'prism';
              if (id.includes('marked')) return 'marked';
              if (id.includes('@xterm') || id.includes('xterm')) return 'xterm';
              if (id.includes('react-dom')) return 'react-dom';
              if (id.includes('@tanstack/react-virtual')) return 'virtual';
              if (id.includes('react/') || id.includes('/react/')) return 'react';
              // outras deps menores juntas em vendor
              return 'vendor';
            }
          }
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()]
  }
});
