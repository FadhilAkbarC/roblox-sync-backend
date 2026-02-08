// ========================================
// ROBLOX STUDIO SYNC - BACKEND SERVER
// Production-Grade Real-Time Server
// ========================================

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Initialize Express App
const app = express();
const server = http.createServer(app);

// CORS options to explicitly allow Content-Type and preflight OPTIONS
const corsOptions = {
    origin: '*', // change to specific origin in production
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
};

// Socket.IO Configuration
const io = socketIO(server, {
    cors: {
        origin: "*",  // Change to specific domain in production
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Middleware
app.use(cors(corsOptions));
// Ensure preflight OPTIONS requests are handled for all routes
app.options('*', cors(corsOptions));

// Fallback CORS headers middleware (ensures Access-Control-Allow-Headers present)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOptions.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', (corsOptions.methods || ['GET','POST','OPTIONS']).join(','));
    res.setHeader('Access-Control-Allow-Headers', (corsOptions.allowedHeaders || ['Content-Type','Authorization','X-Requested-With']).join(','));
    res.setHeader('Access-Control-Allow-Credentials', corsOptions.credentials ? 'true' : 'false');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});
app.use(express.json({ limit: '50mb' }));  // Increased limit for large game data
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ========================================
// STATE MANAGEMENT
// ========================================

// Current game data cache
let currentGameData = {
    hierarchy: [],
    scripts: {},
    lastUpdate: null,
    hash: null,
    metadata: {
        placeName: '',
        placeId: 0,
        scriptCount: 0,
        objectCount: 0,
        clientCount: 0
    }
};

// Connected WebSocket clients
const clients = new Map();

// Statistics
const stats = {
    totalSyncs: 0,
    totalClients: 0,
    startTime: Date.now(),
    lastSync: null
};

// ========================================
// API ENDPOINTS
// ========================================

// Health Check Endpoint
app.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    
    res.json({
        status: 'ok',
        uptime: uptime,
        clients: clients.size,
        lastUpdate: currentGameData.lastUpdate,
        totalSyncs: stats.totalSyncs,
        version: '2.0.0',
        memory: process.memoryUsage()
    });
});

// Main Sync Endpoint (receives data from Roblox Plugin)
app.post('/api/sync', (req, res) => {
    try {
        const { hierarchy, scripts, timestamp, metadata, isFullSync, changes, hash } = req.body;
        
        let updateBroadcast = null;
        let syncType = 'UNKNOWN';
        
        if (isFullSync) {
            // Full sync: replace entire state
            syncType = 'FULL';
            
            if (!hierarchy) {
                return res.status(400).json({ 
                    error: 'Missing hierarchy data for full sync',
                    code: 'MISSING_HIERARCHY'
                });
            }

            // Count objects recursively
            const countObjects = (nodes) => {
                let count = 0;
                for (const node of nodes) {
                    count++;
                    if (node.children) count += countObjects(node.children);
                }
                return count;
            };

            // Update game data with full state
            currentGameData = {
                hierarchy,
                scripts: scripts || {},
                lastUpdate: timestamp || Date.now(),
                hash: hash,
                metadata: {
                    ...metadata,
                    scriptCount: Object.keys(scripts || {}).length,
                    objectCount: countObjects(hierarchy),
                    clientCount: global.clients?.size || 0,
                    lastSync: new Date().toISOString()
                }
            };
            
            // Broadcast full state for first sync
            updateBroadcast = {
                type: 'full',
                ...currentGameData,
                serverTime: Date.now()
            };

        } else if (changes) {
            // Delta sync: apply only changes
            syncType = 'DELTA';
            
            if (changes.hierarchyChanged && hierarchy) {
                currentGameData.hierarchy = hierarchy;
            }
            
            // Apply script changes
            if (changes.scriptsChanged) {
                // Add new scripts
                for (const [name, source] of Object.entries(changes.addedScripts || {})) {
                    currentGameData.scripts[name] = source;
                }
                
                // Update modified scripts
                for (const [name, source] of Object.entries(changes.modifiedScripts || {})) {
                    currentGameData.scripts[name] = source;
                }
                
                // Remove deleted scripts
                for (const name of Object.keys(changes.removedScripts || {})) {
                    delete currentGameData.scripts[name];
                }
            }
            
            // Update metadata and hash
            currentGameData.lastUpdate = timestamp || Date.now();
            currentGameData.hash = hash;
            currentGameData.metadata = {
                ...currentGameData.metadata,
                ...metadata,
                scriptCount: Object.keys(currentGameData.scripts).length,
                lastSync: new Date().toISOString()
            };
            
            // Broadcast only the delta to clients
            updateBroadcast = {
                type: 'delta',
                changes,
                metadata: currentGameData.metadata,
                serverTime: Date.now()
            };
        } else {
            return res.status(400).json({
                error: 'Invalid sync payload',
                code: 'INVALID_PAYLOAD'
            });
        }

        // Update statistics
        stats.totalSyncs++;
        stats.lastSync = new Date().toISOString();

        // Broadcast update to connected clients
        io.emit('game-update', updateBroadcast);

        // Log sync
        console.log(`[SYNC] ✓ ${syncType} sync received`);
        console.log(`  ├─ Type: ${syncType}`);
        if (currentGameData.metadata.objectCount) {
            console.log(`  ├─ Objects: ${currentGameData.metadata.objectCount}`);
        }
        console.log(`  ├─ Scripts: ${currentGameData.metadata.scriptCount}`);
        console.log(`  └─ Clients notified: ${clients.size}`);

        // Response
        res.json({
            success: true,
            clientsNotified: clients.size,
            timestamp: currentGameData.lastUpdate,
            syncType,
            stats: {
                objects: currentGameData.metadata.objectCount,
                scripts: currentGameData.metadata.scriptCount
            }
        });

    } catch (error) {
        console.error('[ERROR] Sync failed:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            code: 'SERVER_ERROR',
            message: error.message
        });
    }
});

// Get Current Data Endpoint
app.get('/api/current', (req, res) => {
    res.json({
        ...currentGameData,
        serverTime: Date.now(),
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });
});

// Statistics Endpoint
app.get('/api/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    
    res.json({
        uptime,
        totalSyncs: stats.totalSyncs,
        connectedClients: clients.size,
        lastSync: stats.lastSync,
        currentData: {
            objects: currentGameData.metadata.objectCount,
            scripts: currentGameData.metadata.scriptCount
        },
        memory: process.memoryUsage()
    });
});

// Root Endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Roblox Studio Sync Server',
        version: '2.0.0',
        status: 'online',
        endpoints: {
            health: '/health',
            sync: 'POST /api/sync',
            current: '/api/current',
            stats: '/api/stats'
        },
        websocket: {
            connected: clients.size,
            endpoint: 'ws://' + req.get('host')
        }
    });
});

// ========================================
// WEBSOCKET HANDLING
// ========================================

io.on('connection', (socket) => {
    const clientId = socket.id;
    const clientIP = socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || 'Unknown';
    
    // Add to clients map
    clients.set(clientId, {
        id: clientId,
        ip: clientIP,
        userAgent,
        connectedAt: Date.now()
    });
    
    stats.totalClients++;
    
    console.log(`[WS] ✓ Client connected`);
    console.log(`  ├─ ID: ${clientId}`);
    console.log(`  ├─ IP: ${clientIP}`);
    console.log(`  └─ Total: ${clients.size}`);

    // Send current data immediately
    socket.emit('game-update', {
        ...currentGameData,
        serverTime: Date.now(),
        message: 'Initial data load'
    });

    // Handle client requests
    socket.on('request-update', () => {
        console.log(`[WS] Client ${clientId} requested update`);
        socket.emit('game-update', {
            ...currentGameData,
            serverTime: Date.now()
        });
    });

    // Handle ping-pong for connection health
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        clients.delete(clientId);
        console.log(`[WS] ✗ Client disconnected`);
        console.log(`  ├─ ID: ${clientId}`);
        console.log(`  ├─ Reason: ${reason}`);
        console.log(`  └─ Remaining: ${clients.size}`);
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error(`[WS] Error from ${clientId}:`, error);
    });
});

// ========================================
// ERROR HANDLING
// ========================================

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        code: 'NOT_FOUND',
        path: req.path
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[ERROR] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        code: 'SERVER_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
    });
});

// ========================================
// SERVER STARTUP
// ========================================

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('========================================');
    console.log('🚀 ROBLOX STUDIO SYNC SERVER');
    console.log('========================================');
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Host: ${HOST}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ WebSocket ready`);
    console.log('');
    console.log('📡 Endpoints:');
    console.log(`  ├─ Health: http://localhost:${PORT}/health`);
    console.log(`  ├─ Sync: POST http://localhost:${PORT}/api/sync`);
    console.log(`  ├─ Current: http://localhost:${PORT}/api/current`);
    console.log(`  └─ Stats: http://localhost:${PORT}/api/stats`);
    console.log('');
    console.log('🔌 WebSocket: ws://localhost:' + PORT);
    console.log('========================================');
    console.log('');
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

const gracefulShutdown = () => {
    console.log('');
    console.log('[SHUTDOWN] Graceful shutdown initiated...');
    
    // Stop accepting new connections
    server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed');
        
        // Close all WebSocket connections
        io.close(() => {
            console.log('[SHUTDOWN] WebSocket server closed');
            console.log('[SHUTDOWN] Goodbye! 👋');
            process.exit(0);
        });
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown();
});

// ========================================
// MODULE EXPORT (for testing)
// ========================================

module.exports = { app, server, io };
