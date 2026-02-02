const urlInput = document.getElementById('urlInput');
const addBtn = document.getElementById('addBtn');
const startBtn = document.getElementById('startBtn');
const folderBtn = document.getElementById('folderBtn');
const chooseFolderBtn = document.getElementById('chooseFolderBtn');
const currentFolder = document.getElementById('currentFolder');
const queueList = document.getElementById('queueList');
const logArea = document.getElementById('logArea');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const progressPercent = document.getElementById('progressPercent');
const statusText = document.getElementById('statusText');

// Helpers
function log(msg) {
    const div = document.createElement('div');
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

// Event Listeners
addBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    if (await window.api.addToQueue(url)) {
        urlInput.value = '';
    } else {
        alert('URL inválida ou erro ao adicionar à fila');
    }
});

startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    addBtn.disabled = true;
    try {
        await window.api.startQueue();
    } catch (e) {
        console.error(e);
        startBtn.disabled = false;
        addBtn.disabled = false;
    }
});

folderBtn.addEventListener('click', () => {
    window.api.openDownloads();
});

chooseFolderBtn.addEventListener('click', async () => {
    const result = await window.api.chooseFolder();
    if (result.success) {
        updateFolderDisplay(result.path);
    }
});

// Helper to update folder display
function updateFolderDisplay(folderPath) {
    const shortPath = folderPath.length > 50
        ? '...' + folderPath.slice(-47)
        : folderPath;
    currentFolder.textContent = shortPath;
    currentFolder.title = folderPath; // Full path on hover
}

// Initialize folder display on load
(async () => {
    const folder = await window.api.getDownloadFolder();
    updateFolderDisplay(folder);
})();

// IPC Listeners
window.api.onLog(msg => log(msg));

window.api.onQueueUpdate(queue => {
    queueList.innerHTML = '';
    queue.forEach((url, index) => {
        const li = document.createElement('li');
        li.textContent = `${index + 1}. ${url}`;
        queueList.appendChild(li);
    });
});

window.api.onStatusChange(status => {
    statusText.textContent = status;
});

window.api.onProgress(({ completed, total }) => {
    const percent = Math.round((completed / total) * 100);
    progressBar.style.width = `${percent}%`;
    progressCount.textContent = `${completed}/${total}`;
    progressPercent.textContent = `${percent}%`;
});

window.api.onFinished((msg) => {
    log(msg);
    statusText.textContent = "Concluído";
    startBtn.disabled = false;
    addBtn.disabled = false;
    progressBar.style.width = '0%';
});

window.api.onError((err) => {
    log(`ERRO: ${err}`);
    alert(`Erro: ${err}`);
    startBtn.disabled = false;
    addBtn.disabled = false;
});
