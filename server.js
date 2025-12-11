const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure firmware directory exists
const firmwareDir = path.join(__dirname, 'firmware');
if (!fs.existsSync(firmwareDir)) {
    fs.mkdirSync(firmwareDir, { recursive: true });
}

// Version file path
const versionFile = path.join(firmwareDir, 'version.json');

// Initialize version file if not exists
if (!fs.existsSync(versionFile)) {
    fs.writeFileSync(versionFile, JSON.stringify({ version: "1.0.0" }));
}

// Multer config for firmware upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, firmwareDir);
    },
    filename: (req, file, cb) => {
        cb(null, 'firmware.bin');
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ESP8266 OTA Update Server',
        endpoints: {
            version: 'GET /version',
            firmware: 'GET /firmware',
            update: 'POST /update (multipart/form-data with "firmware" file and "version" field)',
            check: 'GET /check?version=x.x.x'
        }
    });
});

// Get current firmware version
app.get('/version', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read version' });
    }
});

// Check if update is available (ESP8266 sends its current version)
app.get('/check', (req, res) => {
    const deviceVersion = req.query.version || req.headers['x-esp8266-version'];

    try {
        const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        const serverVersion = data.version;

        // Compare versions
        const updateAvailable = compareVersions(serverVersion, deviceVersion) > 0;

        res.json({
            currentVersion: deviceVersion,
            latestVersion: serverVersion,
            updateAvailable: updateAvailable
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check version' });
    }
});

// Download firmware binary
app.get('/firmware', (req, res) => {
    const firmwarePath = path.join(firmwareDir, 'firmware.bin');

    if (!fs.existsSync(firmwarePath)) {
        return res.status(404).json({ error: 'Firmware not found' });
    }

    // Get file stats for content-length
    const stats = fs.statSync(firmwarePath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=firmware.bin');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('x-MD5', getMD5(firmwarePath));

    const fileStream = fs.createReadStream(firmwarePath);
    fileStream.pipe(res);
});

// Upload new firmware (for admin use)
app.post('/update', upload.single('firmware'), (req, res) => {
    const newVersion = req.body.version;

    if (!req.file) {
        return res.status(400).json({ error: 'No firmware file uploaded' });
    }

    if (!newVersion) {
        return res.status(400).json({ error: 'Version number required' });
    }

    // Update version file
    fs.writeFileSync(versionFile, JSON.stringify({
        version: newVersion,
        updatedAt: new Date().toISOString(),
        size: req.file.size
    }));

    res.json({
        success: true,
        message: 'Firmware updated successfully',
        version: newVersion,
        size: req.file.size
    });
});

// Helper: Compare semantic versions
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

// Helper: Get MD5 hash of file
function getMD5(filePath) {
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

app.listen(PORT, () => {
    console.log(`ESP8266 OTA Server running on port ${PORT}`);
});
