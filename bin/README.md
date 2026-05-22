# `undrcode` CLI

Pequeno wrapper Node.js que fala com a instância rodando do UNDRCode via named
pipe (Windows) ou Unix domain socket (Linux/macOS).

## Comandos

```sh
undrcode                       # foca o app (ou mostra hint se não tá rodando)
undrcode .                     # abre o diretório atual como workspace
undrcode C:\code\projeto       # abre pasta como workspace
undrcode arquivo.ts            # abre arquivo no editor
undrcode --goto src/App.tsx:42:10
undrcode --diff antes.txt depois.txt
undrcode --help
undrcode --version
```

Se UNDRCode não estiver rodando, o CLI sai com exit code 1 e imprime hint
pedindo pra abrir o app primeiro. Não faz auto-spawn (evita herdar PATH/env
errado do shell que chamou).

## Instalar no PATH

### Windows

Opção 1 — via instalador NSIS:
- O instalador oficial pode adicionar `undrcode.cmd` a `%APPDATA%\UNDRCode\bin`
  e incluir o path no `PATH` do usuário (TODO no `nsis` config).

Opção 2 — manualmente (dev / portable):
1. Crie um `undrcode.cmd` em algum diretório do seu `PATH` (ex.
   `C:\Users\<você>\bin`):
   ```bat
   @echo off
   node "C:\Users\<você>\Desktop\akai-code\bin\undrcode.js" %*
   ```
2. Adicione esse diretório ao `PATH` (Configurações → Sistema → Variáveis de
   ambiente → Path do usuário → Novo → cole o caminho).
3. Abra um novo terminal. Teste com `undrcode --version`.

### Linux / macOS

```sh
# Symlink rápido (precisa do repo clonado):
sudo ln -s "$PWD/bin/undrcode.js" /usr/local/bin/undrcode
sudo chmod +x bin/undrcode.js /usr/local/bin/undrcode

# Ou via npm (link global, dev):
npm link
```

Teste com `undrcode --version`.

## Como funciona

```
$ undrcode --goto src/App.tsx:42
       │
       │  conecta no pipe
       ▼
[ named pipe \\.\pipe\undrcode  (Windows) ]
[ UDS /tmp/undrcode.<user>.sock (POSIX)   ]
       │
       ▼
src/main/cli-server.ts (listener)
       │
       │  webContents.send('cli:command', {...})
       ▼
src/preload/index.ts  (cli.onCommand)
       │
       ▼
src/renderer/App.tsx  (abre file/diff/workspace)
```

Single-instance lock no main (`app.requestSingleInstanceLock`) garante que
rodar a build do app duas vezes não cria duas janelas — a segunda manda os
args pra primeira via `second-instance` (atalho útil quando o pipe ainda não
subiu).

## Troubleshooting

- `undrcode: UNDRCode não está rodando` → abra o app primeiro.
- Comando não encontrado → confirme que o diretório do bin tá no `PATH`.
- No Windows o named pipe é gerenciado pelo SO — não precisa cleanup.
- No Linux/macOS o socket é removido no `before-quit`.
