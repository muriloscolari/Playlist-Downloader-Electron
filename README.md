# YouTube Playlist Downloader

Aplicativo desktop construído com Electron para baixar playlists do YouTube como arquivos MP3 de alta qualidade.

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)

## Funcionalidades

- 🎵 **Áudio de Alta Qualidade** - Downloads em MP3 320kbps
- 📁 **Downloads Organizados** - Cria pastas por playlist
- 🖼️ **Capa do Álbum** - Incorpora thumbnails cortadas em 720x720 como capa
- 🏷️ **Metadados** - Tags automáticas de Título e Artista
- ⚡ **Downloads Simultâneos** - Até 4 downloads ao mesmo tempo
- 🔄 **Sistema de Retry** - Tentativas automáticas em caso de falha
- 📋 **Sistema de Fila** - Adicione múltiplas playlists na fila

## Pré-requisitos

- [Node.js](https://nodejs.org/) v18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado e no PATH
- [FFmpeg](https://ffmpeg.org/) instalado e no PATH

## Instalação

```bash
# Clone o repositório
git clone <url-do-repositorio>
cd YT-DLP-Node

# Instale as dependências
npm install

# Inicie o aplicativo
npm start
```

## Como Usar

1. **Adicionar à Fila** - Cole a URL de uma playlist ou vídeo do YouTube e clique em "Add to Queue"
2. **Iniciar Downloads** - Clique em "Start Downloads" para começar o processamento
3. **Acompanhar Progresso** - Veja a barra de progresso e os logs
4. **Acessar Arquivos** - Clique em "Open Folder" para ver os MP3s baixados

## Dependências

| Pacote | Propósito |
|--------|-----------|
| `electron` | Framework de aplicativo desktop |
| `yt-dlp-exec` | Wrapper do downloader YouTube |
| `sharp` | Processamento de imagem (corte de thumbnail) |
| `node-id3` | Tags de metadados MP3 |
