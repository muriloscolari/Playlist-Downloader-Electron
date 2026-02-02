const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const nodeID3 = require('node-id3');
const { Jimp } = require('jimp');

// Helper to run yt-dlp using system binary
function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `yt-dlp exited with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}

async function ytDlpJson(url, options = {}) {
    const args = [url, '--dump-single-json'];
    if (options.flatPlaylist) args.push('--flat-playlist');
    if (options.noWarnings) args.push('--no-warnings');

    const output = await runYtDlp(args);
    return JSON.parse(output);
}

async function ytDlpDownload(url, options = {}) {
    const args = [url];
    if (options.output) args.push('-o', options.output);
    if (options.format) args.push('-f', options.format);
    if (options.extractAudio) args.push('-x');
    if (options.audioFormat) args.push('--audio-format', options.audioFormat);
    if (options.audioQuality) args.push('--audio-quality', options.audioQuality);
    if (options.writeThumbnail) args.push('--write-thumbnail');
    if (options.noWarnings) args.push('--no-warnings');
    if (options.cookies) args.push('--cookies', options.cookies);
    if (options.client) args.push('--extractor-args', `youtube:player_client=${options.client}`);

    await runYtDlp(args);
}

// Simple concurrency limiter (replacement for p-limit which is ESM-only)
function createLimiter(concurrency) {
    let activeCount = 0;
    const queue = [];

    const next = () => {
        if (queue.length > 0 && activeCount < concurrency) {
            activeCount++;
            const { fn, resolve, reject } = queue.shift();
            fn().then(resolve).catch(reject).finally(() => {
                activeCount--;
                next();
            });
        }
    };

    return (fn) => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
    });
}

class QueueManager {
    constructor(mainWindow, savedFolder) {
        this.mainWindow = mainWindow;
        this.queue = [];
        this.isDownloading = false;
        this.baseDownloadDir = savedFolder || path.join(process.cwd(), 'downloads');
        this.maxConcurrency = 4;

        // Ensure download dir exists
        if (!fs.existsSync(this.baseDownloadDir)) fs.mkdirSync(this.baseDownloadDir, { recursive: true });
    }

    log(message) {
        console.log(message);
        if (this.mainWindow) this.mainWindow.webContents.send('log-message', message);
    }

    addToQueue(url) {
        if (!url) return false;
        this.queue.push(url);
        this.mainWindow.webContents.send('queue-update', this.queue);
        return true;
    }

    setDownloadFolder(folderPath) {
        this.baseDownloadDir = folderPath;
        if (!fs.existsSync(this.baseDownloadDir)) {
            fs.mkdirSync(this.baseDownloadDir, { recursive: true });
        }
        this.log(`Pasta de download alterada para: ${folderPath}`);
    }

    async start() {
        if (this.isDownloading) return;
        this.isDownloading = true;
        this.log("Iniciando processamento da fila...");

        try {
            while (this.queue.length > 0) {
                const url = this.queue.shift(); // FIFO
                this.mainWindow.webContents.send('queue-update', this.queue);

                await this.processPlaylist(url);
            }
            this.log("Todas as filas concluídas.");
            this.mainWindow.webContents.send('download-finished', "Todos os downloads concluídos!");
        } catch (error) {
            this.log(`Erro Crítico: ${error.message}`);
            this.mainWindow.webContents.send('download-error', error.message);
        } finally {
            this.isDownloading = false;
            this.mainWindow.webContents.send('status-change', "Pronto");
        }
    }

    async processPlaylist(url) {
        this.log(`Buscando informações da playlist: ${url}`);
        this.mainWindow.webContents.send('status-change', "Buscando informações...");

        try {
            const info = await ytDlpJson(url, {
                flatPlaylist: true,
                noWarnings: true
            });

            const playlistTitle = info.title || "Playlist Desconhecida";
            const entries = info.entries || [info]; // Handle single video

            this.log(`Encontrados ${entries.length} itens em '${playlistTitle}'`);

            // Create Folder
            const safeTitle = playlistTitle.replace(/[^a-zA-Z0-9 \.\_\-]/g, "").trim();
            const playlistDir = path.join(this.baseDownloadDir, safeTitle);
            if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir, { recursive: true });

            const limit = createLimiter(this.maxConcurrency);
            let completed = 0;
            const total = entries.length;

            this.mainWindow.webContents.send('status-change', `Baixando ${total} itens...`);

            // Map entries to promises with concurrency limit
            const tasks = entries.map((entry, index) => {
                return limit(() => this.downloadItemWithRetry(entry, playlistDir, index, total).then(res => {
                    completed++;
                    this.mainWindow.webContents.send('download-progress', { completed, total });
                }));
            });

            await Promise.all(tasks);

        } catch (err) {
            this.log(`Erro ao processar playlist: ${err.message}`);
        }
    }

    async downloadItemWithRetry(entry, dir, index, total) {
        const title = entry.title || "Desconhecido";
        const url = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

        // Retry strategies (mimicking the Python logic)
        // Note: yt-dlp-exec uses system yt-dlp usually, or local. 
        // We will pass simplified args.

        const maxRetries = 3;
        let success = false;

        for (let i = 0; i < maxRetries; i++) {
            if (success) break;
            try {
                if (i > 0) this.log(`[Tentativa ${i}] ${title}`);
                else this.log(`Processando: ${title}`);

                await this.downloadSingle(url, dir, entry.id);
                success = true;
            } catch (e) {
                this.log(`Falha na tentativa ${i + 1} para ${title}: ${e.message.split('\n')[0]}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (!success) {
            this.log(`FALHA PERMANENTE: ${title}`);
        }
    }

    async downloadSingle(url, dir, videoId) {
        // Prepare filename template
        const outputTemplate = path.join(dir, `${videoId}_temp.%(ext)s`);

        // Check for cookies file in multiple locations
        const possiblePaths = [
            path.join(process.cwd(), 'cookies.txt'),
            path.join(path.dirname(process.execPath), 'cookies.txt'),
            path.join(this.baseDownloadDir, '..', 'cookies.txt')
        ];

        let useCookies = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                useCookies = p;
                break;
            }
        }

        // Simplified strategies for speed (try most likely to work first)
        const strategies = [
            { client: 'android', format: 'bestaudio/best' },
            { client: 'web', format: 'bestaudio/best' }
        ];

        let success = false;
        let lastError = null;

        for (let i = 0; i < strategies.length && !success; i++) {
            const strategy = strategies[i];
            try {
                await ytDlpDownload(url, {
                    format: strategy.format,
                    output: outputTemplate,
                    extractAudio: true,
                    audioFormat: 'mp3',
                    audioQuality: '320K',
                    writeThumbnail: true,
                    noWarnings: true,
                    cookies: useCookies,
                    client: strategy.client
                });
                success = true;
            } catch (e) {
                lastError = e;
            }
        }

        if (!success) {
            throw lastError || new Error('All download strategies failed');
        }

        // Now find the file
        const mp3Path = path.join(dir, `${videoId}_temp.mp3`);

        if (!fs.existsSync(mp3Path)) {
            throw new Error("Arquivo baixado não encontrado");
        }

        // Find Thumbnail
        // yt-dlp might save as .webp or .jpg.
        const files = fs.readdirSync(dir);
        let thumbPath = files.find(f => f.startsWith(`${videoId}_temp`) && !f.endsWith('.mp3'));

        let thumbBuffer = null;
        if (thumbPath) {
            const fullThumbPath = path.join(dir, thumbPath);
            try {
                thumbBuffer = await this.processThumbnail(fullThumbPath);
            } catch (e) {
                this.log(`Erro de thumbnail: ${e.message}`);
            }
        }

        // Get info for metadata (we need specific title/artist for tagging)
        // We can just use what we have or re-fetch? 
        // To save time, we can assume entry.title is accurate or ask yt-dlp for JSON.
        // Let's rely on standard ID3 reading or just use 'Unknown' if we want speed,
        // BUT strict requirement was "Renaming files to {Song Name}.mp3".
        // We need the ACTUAL title from the file or info.

        // Let's probe the file or just trust the earlier info?
        // Better: allow yt-dlp to set filename? No, we need strict control.

        // We can fetch info again quickly or assume the initial playlist fetch had it. 
        // Note: 'dump-single-json' on playlist gives minimal info.

        // Let's use ffprobe or just node-id3 to read what yt-dlp might have written? 
        // No, we disabled addMetadata.

        // Let's fetch the specific video info quickly to get clean Title/Artist
        // OR rely on the playlist 'entry' title.
        // Let's use the playlist entry title for now, but clean it.

        // Refetch info for high accuracy metadata
        let videoTitle = "Desconhecido";
        let videoArtist = "Desconhecido";

        try {
            const videoInfo = await ytDlpJson(url, { noWarnings: true });
            videoTitle = videoInfo.title;
            videoArtist = videoInfo.uploader;
        } catch (e) {
            // Fallback
        }

        // Rename
        const safeFilename = videoTitle.replace(/[^a-zA-Z0-9 \.\\_\\-]/g, "").trim();
        let finalPath = path.join(dir, `${safeFilename}.mp3`);

        // Collision check
        if (fs.existsSync(finalPath)) {
            finalPath = path.join(dir, `${safeFilename}_${videoId}.mp3`);
        }

        fs.renameSync(mp3Path, finalPath);

        // Tagging
        const tags = {
            title: videoTitle,
            artist: videoArtist,
            image: thumbBuffer ? {
                mime: "image/jpeg",
                type: { id: 3, name: "front cover" },
                description: "Cover",
                imageBuffer: thumbBuffer
            } : undefined
        };

        nodeID3.write(tags, finalPath);
    }

    async processThumbnail(imagePath) {
        const { execSync } = require('child_process');

        // Convert to JPEG if needed (handles webp and other formats)
        const jpegPath = imagePath.replace(/\.(webp|png)$/i, '.jpg');

        if (imagePath !== jpegPath) {
            // Use FFmpeg to convert to JPEG
            execSync(`ffmpeg -i "${imagePath}" "${jpegPath}" -y`, { stdio: 'ignore' });
            // Delete original if it still exists
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        // Crop to 720x720 center using Jimp
        const image = await Jimp.read(jpegPath);
        const width = image.width;
        const height = image.height;

        // Center crop to square
        const size = Math.min(width, height);
        const x = Math.floor((width - size) / 2);
        const y = Math.floor((height - size) / 2);

        image.crop({ x, y, w: size, h: size });
        image.resize({ w: 720, h: 720 });

        const buffer = await image.getBuffer('image/jpeg');

        // Cleanup
        if (fs.existsSync(jpegPath)) fs.unlinkSync(jpegPath);

        return buffer;
    }
}

module.exports = QueueManager;
