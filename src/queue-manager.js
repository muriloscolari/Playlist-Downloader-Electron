const ytDlp = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');
const nodeID3 = require('node-id3');
const sharp = require('sharp');

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
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.queue = [];
        this.isDownloading = false;
        this.baseDownloadDir = path.join(process.cwd(), 'downloads');
        this.maxConcurrency = 4;

        // Ensure download dir exists
        if (!fs.existsSync(this.baseDownloadDir)) fs.mkdirSync(this.baseDownloadDir);
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

    async start() {
        if (this.isDownloading) return;
        this.isDownloading = true;
        this.log("Starting queue processing...");

        try {
            while (this.queue.length > 0) {
                const url = this.queue.shift(); // FIFO
                this.mainWindow.webContents.send('queue-update', this.queue);

                await this.processPlaylist(url);
            }
            this.log("All queues completed.");
            this.mainWindow.webContents.send('download-finished', "All downloads completed!");
        } catch (error) {
            this.log(`Critical Error: ${error.message}`);
            this.mainWindow.webContents.send('download-error', error.message);
        } finally {
            this.isDownloading = false;
            this.mainWindow.webContents.send('status-change', "Ready");
        }
    }

    async processPlaylist(url) {
        this.log(`Fetching playlist info: ${url}`);
        this.mainWindow.webContents.send('status-change', "Fetching info...");

        try {
            const info = await ytDlp(url, {
                dumpSingleJson: true,
                flatPlaylist: true,
                noWarnings: true
            });

            const playlistTitle = info.title || "Unknown Playlist";
            const entries = info.entries || [info]; // Handle single video

            this.log(`Found ${entries.length} items in '${playlistTitle}'`);

            // Create Folder
            const safeTitle = playlistTitle.replace(/[^a-zA-Z0-9 \.\_\-]/g, "").trim();
            const playlistDir = path.join(this.baseDownloadDir, safeTitle);
            if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir, { recursive: true });

            const limit = createLimiter(this.maxConcurrency);
            let completed = 0;
            const total = entries.length;

            this.mainWindow.webContents.send('status-change', `Downloading ${total} items...`);

            // Map entries to promises with concurrency limit
            const tasks = entries.map((entry, index) => {
                return limit(() => this.downloadItemWithRetry(entry, playlistDir, index, total).then(res => {
                    completed++;
                    this.mainWindow.webContents.send('download-progress', { completed, total });
                }));
            });

            await Promise.all(tasks);

        } catch (err) {
            this.log(`Error processing playlist: ${err.message}`);
        }
    }

    async downloadItemWithRetry(entry, dir, index, total) {
        const title = entry.title || "Unknown";
        const url = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

        // Retry strategies (mimicking the Python logic)
        // Note: yt-dlp-exec uses system yt-dlp usually, or local. 
        // We will pass simplified args.

        const maxRetries = 3;
        let success = false;

        for (let i = 0; i < maxRetries; i++) {
            if (success) break;
            try {
                if (i > 0) this.log(`[Retry ${i}] ${title}`);
                else this.log(`Processing: ${title}`);

                await this.downloadSingle(url, dir, entry.id);
                success = true;
            } catch (e) {
                this.log(`Failed attempt ${i + 1} for ${title}: ${e.message.split('\n')[0]}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (!success) {
            this.log(`PERMANENT FAILURE: ${title}`);
        }
    }

    async downloadSingle(url, dir, videoId) {
        // Prepare filename template
        // We use a temp name first
        const outputTemplate = path.join(dir, `${videoId}_temp.%(ext)s`);

        await ytDlp(url, {
            format: 'bestaudio/best',
            output: outputTemplate,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '320K', // yt-dlp uses K suffix often
            // writethumbnail: true, // We will handle thumbnail manually if possible or let yt-dlp do it? 
            // Python script moved thumbnail separately. Let's let yt-dlp write it and we process it.
            writeThumbnail: true,
            noWarnings: true,
            // addMetadata: true, // We do manual metadata
        });

        // Now find the file
        const mp3Path = path.join(dir, `${videoId}_temp.mp3`);

        if (!fs.existsSync(mp3Path)) {
            throw new Error("Downloaded file not found");
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
                fs.unlinkSync(fullThumbPath); // Delete original thumb
            } catch (e) {
                this.log(`Thumbnail error: ${e.message}`);
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
        let videoTitle = "Unknown";
        let videoArtist = "Unknown";

        try {
            const videoInfo = await ytDlp(url, { dumpSingleJson: true, noWarnings: true });
            videoTitle = videoInfo.title;
            videoArtist = videoInfo.uploader;
        } catch (e) {
            // Fallback
        }

        // Rename
        const safeFilename = videoTitle.replace(/[^a-zA-Z0-9 \.\_\-]/g, "").trim();
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
        // Crop to 720x720 center
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        // Default smart crop or center? Instructions said "center crop".
        // Sharp resize with fit: 'cover' does center crop by default.
        return await image
            .resize(720, 720, { fit: 'cover', position: 'center' })
            .toFormat('jpeg')
            .toBuffer();
    }
}

module.exports = QueueManager;
