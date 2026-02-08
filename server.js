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

// Get environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

// CORS options to explicitly allow Content-Type and preflight OPTIONS
const corsOptions = {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
};

// Socket.IO Configuration - Optimized for better reliability
const io = socketIO(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true
    },
    // Reduce timeouts for faster fallback to polling
    pingTimeout: 25000,      // 25 second ping timeout
    pingInterval: 10000,     // 10 second ping interval
    upgradeTimeout: 10000,   // 10 second upgrade timeout
    maxHttpBufferSize: 1e6,  // 1MB max buffer
    transports: ['websocket', 'polling'],
    allowEIO3: true          // Allow Engine.IO v3 fallback
});

// Middleware
app.use(cors(corsOptions));
// Ensure preflight OPTIONS requests are handled for all routes
app.options('*', cors(corsOptions));

// Fallback CORS headers middleware (ensures Access-Control-Allow-Headers present)
app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowedOrigin = ALLOWED_ORIGINS.includes('*') ? '*' : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
    
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
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

// Connection state tracking
const connectionState = {
    lastHealthCheck: Date.now(),
    activeUpgrades: 0,
    failedUpgrades: 0
};

// Statistics
const stats = {
    totalSyncs: 0,
    totalClients: 0,
    totalConnections: 0,
    totalFailedConnections: 0,
    startTime: Date.now(),
    lastSync: null
};

// ========================================
// API ENDPOINTS
// ========================================

// Health Check Endpoint - Important for load balancers
app.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const memUsage = process.memoryUsage();
    
    res.json({
        status: 'ok',
        uptime: uptime,
        timestamp: new Date().toISOString(),
        clients: clients.size,
        lastUpdate: currentGameData.lastUpdate,
        totalSyncs: stats.totalSyncs,
        version: '2.1.0',
        memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
        },
        connectionState: {
            activeConnections: clients.size,
            totalConnections: stats.totalConnections,
            failedConnections: stats.totalFailedConnections,
            lastHealthCheck: new Date(connectionState.lastHealthCheck).toISOString()
        }
    });
});

// Ping endpoint for quick connectivity checks
app.get('/ping', (req, res) => {
    res.json({ 
        message: 'pong',
        timestamp: Date.now()
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
                    clientCount: clients.size,
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
            message: NODE_ENV === 'production' ? 'An error occurred' : error.message
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
        connections: {
            total: stats.totalConnections,
            active: clients.size,
            failed: stats.totalFailedConnections
        },
        memory: process.memoryUsage()
    });
});

// Root Endpoint
app.get('/', (req, res) => {
    const protocol = req.secure ? 'wss' : 'ws';
    const host = req.get('host');
    
    res.json({
        name: 'Roblox Studio Sync Server',
        version: '2.1.0',
        status: 'online',
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            ping: '/ping',
            sync: 'POST /api/sync',
            current: '/api/current',
            stats: '/api/stats'
        },
        websocket: {
            connected: clients.size,
            endpoint: `${protocol}://${host}`
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
    const connectionTime = Date.now();
    
    // Increment connection stats
    stats.totalConnections++;
    stats.totalClients = Math.max(stats.totalClients, clients.size + 1);
    
    // Add to clients map
    clients.set(clientId, {
        id: clientId,
        ip: clientIP,
        userAgent,
        connectedAt: connectionTime,
        transport: socket.conn.transport.name
    });
    
    console.log(`[WS] ✓ Client connected`);
    console.log(`  ├─ ID: ${clientId.substring(0, 8)}...`);
    console.log(`  ├─ IP: ${clientIP}`);
    console.log(`  ├─ Transport: ${socket.conn.transport.name}`);
    console.log(`  └─ Total: ${clients.size}`);

    // Send current data immediately with connection info
    socket.emit('connection-ready', {
        clientId: clientId,
        serverTime: Date.now(),
        message: 'Connected to Roblox Studio Sync Server'
    });

    // Send initial game data
    socket.emit('game-update', {
        ...currentGameData,
        serverTime: Date.now(),
        message: 'Initial data load'
    });

    // Handle client requests
    socket.on('request-update', () => {
        console.log(`[WS] Client ${clientId.substring(0, 8)}... requested update`);
        socket.emit('game-update', {
            ...currentGameData,
            serverTime: Date.now()
        });
    });

    // Handle ping-pong for connection health
    socket.on('ping', (data) => {
        socket.emit('pong', { 
            timestamp: Date.now(),
            clientTimestamp: data?.timestamp 
        });
    });

    // Handle connection upgrade (websocket -> polling fallback)
    socket.conn.on('upgrade', (transport) => {
        const oldTransport = clients.get(clientId)?.transport;
        if (clients.has(clientId)) {
            clients.get(clientId).transport = transport.name;
        }
        console.log(`[WS] ✓ Transport upgrade: ${oldTransport} → ${transport.name}`);
    });

    // Handle connection downgrade
    socket.conn.on('downgrade', (transport) => {
        console.log(`[WS] ⚠ Transport downgrade to: ${transport.name}`);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        const client = clients.get(clientId);
        const connectionDuration = Date.now() - connectionTime;
        clients.delete(clientId);
        
        // Track failed connections if disconnected quickly
        if (connectionDuration < 5000 && reason !== 'client namespace disconnect') {
            stats.totalFailedConnections++;
        }
        
        console.log(`[WS] ✗ Client disconnected`);
        console.log(`  ├─ ID: ${clientId.substring(0, 8)}...`);
        console.log(`  ├─ Reason: ${reason}`);
        console.log(`  ├─ Duration: ${Math.round(connectionDuration / 1000)}s`);
        console.log(`  └─ Remaining: ${clients.size}`);
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error(`[WS] Error from ${clientId.substring(0, 8)}...:`, error);
    });

    // Handle client errors at transport level
    socket.conn.on('error', (error) => {
        console.error(`[WS] Transport error from ${clientId.substring(0, 8)}...:`, error);
    });
});

// Handle connection errors from Socket.IO
io.on('connection_error', (error) => {
    console.error('[WS] Connection error:', error.message);
    stats.totalFailedConnections++;
});

// ========================================
// ERROR HANDLING
// ========================================

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        code: 'NOT_FOUND',
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[ERROR] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        code: 'SERVER_ERROR',
        message: NODE_ENV === 'production' ? 'An error occurred' : err.message,
        timestamp: new Date().toISOString()
    });
});

// ========================================
// PERIODIC HEALTH CHECKS
// ========================================

// Clean up stale connections every 30 seconds
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    clients.forEach((client, clientId) => {
        // Check if client has been there more than 5 minutes without activity
        // Socket.IO should handle this, but this is a safety check
        // (Actual disconnects are handled by Socket.IO)
    });
    
    connectionState.lastHealthCheck = now;
}, 30000);

// Log server stats every minute
setInterval(() => {
    console.log(`[STATS] Uptime: ${Math.round((Date.now() - stats.startTime) / 1000)}s | Clients: ${clients.size} | Syncs: ${stats.totalSyncs}`);
}, 60000);

// ========================================
// SERVER STARTUP
// ========================================

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('========================================');
    console.log('🚀 ROBLOX STUDIO SYNC SERVER v2.1.0');
    console.log('========================================');
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Host: ${HOST}`);
    console.log(`✓ Environment: ${NODE_ENV}`);
    console.log(`✓ WebSocket ready`);
    console.log(`✓ CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log('');
    console.log('📡 HTTP Endpoints:');
    console.log(`  ├─ Health: http://localhost:${PORT}/health`);
    console.log(`  ├─ Ping: http://localhost:${PORT}/ping`);
    console.log(`  ├─ Sync: POST http://localhost:${PORT}/api/sync`);
    console.log(`  ├─ Current: http://localhost:${PORT}/api/current`);
    console.log(`  └─ Stats: http://localhost:${PORT}/api/stats`);
    console.log('');
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
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
            console.log('[SHUTDOWN] Final stats:');
            console.log(`  ├─ Total connections: ${stats.totalConnections}`);
            console.log(`  ├─ Total syncs: ${stats.totalSyncs}`);
            console.log(`  ├─ Failed connections: ${stats.totalFailedConnections}`);
            console.log(`  └─ Uptime: ${Math.round((Date.now() - stats.startTime) / 1000)}s`);
            console.log('[SHUTDOWN] Goodbye! 👋');
            process.exit(0);
        });
    });

    // Force shutdown after 15 seconds
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced shutdown after timeout');
        process.exit(1);
    }, 15000);
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
